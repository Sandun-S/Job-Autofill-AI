const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let tab = null;
let current = null; // { fields, values }
let activeCvFile = null;

function setStatus(msg, isErr) {
  $("status").textContent = msg || "";
  $("status").className = isErr ? "err" : "";
}

// ---------- application log ----------
const normUrl = (u) => String(u || "").split("#")[0];

function guessRoleCompany(title) {
  const parts = String(title || "").split(/\s[|\-–—]\s/).map((s) => s.trim()).filter(Boolean);
  const skip = /linkedin|careers|jobs|greenhouse|lever|workday|indeed/i;
  return {
    title: parts[0] || "(untitled)",
    company: parts.slice(1).find((p) => !skip.test(p)) || "",
  };
}

async function getApp() {
  const { applications = [] } = await api.storage.local.get("applications");
  return applications.find((a) => normUrl(a.url) === normUrl(tab.url)) || null;
}

async function upsertApp(status) {
  const { applications = [] } = await api.storage.local.get("applications");
  const now = new Date().toISOString();
  let a = applications.find((x) => normUrl(x.url) === normUrl(tab.url));
  if (!a) {
    const g = guessRoleCompany(tab.title);
    a = {
      id: Date.now().toString(36),
      url: tab.url,
      title: g.title,
      company: g.company,
      status,
      createdAt: now,
      appliedAt: status === "Applied" ? now : "",
      notes: "",
    };
    applications.unshift(a);
  } else if (status === "Applied" && a.status === "In progress") {
    a.status = "Applied";
    a.appliedAt = now;
  }
  a.updatedAt = now;
  await api.storage.local.set({ applications });
  await showLogLine();
  return a;
}

async function showLogLine() {
  const a = await getApp();
  if (!a) {
    $("logtext").textContent = "Not in your application log yet.";
    $("markApplied").textContent = "Log as applied";
    $("markApplied").disabled = false;
  } else {
    $("logtext").textContent = `Log: ${a.status}${a.appliedAt ? " · " + new Date(a.appliedAt).toLocaleDateString() : ""}`;
    $("markApplied").textContent = "Mark as applied";
    $("markApplied").disabled = a.status !== "In progress";
  }
}

$("markApplied").onclick = () => upsertApp("Applied");
$("logLink").onclick = () => {
  api.tabs.create({ url: api.runtime.getURL("log.html") });
  window.close();
};
$("careersLink").onclick = () => {
  api.tabs.create({ url: api.runtime.getURL("careers.html") });
  window.close();
};

// ---------- init ----------
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
  const curProfile = activeProfile && profiles[activeProfile] ? activeProfile : names[0];
  activeCvFile = (curProfile && profiles[curProfile]?.cvFile) || null;
  $("profile").onchange = async () => {
    const chosen = $("profile").value;
    await api.storage.local.set({ activeProfile: chosen });
    const d = await api.storage.local.get("profiles");
    activeCvFile = d.profiles?.[chosen]?.cvFile || null;
  };

  await showLogLine();

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

    // Auto-match CV file to CV/Resume file upload inputs locally.
    const { profiles = {}, activeProfile } = await api.storage.local.get(["profiles", "activeProfile"]);
    activeCvFile = profiles[activeProfile]?.cvFile || null;
    if (activeCvFile) {
      const fileFields = current.fields.filter((f) => f.type === "file");
      fileFields.forEach((f) => {
        if (isCvFileField(f, fileFields)) {
          current.values[f.id] = activeCvFile;
        }
      });
      await api.storage.local.set({ last: current });
    }

    render();
    const missing = current.fields.filter(isMissing).filter((f) => f.required).length;
    const n = current.fields.filter((f) => !isMissing(f)).length;
    setStatus(
      `${n} of ${current.fields.length} fields have suggestions.` +
        (missing ? ` ${missing} required field(s) need your input (see Missing data).` : " Review before filling.")
    );
  } catch (e) {
    setStatus(e.message || String(e), true);
  } finally {
    $("go").disabled = false;
    $("fillNext").disabled = false;
  }
}

$("go").onclick = runScan;

// ---------- rendering ----------
function isCvFileField(f, allFileFields) {
  if (/cv|resume|curriculum|vitae/i.test(f.label || "")) return true;
  if (allFileFields.length === 1 && (!f.accept || /pdf|doc|msword|wordprocessingml/i.test(f.accept))) return true;
  return false;
}

function hasValue(v) {
  if (v && typeof v === "object") return Boolean(v.name && v.data);
  return v !== undefined && v !== null && String(v) !== "";
}

function isMissing(f) {
  if (hasValue(current.values[f.id])) return false;
  if (f.current !== undefined && f.current !== "" && f.current !== false) return false; // page already has a value
  return true;
}

function labelOf(f) {
  return f.label || f.placeholder || "(unlabelled field)";
}

function buildLabel(f) {
  const lbl = document.createElement("div");
  lbl.className = "lbl";
  lbl.textContent = labelOf(f);
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = ` ${f.type}${f.required ? " *" : ""}`;
  lbl.appendChild(meta);
  return lbl;
}

function suggestionRow(f) {
  const row = document.createElement("div");
  row.className = "row";

  if (f.type === "file") {
    const fileVal = current.values[f.id];
    const info = document.createElement("div");
    info.className = "meta";
    info.style.opacity = "0.9";
    info.textContent = `Profile CV: ${fileVal.name}`;
    const actions = document.createElement("div");
    actions.className = "actions";
    const fill = document.createElement("button");
    fill.className = "primary";
    fill.textContent = "Attach";
    fill.onclick = () => fillValues({ [f.id]: fileVal });
    const skip = document.createElement("button");
    skip.textContent = "Skip";
    skip.onclick = async () => {
      delete current.values[f.id];
      await api.storage.local.set({ last: current });
      render();
    };
    actions.append(fill, skip);
    row.append(buildLabel(f), info, actions);
    return row;
  }

  const ta = document.createElement("textarea");
  ta.value = String(current.values[f.id]);
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

  row.append(buildLabel(f), ta, actions);
  return row;
}

