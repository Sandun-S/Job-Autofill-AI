// Extracts plain text from the CV file attached to a profile.
//  - .docx: parsed locally (zip + XML), nothing leaves the browser.
//  - .pdf : sent once to Gemini (inline PDF), which reads text PDFs and scanned PDFs alike.
// Used by options.js:  const text = await cvText.extract(file, { key, model });
(function (root) {
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Lists the entries of a zip file by reading its central directory.
  function zipEntries(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("This does not look like a valid .docx file.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const entries = [];
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      const lnlen = dv.getUint16(lho + 26, true);
      const lelen = dv.getUint16(lho + 28, true);
      entries.push({ name, method, csize, start: lho + 30 + lnlen + lelen });
      p += 46 + nlen + elen + clen;
    }
    return entries;
  }

  async function readEntry(bytes, e) {
    const data = bytes.subarray(e.start, e.start + e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRaw(data);
    throw new Error("Unsupported compression in the .docx file.");
  }

  function decodeXml(s) {
    return s
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }

  // WordprocessingML -> plain text, one line per paragraph.
  function xmlToText(xml) {
    const lines = [];
    const pRe = /<w:p[\s>][\s\S]*?<\/w:p>/g;
    let m;
    while ((m = pRe.exec(xml))) {
      const p = m[0];
      let line = "";
      const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g;
      let t;
      while ((t = tRe.exec(p))) {
        if (t[1] !== undefined) line += decodeXml(t[1]);
        else if (t[0].startsWith("<w:tab")) line += "\t";
        else line += "\n";
      }
      line = line.replace(/[ \t]+$/g, "");
      if (line.trim() && /<w:numPr>/.test(p)) line = "- " + line;
      // text boxes often appear twice (Choice + Fallback): drop identical consecutive lines
      if (line.trim() && lines.length && lines[lines.length - 1] === line) continue;
      lines.push(line);
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  async function docxToText(bytes) {
    const entries = zipEntries(bytes);
    const dec = new TextDecoder("utf-8");
    // Names and phone numbers are often in the page header, so read headers first.
    const headers = entries.filter((e) => /^word\/header\d*\.xml$/.test(e.name));
    const body = entries.find((e) => e.name === "word/document.xml");
    if (!body) throw new Error("Could not find the document text inside the .docx file.");
    const parts = [];
    for (const e of [...headers, body]) {
      const text = xmlToText(dec.decode(await readEntry(bytes, e)));
      if (text) parts.push(text);
    }
    const out = parts.join("\n\n").trim();
    if (!out) throw new Error("The .docx file contains no readable text.");
    return out;
  }

  async function pdfToTextViaGemini(file, cfg) {
    if (!cfg || !cfg.key) {
      throw new Error(
        "Reading a PDF needs a Gemini API key (used only for this one-time extraction). Add it under AI provider above, or paste the CV text manually."
      );
    }
    const model = cfg.model || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const prompt =
      "Transcribe this CV/resume into plain text. Copy ALL text exactly as written: name, email, phone, links, " +
      "dates, job titles, companies, bullet points, skills, education. Keep the original section order and headings. " +
      "Use '- ' for bullets. If a page is a scan or image, read the text from it. " +
      "Output only the text, with no commentary and no markdown formatting.";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "application/pdf", data: file.data } }, { text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${data?.error?.message || res.statusText}`);
    const parts = data?.candidates?.[0]?.content?.parts || [];
    let text = parts.map((p) => p.text || "").join("").trim();
    text = text.replace(/^```(?:\w+)?\s*/, "").replace(/\s*```$/, "").trim();
    if (!text) throw new Error("Gemini returned no text for this PDF.");
    return text;
  }

  async function extract(file, gemini) {
    const name = String(file.name || "").toLowerCase();
    const type = String(file.type || "");
    if (name.endsWith(".docx") || type.includes("wordprocessingml")) return docxToText(b64ToBytes(file.data));
    if (name.endsWith(".pdf") || type === "application/pdf") return pdfToTextViaGemini(file, gemini);
    if (name.endsWith(".doc")) throw new Error("Old .doc files cannot be read. Save the CV as .docx or PDF and attach that.");
    throw new Error("Unsupported CV file type.");
  }

  const api = { extract, docxToText, xmlToText };
  root.cvText = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
