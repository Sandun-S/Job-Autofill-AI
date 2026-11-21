const api = globalThis.browser ?? globalThis.chrome;

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "suggest") {
    suggest(msg.scan)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String((e && e.message) || e) }));
    return true; // async response
  }
  if (msg && msg.type === "scanCareerPage") {
    scanCareerPage(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String((e && e.message) || e) }));
    return true; // async response
  }
});

const DEFAULTS = {
  gemini: { model: "gemini-2.5-flash" },
  deepseek: { model: "deepseek-chat" },
  custom: { model: "", baseUrl: "" },
};

async function getProviderAndProfile(profileNameOverride) {
  const { settings = {}, profiles = {}, activeProfile, savedAnswers: legacySaved = [] } = await api.storage.local.get([
    "settings",
    "profiles",
    "activeProfile",
    "savedAnswers",
  ]);
  const provider = settings.provider || "gemini";
  const cfg = { ...DEFAULTS[provider], ...(settings[provider] || {}) };
  if (!cfg.key) throw new Error(`No API key set for ${provider}. Open the extension options and add one.`);
  const profileKey = profileNameOverride || activeProfile;
  const profile = profiles[profileKey];
  if (!profile || !(profile.cvText || profile.fullName)) {
    throw new Error("Your profile is empty. Open the extension options and add your CV and details.");
  }
  return { provider, cfg, profile, legacySaved };
}

async function callAI(provider, cfg, system, user) {
  if (provider === "gemini") return await callGemini(cfg, system, user);
  return await callOpenAICompat(provider, cfg, system, user);
}

async function suggest(scan) {
  const { provider, cfg, profile, legacySaved } = await getProviderAndProfile();
  if (!scan.fields.length) throw new Error("No fillable form fields found on this page.");

  const savedAnswers = Array.isArray(profile.savedAnswers) ? profile.savedAnswers : legacySaved;
  const aiFields = scan.fields.filter((f) => f.type !== "file");
  let values = {};
  if (aiFields.length) {
    const system = buildSystem();
    const user = buildUser(profile, { ...scan, fields: aiFields }, savedAnswers);
    const text = await callAI(provider, cfg, system, user);
    const parsed = parseJson(text);
    values = parsed.values || parsed;
  }

  const out = { url: scan.url, fields: scan.fields, values };
  await api.storage.local.set({ last: out });
  return out;
}

function buildSystem() {
  return [
    "You fill in job application forms for the candidate described in the profile.",
    "Return ONLY a JSON object: {\"values\": {\"<field id>\": <value>, ...}}.",
    "Rules:",
    "- Use only facts from the profile, CV and saved answers. Saved answers are authoritative. Never invent employers, degrees, dates, numbers or links. If the profile lacks the answer, use an empty string.",
    "- For select and radio fields, the value MUST be copied exactly from one of that field's option values (or labels). Pick the closest true match.",
    "- Fields of type \"dropdown\" are custom dropdowns: if options are listed, return one option label exactly; if marked searchable (no options), return a short search text such as a city name (e.g. \"Colombo\").",
    "- This form may be one step of a multi-step application: only answer the fields listed now.",
    "- For checkbox fields return true or false. Agree to privacy/consent checkboxes only if they are required for submitting.",
    "- For demographic/EEO questions, use the profile's extra notes if present; otherwise choose a 'prefer not to say / decline' option if one exists, else empty string.",
    "- For date inputs use YYYY-MM-DD. For number inputs return digits only.",
    "- For open-ended questions (why this role, cover letter, tell us about yourself), write 80-150 words in first person, specific to the job description and tied to the candidate's goals and CV. Respect maxLength if given. Match the requested tone.",
    "- Skip fields you cannot answer by leaving them out or using an empty string.",
  ].join("\n");
}

function buildProfileBlock(p) {
  return [
    ["Name", p.fullName], ["Email", p.email], ["Phone", p.phone],
    ["City", p.city], ["Country", p.country], ["Address", p.address],
    ["LinkedIn", p.linkedin], ["GitHub", p.github], ["Portfolio/Website", p.portfolio],
    ["Current title", p.currentTitle], ["Current company", p.currentCompany],
    ["Years of experience", p.yearsExperience], ["Education", p.education],
    ["Languages", p.languages], ["Expected salary", p.expectedSalary],
    ["Notice period", p.noticePeriod], ["Work authorization", p.workAuthorization],
    ["Target roles", p.targetRoles], ["Career goals", p.goals],
    ["Preferences (work mode, location, relocation, dealbreakers)", p.preferences],
    ["Writing tone", p.tone],
    ["Extra notes / standard answers", p.extraNotes],
  ]
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function buildUser(p, scan, saved) {
  const profileBlock = buildProfileBlock(p);

  const fields = scan.fields.map((f) => {
    const o = { id: f.id, type: f.type, label: f.label };
    if (f.placeholder) o.placeholder = f.placeholder;
    if (f.options) o.options = f.options;
    if (f.required) o.required = true;
    if (f.maxLength) o.maxLength = f.maxLength;
    if (f.group) o.group = f.group;
    if (f.current !== undefined && f.current !== "" && f.current !== false) o.alreadyFilled = f.current;
    return o;
  });

  return [
    "=== CANDIDATE PROFILE ===",
    profileBlock,
    "",
    ...(saved && saved.length
      ? [
          "=== SAVED ANSWERS (the candidate's own earlier answers; reuse when a field asks the same thing, even if worded differently) ===",
          saved.slice(0, 80).map((a) => `Q: ${a.label}\nA: ${a.value}`).join("\n"),
          "",
        ]
      : []),
    "=== CV ===",
    (p.cvText || "").slice(0, 12000),
    "",
    `=== JOB PAGE (${scan.title}) ===`,
    (scan.jobText || "").slice(0, 6000),
    "",
    "=== FORM FIELDS (JSON) ===",
    JSON.stringify(fields),
    "",
    "Return the JSON object now.",
  ].join("\n");
}

async function callGemini(cfg, system, user) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${data?.error?.message || res.statusText}`);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("");
  if (!text) throw new Error("Gemini returned an empty response.");
  return text;
}

async function callOpenAICompat(provider, cfg, system, user) {
  const base = provider === "deepseek" ? "https://api.deepseek.com" : (cfg.baseUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("Custom provider needs a base URL (e.g. https://api.openai.com/v1).");
  if (!cfg.model) throw new Error("Custom provider needs a model name.");
  const body = {
    model: cfg.model,
    temperature: 0.3,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (provider === "deepseek") body.response_format = { type: "json_object" };
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${provider} error ${res.status}: ${data?.error?.message || res.statusText}`);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("The model returned an empty response.");
  return text;
}

