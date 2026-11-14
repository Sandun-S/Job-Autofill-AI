const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let tab = null;
let current = null; // { fields, values }

function setStatus(msg, isErr) {
  $("status").textContent = msg || "";
  $("status").className = isErr ? "err" : "";
}

async function init() {
  [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const { profiles = {}, activeProfile, last } = await api.storage.local.get(["profiles", "activeProfile", "last"]);
  const names = Object.keys(profiles);
  if (!names.length) {
    setStatus("No profile yet. Open Settings / profile and add your CV.", true);
  }
  $("profile").innerHTML = "";
  names.forEach((n) => {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
    if (n === activeProfile) o.selected = true;
    $("profile").appendChild(o);
  });
  $("profile").onchange = () => api.storage.local.set({ activeProfile: $("profile").value });

  if (last && tab && last.url === tab.url) {
    current = last;
    render();
    setStatus("Showing your last result for this page. Press Scan & suggest to refresh.");
  }
}

$("opts").onclick = () => {
  api.runtime.openOptionsPage();
  window.close();
};

async function ensureAccess() {
  // Needed so the extension can read forms inside iframes (e.g. Greenhouse embeds).
  const has = await api.permissions.contains({ origins: ["<all_urls>"] });
  if (has) return true;
  return await api.permissions.request({ origins: ["<all_urls>"] });
}

async function runScan() {
  $("go").disabled = true;
  $("fillNext").disabled = true;
  setStatus("Reading the page...");
  try {
    if (!(await ensureAccess())) {
      throw new Error("Site access was not granted. It is needed to read forms inside embedded frames.");
    }
    const target = { tabId: tab.id, allFrames: true };
    await api.scripting.executeScript({ target, files: ["content.js"] });
    const results = await api.scripting.executeScript({ target, func: () => window.__jaf.scan() });
    const scans = results.map((r) => r.result).filter(Boolean);
    if (!scans.length) throw new Error("Could not read this page (browser-internal pages are blocked).");
    const merged = {
      url: tab.url,
      title: scans.find((s) => s.title)?.title || "",
      jobText: scans.map((s) => s.jobText).filter(Boolean).join("\n"),
      fields: scans.flatMap((s) => s.fields),
    };
    setStatus(`Found ${merged.fields.length} fields (${scans.length} frames). Asking the AI...`);
    const res = await api.runtime.sendMessage({ type: "suggest", scan: merged });
    if (!res || res.error) throw new Error(res?.error || "No response from background.");
    current = { ...res, url: tab.url };
    render();
    const n = Object.values(current.values).filter((v) => v !== "" && v != null).length;
    setStatus(`${n} of ${current.fields.length} fields have suggestions. Review before filling.`);
  } catch (e) {
    setStatus(e.message || String(e), true);
  } finally {
    $("go").disabled = false;
    $("fillNext").disabled = false;
  }
}

$("go").onclick = runScan;

function render() {
  const list = $("list");
  list.innerHTML = "";
  $("bar").style.display = "flex";
  current.fields.forEach((f) => {
    const raw = current.values[f.id];
    const val = raw === undefined || raw === null ? "" : String(raw);
    const row = document.createElement("div");
    row.className = "row" + (val === "" ? " empty" : "");
    row.dataset.id = f.id;

    const lbl = document.createElement("div");
    lbl.className = "lbl";
    lbl.textContent = f.label || f.placeholder || "(unlabelled field)";
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = ` ${f.type}${f.required ? " *" : ""}`;
    lbl.appendChild(meta);

    const ta = document.createElement("textarea");
    ta.value = val;
    ta.oninput = () => {
      current.values[f.id] = ta.value;
    };

    const actions = document.createElement("div");
    actions.className = "actions";
    const copy = document.createElement("button");
    copy.textContent = "Copy";
    copy.onclick = async () => {
      await navigator.clipboard.writeText(ta.value);
      copy.textContent = "Copied";
      setTimeout(() => (copy.textContent = "Copy"), 900);
    };
    const fill = document.createElement("button");
    fill.textContent = "Fill";
    fill.onclick = () => fillValues({ [f.id]: normalize(f, ta.value) });
    actions.append(copy, fill);

    row.append(lbl, ta, actions);
    list.appendChild(row);
  });
}

function normalize(field, value) {
  if (field.type === "checkbox") return String(value).toLowerCase() === "true";
  return value;
}

async function fillValues(map) {
  try {
    setStatus("Filling...");
    const results = await api.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: (v) => window.__jaf.fill(v),
      args: [map],
    });
    const filled = results.flatMap((r) => r.result?.filled || []);
    const requested = Object.keys(map).length;
    setStatus(`Filled ${filled.length} of ${requested}. Check the page before continuing.`, filled.length < requested);
    return filled.length;
  } catch (e) {
    setStatus(e.message || String(e), true);
    return 0;
  }
}

function collectValues() {
  const map = {};
  current.fields.forEach((f) => {
    const v = current.values[f.id];
    if (v !== undefined && v !== null && String(v) !== "") map[f.id] = normalize(f, v);
  });
  return map;
}

$("fillAll").onclick = () => fillValues(collectValues());

// Multi-step forms: fill this step, click Next/Continue (never Submit), then scan the next step.
$("fillNext").onclick = async () => {
  $("fillNext").disabled = true;
  const n = await fillValues(collectValues());
  if (!n) {
    $("fillNext").disabled = false;
    return;
  }
  const res = await api.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => window.__jaf.clickNext(),
  });
  const clicked = res.map((r) => r.result).find(Boolean);
  if (!clicked) {
    setStatus(`Filled ${n}. No Next/Continue button found: click it yourself, then press Scan & suggest.`);
    $("fillNext").disabled = false;
    return;
  }
  setStatus(`Clicked "${clicked}". Waiting for the next step...`);
  await sleep(2500);
  await runScan(); // suggestions for the next step; you review, then press Fill & Next again
};

$("copyAll").onclick = async () => {
  const text = current.fields
    .filter((f) => String(current.values[f.id] ?? "") !== "")
    .map((f) => `${f.label || f.placeholder || f.id}: ${current.values[f.id]}`)
    .join("\n");
  await navigator.clipboard.writeText(text);
  setStatus("Copied all suggestions.");
};

init();
