const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);

const DEFAULT_CAREER_URLS = [
  "https://surge.global/careers/",
  "https://lseg.wd3.myworkdayjobs.com/Careers",
  "https://choreolabs.com/careers",
  "https://www.ifs.com/en/about/careers",
  "https://99x.io/careers/open-positions?location=sri-lanka",
  "https://www.axiatadigitallabs.com/adl-careers/",
  "https://www.senzmate.com/careers/",
  "https://www.ncinga.net/careers-people/",
  "https://rootcode.ai/careers",
  "https://pickme.lk/careers/",
];

let pages = [];
let opportunities = [];
let applications = [];
let scanning = false;
let stopRequested = false;

function normUrl(u) {
  return String(u || "").trim().split("#")[0].replace(/\/+$/, "").toLowerCase();
}

function safeHref(u) {
  try {
    const url = new URL(String(u || "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch (e) {
    return null;
  }
}

function guessCompany(u) {
  try {
    const host = new URL(u).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    const main = parts.length >= 2 ? parts[0] : host;
    return main.charAt(0).toUpperCase() + main.slice(1);
  } catch (e) {
    return "";
  }
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function setStatus(msg, isErr = false) {
  const el = $("scanStatus");
  el.textContent = msg || "";
  el.className = isErr ? "err" : "hint";
}

function textInput(value, onChange) {
  const i = document.createElement("input");
  i.type = "text";
  i.value = value || "";
  i.onchange = () => onChange(i.value);
  return i;
}

async function savePages() {
  await api.storage.local.set({ careerPages: pages });
}

async function saveOpportunities() {
  await api.storage.local.set({ opportunities });
}

function addUrls(rawUrls, explicitCompany = "") {
  const existing = new Set(pages.map((p) => normUrl(p.url)));
  const now = new Date().toISOString();
  let added = 0;

  for (const raw of rawUrls) {
    const href = safeHref(raw);
    if (!href) continue;
    const key = normUrl(href);
    if (existing.has(key)) continue;
    existing.add(key);
    pages.push({
      id: makeId(),
      company: explicitCompany.trim() || guessCompany(href),
      url: href,
      notes: "",
      lastCheckedAt: "",
      lastFoundCount: 0,
      createdAt: now,
    });
    added++;
  }
  return added;
}

async function load() {
  const d = await api.storage.local.get([
    "careerPages",
    "opportunities",
    "applications",
    "profiles",
    "activeProfile",
  ]);

  if (d.careerPages === undefined) {
    pages = [];
    addUrls(DEFAULT_CAREER_URLS);
    await savePages();
  } else {
    pages = Array.isArray(d.careerPages) ? d.careerPages : [];
  }

  opportunities = Array.isArray(d.opportunities) ? d.opportunities : [];
  applications = Array.isArray(d.applications) ? d.applications : [];

  const profiles = d.profiles || {};
  const names = Object.keys(profiles);
  const sel = $("profileSel");
  sel.innerHTML = "";
  names.forEach((n) => {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
    if (n === d.activeProfile) o.selected = true;
    sel.appendChild(o);
  });
  if (!names.length) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "(No profile yet)";
    sel.appendChild(o);
  }

  render();
}

function renderPages() {
  const q = $("q").value.trim().toLowerCase();
  $("pageSummary").textContent = `(${pages.length} saved)`;

  const tbody = $("pageRows");
  tbody.innerHTML = "";

  const shown = pages.filter(
    (p) =>
      !q ||
      [p.company, p.url, p.notes].some((v) => String(v || "").toLowerCase().includes(q))
  );

  $("pageEmpty").hidden = pages.length > 0;

  shown.forEach((p) => {
    const tr = document.createElement("tr");

    const tdCo = document.createElement("td");
    tdCo.appendChild(
      textInput(p.company, (v) => {
        p.company = v;
        savePages();
      })
    );

    const tdUrl = document.createElement("td");
    const urlWrap = document.createElement("div");
    urlWrap.style.display = "flex";
    urlWrap.style.gap = "6px";
    urlWrap.style.alignItems = "center";

    const urlInput = textInput(p.url, (v) => {
      const href = safeHref(v);
      if (href) {
        p.url = href;
        savePages();
        renderPages();
      } else {
        urlInput.value = p.url;
      }
    });
    urlInput.style.flex = "1";
    urlWrap.appendChild(urlInput);

    const href = safeHref(p.url);
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "nowrap";
      a.textContent = "Open ↗";
      urlWrap.appendChild(a);
    }
    tdUrl.appendChild(urlWrap);

    const tdNotes = document.createElement("td");
    const ta = document.createElement("textarea");
    ta.value = p.notes || "";
    ta.onchange = () => {
      p.notes = ta.value;
      savePages();
    };
    tdNotes.appendChild(ta);

    const tdChecked = document.createElement("td");
    tdChecked.className = "nowrap hint";
    tdChecked.textContent = p.lastCheckedAt
      ? `${new Date(p.lastCheckedAt).toLocaleDateString()} (${p.lastFoundCount || 0})`
      : "Never";

    const tdAct = document.createElement("td");
    tdAct.className = "nowrap";
    const scanOne = document.createElement("button");
    scanOne.textContent = "Scan";
    scanOne.disabled = scanning;
    scanOne.onclick = () => runScan([p]);

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.style.marginLeft = "4px";
    del.disabled = scanning;
    del.onclick = async () => {
      if (!confirm(`Remove ${p.company || p.url}?`)) return;
      pages = pages.filter((x) => x.id !== p.id);
      opportunities = opportunities.filter((o) => o.careerPageId !== p.id);
      await Promise.all([savePages(), saveOpportunities()]);
      render();
    };
    tdAct.append(scanOne, del);

    tr.append(tdCo, tdUrl, tdNotes, tdChecked, tdAct);
    tbody.appendChild(tr);
  });
}

function renderOpportunities() {
  const table = $("oppTable");
  const tbody = $("oppRows");
  const empty = $("oppEmpty");
  tbody.innerHTML = "";

  if (!opportunities.length) {
    table.hidden = true;
    empty.hidden = false;
    return;
  }

  table.hidden = false;
  empty.hidden = true;

  const loggedUrls = new Set(applications.map((a) => normUrl(a.url)));

  opportunities.forEach((o) => {
    const tr = document.createElement("tr");

    const tdRole = document.createElement("td");
    tdRole.innerHTML = "";
    const titleEl = document.createElement("strong");
    titleEl.textContent = o.title || "(untitled role)";
    tdRole.appendChild(titleEl);
    if (o.reason) {
      const reasonEl = document.createElement("div");
      reasonEl.className = "hint";
      reasonEl.textContent = o.reason;
      tdRole.appendChild(reasonEl);
    }

    const tdCo = document.createElement("td");
    tdCo.textContent = o.company || "";

    const tdMatch = document.createElement("td");
    tdMatch.className = "nowrap";
    const badge = document.createElement("span");
    const lvl = String(o.match || "medium").toLowerCase() === "high" ? "high" : "medium";
    badge.className = `badge ${lvl}`;
    badge.textContent = lvl;
    tdMatch.appendChild(badge);

    const tdApply = document.createElement("td");
    tdApply.className = "nowrap";
    const href = safeHref(o.applyUrl);
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Apply / View ↗";
      tdApply.appendChild(a);
    }

    const tdLog = document.createElement("td");
    tdLog.className = "nowrap";
    const btn = document.createElement("button");
    const alreadyLogged = href && loggedUrls.has(normUrl(href));
    btn.textContent = alreadyLogged ? "Logged ✓" : "Add to log";
    btn.disabled = alreadyLogged;
    btn.onclick = async () => {
      const { applications: curApps = [] } = await api.storage.local.get("applications");
      const urlToLog = href || o.applyUrl;
      if (!curApps.some((a) => normUrl(a.url) === normUrl(urlToLog))) {
        const now = new Date().toISOString();
        curApps.unshift({
          id: makeId(),
          url: urlToLog,
          title: o.title || "(untitled)",
          company: o.company || "",
          status: "In progress",
          createdAt: now,
          appliedAt: "",
          notes: o.reason ? `AI match (${o.match || "medium"}): ${o.reason}` : "",
          updatedAt: now,
        });
        await api.storage.local.set({ applications: curApps });
        applications = curApps;
      }
      renderOpportunities();
    };
    tdLog.appendChild(btn);

    tr.append(tdRole, tdCo, tdMatch, tdApply, tdLog);
    tbody.appendChild(tr);
  });
}