function missingRow(f) {
  const row = document.createElement("div");
  row.className = "row miss";

  if (f.type === "file") {
    const info = document.createElement("div");
    info.className = "meta";
    const actions = document.createElement("div");
    actions.className = "actions";
    if (activeCvFile) {
      info.textContent = "Not auto-matched as a CV/Resume field.";
      const attach = document.createElement("button");
      attach.className = "primary";
      attach.textContent = `Attach ${activeCvFile.name}`;
      attach.onclick = async () => {
        current.values[f.id] = activeCvFile;
        await api.storage.local.set({ last: current });
        render();
        await fillValues({ [f.id]: activeCvFile });
      };
      actions.append(attach);
    } else {
      info.textContent = "No CV file attached to this profile. Add one in Settings / profile, or upload manually on the page.";
    }
    row.append(buildLabel(f), info, actions);
    return row;
  }

  let control;
  const opts = f.type === "checkbox" ? [{ value: "true", label: "Yes / checked" }, { value: "false", label: "No / unchecked" }] : f.options;
  if (opts && opts.length) {
    control = document.createElement("select");
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "-- choose --";
    control.appendChild(blank);
    opts.forEach((o) => {
      const el = document.createElement("option");
      el.value = o.label || o.value;
      el.textContent = o.label || o.value;
      control.appendChild(el);
    });
  } else {
    control = document.createElement("textarea");
    control.placeholder = f.searchable ? "Type a search text, e.g. a city name" : "Your answer";
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = "Save for later & fill";
  save.onclick = async () => {
    const value = control.value.trim();
    if (!value) return;
    await saveAnswer(f, value);
    current.values[f.id] = value;
    await api.storage.local.set({ last: current });
    render();
    await fillValues({ [f.id]: normalize(f, value) });
  };
  actions.append(save);

  row.append(buildLabel(f), control, actions);
  return row;
}

function render() {
  const list = $("list");
  list.innerHTML = "";
  $("bar").style.display = "flex";

  const missing = current.fields.filter(isMissing);
  const missReq = missing.filter((f) => f.required);
  const missOpt = missing.filter((f) => !f.required);
  const have = current.fields.filter((f) => !isMissing(f));

  if (missReq.length) {
    const h = document.createElement("h3");
    h.className = "missing";
    h.textContent = `Missing data: ${missReq.length} required field(s). Answers are saved and reused next time.`;
    list.appendChild(h);
    missReq.forEach((f) => list.appendChild(missingRow(f)));
  }

  if (have.length) {
    const h = document.createElement("h3");
    h.textContent = `Suggestions (${have.length})`;
    list.appendChild(h);
    have.forEach((f) => list.appendChild(suggestionRow(f)));
  }

  if (missOpt.length) {
    const d = document.createElement("details");
    const s = document.createElement("summary");
    s.textContent = `Optional fields without data (${missOpt.length})`;
    d.appendChild(s);
    missOpt.forEach((f) => d.appendChild(missingRow(f)));
    list.appendChild(d);
  }
}

// ---------- saved answers ----------
const normLabel = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function saveAnswer(f, value) {
  const label = f.label || f.placeholder;
  if (!label) return;
  const { profiles = {}, activeProfile } = await api.storage.local.get(["profiles", "activeProfile"]);
  const name = activeProfile && profiles[activeProfile] ? activeProfile : Object.keys(profiles)[0];
  if (!name) return;
  const list = Array.isArray(profiles[name].savedAnswers) ? profiles[name].savedAnswers : [];
  const entry = { label, value, type: f.type };
  const i = list.findIndex((a) => normLabel(a.label) === normLabel(label));
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  profiles[name].savedAnswers = list;
  await api.storage.local.set({ profiles });
}

// ---------- filling ----------
function normalize(field, value) {
  if (field.type === "checkbox") return String(value).toLowerCase() === "true";
  return value;
}

async function fillValues(map) {
  try {
    setStatus("Filling...");
    const target = { tabId: tab.id, allFrames: true };
    await api.scripting.executeScript({ target, files: ["content.js"] });
    const results = await api.scripting.executeScript({
      target,
      func: (v) => window.__jaf.fill(v),
      args: [map],
    });
    const filled = results.flatMap((r) => r.result?.filled || []);
    const allErrors = results.flatMap((r) => Object.values(r.result?.errors || {}));
    const allStale = results.length > 0 && results.every((r) => r.result?.stale);
    const requested = Object.keys(map).length;
    if (!filled.length && allStale) {
      setStatus("Page was reloaded or changed — press Scan & suggest again.", true);
      return 0;
    }
    const errHint = allErrors.length ? ` (${allErrors[0]})` : "";
    setStatus(`Filled ${filled.length} of ${requested}.${errHint} Check the page before continuing.`, filled.length < requested);
    if (filled.length) await upsertApp("In progress"); // auto-track in the application log
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
    if (hasValue(v)) map[f.id] = normalize(f, v);
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
    .filter((f) => hasValue(current.values[f.id]))
    .map((f) => {
      const v = current.values[f.id];
      return `${labelOf(f)}: ${v && typeof v === "object" ? `[File: ${v.name}]` : v}`;
    })
    .join("\n");
  await navigator.clipboard.writeText(text);
  setStatus("Copied all suggestions.");
};

init();
