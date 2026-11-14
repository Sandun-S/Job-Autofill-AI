const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);

// k = storage key, l = label, t = text | area | big, full = spans both columns
const FIELDS = [
  { k: "fullName", l: "Full name" },
  { k: "email", l: "Email" },
  { k: "phone", l: "Phone" },
  { k: "city", l: "City" },
  { k: "country", l: "Country" },
  { k: "address", l: "Full address" },
  { k: "linkedin", l: "LinkedIn URL" },
  { k: "github", l: "GitHub URL" },
  { k: "portfolio", l: "Portfolio / website" },
  { k: "currentTitle", l: "Current job title" },
  { k: "currentCompany", l: "Current company" },
  { k: "yearsExperience", l: "Years of experience" },
  { k: "education", l: "Education (short)" },
  { k: "languages", l: "Languages" },
  { k: "expectedSalary", l: "Expected salary" },
  { k: "noticePeriod", l: "Notice period / availability" },
  { k: "workAuthorization", l: "Work authorization / visa status" },
  { k: "targetRoles", l: "Target roles", hint: "e.g. Junior Backend Developer, QA Engineer" },
  { k: "tone", l: "Writing tone", hint: "e.g. professional, concise, warm" },
  { k: "goals", l: "My goals and targets", t: "area", full: true,
    hint: "Where you want your career to go, what you want to learn, what kind of company/team you want. Used to personalize 'why this role' answers and cover letters." },
  { k: "preferences", l: "Preferences", t: "area", full: true,
    hint: "Remote/hybrid/onsite, relocation, locations, company size, dealbreakers" },
  { k: "extraNotes", l: "Extra notes / standard answers", t: "area", full: true,
    hint: "e.g. 'How did you hear about us: LinkedIn', gender/ethnicity/disability answers (or 'prefer not to say'), references, anything forms often ask" },
  { k: "cvText", l: "CV content (paste full text)", t: "big", full: true },
];

const MAX_CV_BYTES = 5 * 1024 * 1024;
let state = { settings: { provider: "gemini" }, profiles: { Default: {} }, activeProfile: "Default" };
let shownProfile = "Default";
let currentCvFile = null;

function buildForm() {
  const form = $("form");
  FIELDS.forEach((f) => {
    const wrap = document.createElement("div");
    if (f.full) wrap.style.gridColumn = "1 / -1";
    const lab = document.createElement("label");
    lab.textContent = f.l + " ";
    if (f.hint) {
      const h = document.createElement("span");
      h.className = "hint";
      h.textContent = f.hint;
      lab.appendChild(h);
    }
    const input = document.createElement(f.t ? "textarea" : "input");
    if (!f.t) input.type = "text";
    if (f.t === "big") input.className = "big";
    input.dataset.k = f.k;
    wrap.append(lab, input);
    form.appendChild(wrap);
  });
}

function formatBytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function renderCvFile(file) {
  currentCvFile = file || null;
  const status = $("cvFileStatus");
  const clearBtn = $("clearCvFile");
  if (currentCvFile && currentCvFile.name) {
    status.textContent = `Attached: ${currentCvFile.name} (${formatBytes(currentCvFile.size)})`;
    clearBtn.disabled = false;
  } else {
    status.textContent = "No CV file attached to this profile.";
    clearBtn.disabled = true;
  }
  $("cvFileInput").value = "";
}

function readForm() {
  const p = {};
  document.querySelectorAll("[data-k]").forEach((el) => (p[el.dataset.k] = el.value));
  if (currentCvFile) p.cvFile = { ...currentCvFile };
  p.savedAnswers = readAnswers();
  return p;
}

function writeForm(p) {
  document.querySelectorAll("[data-k]").forEach((el) => (el.value = p[el.dataset.k] || ""));
  renderCvFile(p.cvFile || null);
  renderAnswers(p.savedAnswers || []);
}

function renderProfileSelect() {
  const sel = $("profileSel");
  sel.innerHTML = "";
  Object.keys(state.profiles).forEach((n) => {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
    if (n === shownProfile) o.selected = true;
    sel.appendChild(o);
  });
}

function showProviderBlocks() {
  const p = $("provider").value;
  ["gemini", "deepseek", "custom"].forEach((n) => ($("p-" + n).style.opacity = n === p ? "1" : ".5"));
}

function readSettings() {
  const s = { provider: $("provider").value };
  s.gemini = { key: $("gemini-key").value.trim(), model: $("gemini-model").value.trim() };
  s.deepseek = { key: $("deepseek-key").value.trim(), model: $("deepseek-model").value.trim() };
  s.custom = {
    baseUrl: $("custom-baseUrl").value.trim(),
    key: $("custom-key").value.trim(),
    model: $("custom-model").value.trim(),
  };
  return s;
}

function writeSettings(s) {
  $("provider").value = s.provider || "gemini";
  $("gemini-key").value = s.gemini?.key || "";
  $("gemini-model").value = s.gemini?.model || "gemini-2.5-flash";
  $("deepseek-key").value = s.deepseek?.key || "";
  $("deepseek-model").value = s.deepseek?.model || "deepseek-chat";
  $("custom-baseUrl").value = s.custom?.baseUrl || "";
  $("custom-key").value = s.custom?.key || "";
  $("custom-model").value = s.custom?.model || "";
  showProviderBlocks();
}

