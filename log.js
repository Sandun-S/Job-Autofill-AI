const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const STATUSES = ["In progress", "Applied", "Interview", "Offer", "Rejected", "Withdrawn"];

let apps = [];

async function load() {
  const d = await api.storage.local.get("applications");
  apps = d.applications || [];
  render();
}

async function save() {
  await api.storage.local.set({ applications: apps });
}

function safeHref(u) {
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch (e) {
    return null;
  }
}

function textInput(value, onChange) {
  const i = document.createElement("input");
  i.type = "text";
  i.value = value || "";
  i.onchange = () => onChange(i.value);
  return i;
}

function render() {
  const q = $("q").value.trim().toLowerCase();
  const sf = $("statusFilter").value;

  // summary
  const counts = {};
  apps.forEach((a) => (counts[a.status] = (counts[a.status] || 0) + 1));
  $("summary").textContent =
    `${apps.length} total` + STATUSES.filter((s) => counts[s]).map((s) => ` · ${s}: ${counts[s]}`).join("");

  const rows = $("rows");
  rows.innerHTML = "";
  const shown = apps.filter(
    (a) =>
      (!sf || a.status === sf) &&
      (!q || [a.title, a.company, a.notes, a.url].some((v) => String(v || "").toLowerCase().includes(q)))
  );
  $("empty").hidden = apps.length > 0;

  shown.forEach((a) => {
    const tr = document.createElement("tr");

    const tdDate = document.createElement("td");
    tdDate.className = "nowrap";
    tdDate.textContent = new Date(a.appliedAt || a.createdAt).toLocaleDateString();

    const tdRole = document.createElement("td");
    tdRole.appendChild(textInput(a.title, (v) => { a.title = v; save(); }));

    const tdCo = document.createElement("td");
    tdCo.appendChild(textInput(a.company, (v) => { a.company = v; save(); }));

    const tdSt = document.createElement("td");
    const sel = document.createElement("select");
    STATUSES.forEach((s) => {
      const o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      if (s === a.status) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = async () => {
      a.status = sel.value;
      if (a.status === "Applied" && !a.appliedAt) a.appliedAt = new Date().toISOString();
      a.updatedAt = new Date().toISOString();
      await save();
      render();
    };
    tdSt.appendChild(sel);

    const tdLink = document.createElement("td");
    tdLink.className = "nowrap";
    const href = safeHref(a.url);
    if (href) {
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = new URL(href).hostname.replace(/^www\./, "");
      tdLink.appendChild(link);
    }

    const tdNotes = document.createElement("td");
    const ta = document.createElement("textarea");
    ta.value = a.notes || "";
    ta.onchange = () => { a.notes = ta.value; save(); };
    tdNotes.appendChild(ta);

    const tdDel = document.createElement("td");
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.onclick = async () => {
      if (!confirm("Delete this entry?")) return;
      apps = apps.filter((x) => x.id !== a.id);
      await save();
      render();
    };
    tdDel.appendChild(del);

    tr.append(tdDate, tdRole, tdCo, tdSt, tdLink, tdNotes, tdDel);
    rows.appendChild(tr);
  });
}

function csvCell(v) {
  return '"' + String(v ?? "").replace(/"/g, '""') + '"';
}

$("export").onclick = () => {
  const head = ["Date", "Role", "Company", "Status", "Link", "Notes"];
  const lines = [head.map(csvCell).join(",")].concat(
    apps.map((a) =>
      [new Date(a.appliedAt || a.createdAt).toISOString().slice(0, 10), a.title, a.company, a.status, a.url, a.notes]
        .map(csvCell)
        .join(",")
    )
  );
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "applications.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const all = document.createElement("option");
all.value = "";
all.textContent = "All statuses";
$("statusFilter").appendChild(all);
STATUSES.forEach((s) => {
  const o = document.createElement("option");
  o.value = s;
  o.textContent = s;
  $("statusFilter").appendChild(o);
});
$("q").oninput = render;
$("statusFilter").onchange = render;
window.addEventListener("focus", load);
load();