function render() {
  renderOpportunities();
  renderPages();
}

function setScanningUI(active) {
  scanning = active;
  $("findBtn").disabled = active;
  $("stopBtn").hidden = !active;
  $("clearOppBtn").disabled = active;
  $("addBtn").disabled = active;
  renderPages();
}

async function runScan(targetPages) {
  if (scanning || !targetPages.length) return;
  const profileName = $("profileSel").value;
  if (!profileName) {
    setStatus("Please create a profile in Settings / profile first.", true);
    return;
  }

  stopRequested = false;
  setScanningUI(true);

  const scanningAll = targetPages.length === pages.length;
  if (scanningAll) {
    opportunities = [];
    await saveOpportunities();
    renderOpportunities();
  } else {
    const ids = new Set(targetPages.map((p) => p.id));
    opportunities = opportunities.filter((o) => !ids.has(o.careerPageId));
  }

  let totalFound = 0;
  let errors = 0;

  try {
    for (let i = 0; i < targetPages.length; i++) {
      if (stopRequested) {
        setStatus(`Stopped after ${i} of ${targetPages.length} page(s). Found ${totalFound} role(s).`);
        break;
      }

      const p = targetPages[i];
      setStatus(`Scanning ${i + 1} / ${targetPages.length}: ${p.company || p.url}...`);

      try {
        const res = await api.runtime.sendMessage({
          type: "scanCareerPage",
          url: p.url,
          company: p.company,
          profileName,
        });

        if (!res || res.error) {
          throw new Error(res?.error || "Scan failed.");
        }

        const roles = Array.isArray(res.roles) ? res.roles : [];
        p.lastCheckedAt = res.scannedAt || new Date().toISOString();
        p.lastFoundCount = roles.length;
        await savePages();

        roles.forEach((r) => {
          opportunities.push({
            id: makeId(),
            careerPageId: p.id,
            company: p.company || guessCompany(p.url),
            title: r.title,
            applyUrl: safeHref(r.applyUrl) || p.url,
            match: r.match === "high" ? "high" : "medium",
            reason: r.reason || "",
            foundAt: p.lastCheckedAt,
          });
        });

        totalFound += roles.length;
        await saveOpportunities();
        render();
      } catch (e) {
        errors++;
        setStatus(`Error on ${p.company || p.url}: ${e.message || e}`, true);
      }
    }

    if (!stopRequested) {
      setStatus(
        `Done. Scanned ${targetPages.length} page(s), found ${totalFound} applicable role(s)` +
          (errors ? ` (${errors} error(s)).` : "."),
        errors > 0 && totalFound === 0
      );
    }
  } finally {
    setScanningUI(false);
  }
}