async function load() {
  buildForm();
  const d = await api.storage.local.get(["settings", "profiles", "activeProfile", "savedAnswers"]);
  if (d.settings) state.settings = d.settings;
  if (d.profiles && Object.keys(d.profiles).length) state.profiles = d.profiles;
  // Migrate legacy global savedAnswers into profiles that do not yet have per-profile answers.
  if (Array.isArray(d.savedAnswers) && d.savedAnswers.length) {
    Object.keys(state.profiles).forEach((name) => {
      if (!Array.isArray(state.profiles[name].savedAnswers)) {
        state.profiles[name].savedAnswers = d.savedAnswers.map((a) => ({ ...a }));
      }
    });
  }
  state.activeProfile = d.activeProfile && state.profiles[d.activeProfile] ? d.activeProfile : Object.keys(state.profiles)[0];
  shownProfile = state.activeProfile;
  writeSettings(state.settings);
  renderProfileSelect();
  writeForm(state.profiles[shownProfile]);
}

// ---------- saved answers ----------
function answerRow(a) {
  const row = document.createElement("div");
  row.className = "ans";
  row.style.cssText = "display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:start";
  const q = document.createElement("input");
  q.type = "text";
  q.placeholder = "Question / field label";
  q.value = a.label || "";
  q.dataset.role = "label";
  const v = document.createElement("textarea");
  v.placeholder = "Your answer";
  v.value = a.value || "";
  v.dataset.role = "value";
  v.style.minHeight = "36px";
  const del = document.createElement("button");
  del.textContent = "Delete";
  del.onclick = () => row.remove();
  row.append(q, v, del);
  return row;
}

function renderAnswers(list) {
  $("answers").innerHTML = "";
  list.forEach((a) => $("answers").appendChild(answerRow(a)));
}

function readAnswers() {
  return [...document.querySelectorAll("#answers .ans")]
    .map((row) => ({
      label: row.querySelector("[data-role=label]").value.trim(),
      value: row.querySelector("[data-role=value]").value.trim(),
    }))
    .filter((a) => a.label && a.value);
}

$("cvFileInput").onchange = () => {
  const file = $("cvFileInput").files?.[0];
  if (!file) return;
  if (file.size > MAX_CV_BYTES) {
    alert(`CV file is too large (${formatBytes(file.size)}). Maximum allowed is 5 MB.`);
    $("cvFileInput").value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const res = String(reader.result || "");
    const idx = res.indexOf(",");
    const data = idx >= 0 ? res.slice(idx + 1) : res;
    renderCvFile({ name: file.name, type: file.type || "application/pdf", size: file.size, data });
  };
  reader.onerror = () => alert("Could not read the selected file.");
  reader.readAsDataURL(file);
};

$("clearCvFile").onclick = () => renderCvFile(null);

$("addAnswer").onclick = () => $("answers").appendChild(answerRow({}));

$("provider").onchange = showProviderBlocks;

$("profileSel").onchange = () => {
  state.profiles[shownProfile] = readForm();
  shownProfile = $("profileSel").value;
  state.activeProfile = shownProfile;
  writeForm(state.profiles[shownProfile]);
};

$("newP").onclick = () => {
  const name = (prompt("Name for the new profile (e.g. Dev roles, Support roles):") || "").trim();
  if (!name || state.profiles[name]) return;
  state.profiles[shownProfile] = readForm();
  state.profiles[name] = { savedAnswers: [] };
  shownProfile = name;
  state.activeProfile = name;
  renderProfileSelect();
  writeForm(state.profiles[name]);
};

$("delP").onclick = () => {
  const names = Object.keys(state.profiles);
  if (names.length < 2) return alert("You need at least one profile.");
  if (!confirm(`Delete profile "${shownProfile}"?`)) return;
  delete state.profiles[shownProfile];
  shownProfile = Object.keys(state.profiles)[0];
  state.activeProfile = shownProfile;
  renderProfileSelect();
  writeForm(state.profiles[shownProfile]);
};

$("save").onclick = async () => {
  state.profiles[shownProfile] = readForm();
  state.settings = readSettings();
  state.activeProfile = shownProfile;

  // Custom provider hosts need an explicit permission grant (must happen in this click).
  if (state.settings.provider === "custom" && state.settings.custom.baseUrl) {
    try {
      const origin = new URL(state.settings.custom.baseUrl).origin + "/*";
      const ok = await api.permissions.request({ origins: [origin] });
      if (!ok) {
        $("msg").style.color = "#d33";
        $("msg").textContent = "Saved, but access to the custom URL was not granted.";
      }
    } catch (e) {
      $("msg").textContent = "Saved, but the custom base URL looks invalid.";
    }
  }

  await api.storage.local.set({
    settings: state.settings,
    profiles: state.profiles,
    activeProfile: state.activeProfile,
  });
  await api.storage.local.remove("savedAnswers");
  if (!$("msg").textContent) {
    $("msg").style.color = "#2e9e5b";
    $("msg").textContent = "Saved.";
  }
  setTimeout(() => ($("msg").textContent = ""), 3000);
};

load();