function parseJson(text) {
  let t = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch (e) {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("Could not read the model's answer as JSON.");
  }
}

// ---------- Career page scanner ----------
function extractCareerPageData() {
  const text = (document.body && document.body.innerText ? document.body.innerText : "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const seen = new Set();
  const links = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const rawHref = a.getAttribute("href") || "";
    if (!rawHref || rawHref.startsWith("#") || /^(mailto|tel|javascript):/i.test(rawHref)) continue;
    let href;
    try {
      href = new URL(a.href, location.href).href;
    } catch (e) {
      continue;
    }
    if (!/^https?:\/\//i.test(href)) continue;
    const label = (a.innerText || a.getAttribute("aria-label") || a.title || "").replace(/\s+/g, " ").trim();
    if (!label && !/job|career|position|apply|opening|role|workday/i.test(href)) continue;
    const key = `${label}::${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ text: label.slice(0, 140), href });
    if (links.length >= 200) break;
  }

  return {
    title: document.title || "",
    url: location.href,
    text: text.slice(0, 12000),
    links,
  };
}

function waitForTabLoad(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      api.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    api.tabs.onUpdated.addListener(onUpdated);
    const timer = setTimeout(finish, timeoutMs);
  });
}

async function scanCareerPage({ url, company, profileName }) {
  const { provider, cfg, profile } = await getProviderAndProfile(profileName);
  const tab = await api.tabs.create({ url, active: false });
  try {
    await waitForTabLoad(tab.id, 20000);
    // Give SPAs (e.g. Workday, React boards) time to render job listings.
    await new Promise((r) => setTimeout(r, 2500));

    const results = await api.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: extractCareerPageData,
    });
    const frames = results.map((r) => r.result).filter(Boolean);
    if (!frames.length) throw new Error("Could not read this career page.");

    const seenLinks = new Set();
    const mergedLinks = [];
    for (const f of frames) {
      for (const l of f.links || []) {
        const key = `${l.text}::${l.href}`;
        if (seenLinks.has(key)) continue;
        seenLinks.add(key);
        mergedLinks.push(l);
        if (mergedLinks.length >= 250) break;
      }
      if (mergedLinks.length >= 250) break;
    }

    const mergedText = frames.map((f) => f.text).filter(Boolean).join("\n\n").slice(0, 14000);
    const pageTitle = frames.find((f) => f.title)?.title || company || url;

    const system = [
      "You are a career assistant matching open job roles on a company's career page to a candidate's profile and CV.",
      'Return ONLY a JSON object: {"roles": [{"title": "...", "applyUrl": "...", "match": "high"|"medium", "reason": "..."}]}.',
      "Rules:",
      "- Only include genuine open job positions found in the page text or links that are applicable to the candidate's skills, experience, target roles, and location/preferences.",
      "- For applyUrl, use the exact matching URL from the extracted LINKS list when available; otherwise use the career page URL itself. Never invent URLs.",
      "- Keep reason concise (1 short sentence explaining why the role fits the candidate).",
      "- If no applicable open roles are found on the page, return {\"roles\": []}.",
    ].join("\n");

    const user = [
      "=== CANDIDATE PROFILE ===",
      buildProfileBlock(profile),
      "",
      "=== CV ===",
      (profile.cvText || "").slice(0, 10000),
      "",
      `=== CAREER PAGE (${company || pageTitle}) ===`,
      `URL: ${url}`,
      "",
      "=== EXTRACTED LINKS (JSON) ===",
      JSON.stringify(mergedLinks),
      "",
      "=== PAGE TEXT ===",
      mergedText,
      "",
      "Return the JSON object now.",
    ].join("\n");

    const raw = await callAI(provider, cfg, system, user);
    const parsed = parseJson(raw);
    const roles = Array.isArray(parsed.roles) ? parsed.roles : [];

    const cleanRoles = roles
      .filter((r) => r && typeof r === "object" && typeof r.title === "string" && r.title.trim())
      .map((r) => {
        let applyUrl = url;
        try {
          const u = new URL(String(r.applyUrl || ""));
          if (u.protocol === "http:" || u.protocol === "https:") applyUrl = u.href;
        } catch (e) {}
        return {
          title: r.title.trim(),
          applyUrl,
          match: String(r.match || "").toLowerCase() === "high" ? "high" : "medium",
          reason: typeof r.reason === "string" ? r.reason.trim() : "",
        };
      });

    return { roles: cleanRoles, scannedAt: new Date().toISOString() };
  } finally {
    await api.tabs.remove(tab.id).catch(() => {});
  }
}