$("addBtn").onclick = async () => {
  const url = $("newUrl").value.trim();
  const company = $("newCompany").value.trim();
  if (!safeHref(url)) {
    setStatus("Please enter a valid http:// or https:// URL.", true);
    return;
  }
  const added = addUrls([url], company);
  if (!added) {
    setStatus("That career page URL is already in your list.");
    return;
  }
  $("newUrl").value = "";
  $("newCompany").value = "";
  await savePages();
  renderPages();
  setStatus("Career page added.");
};

$("toggleBulkBtn").onclick = () => {
  $("bulkBox").hidden = !$("bulkBox").hidden;
};

$("bulkCancelBtn").onclick = () => {
  $("bulkBox").hidden = true;
};

$("bulkAddBtn").onclick = async () => {
  const raw = $("bulkUrls").value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const added = addUrls(raw);
  $("bulkUrls").value = "";
  $("bulkBox").hidden = true;
  await savePages();
  renderPages();
  setStatus(`Added ${added} new career page(s).`);
};

$("findBtn").onclick = () => runScan([...pages]);
$("stopBtn").onclick = () => {
  stopRequested = true;
  $("stopBtn").disabled = true;
  setStatus("Stopping after current page...");
};

$("clearOppBtn").onclick = async () => {
  opportunities = [];
  await saveOpportunities();
  renderOpportunities();
  setStatus("Cleared results.");
};

$("q").oninput = renderPages;
window.addEventListener("focus", () => {
  if (!scanning) load();
});

load();
