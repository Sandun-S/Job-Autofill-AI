// Injected on demand into every frame of the active tab (see popup.js).
// Defines window.__jaf with scan(), fill(values) and clickNext().
(() => {
  if (window.__jaf) return;

  const frameKey = Math.random().toString(36).slice(2, 6);
  let counter = 0;
  const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "password", "file", "search"]);
  const KEYCODES = { ArrowDown: 40, Escape: 27, Enter: 13 };

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const cut = (s, n) => (s.length > n ? s.slice(0, n) : s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }

  function idsText(attr) {
    return clean(
      attr
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
    );
  }

  function ancestorLabel(el) {
    let node = el.parentElement;
    for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
      if (node.tagName === "FIELDSET") {
        const lg = node.querySelector("legend");
        if (lg && clean(lg.textContent)) return clean(lg.textContent);
      }
      const cand = node.querySelector("label, legend, [class*='label' i], [class*='question' i]");
      if (cand && !cand.contains(el)) {
        const t = clean(cand.textContent);
        if (t) return t;
      }
    }
    return "";
  }

  function labelFor(el) {
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = idsText(lb);
      if (t) return t;
    }
    if (el.labels && el.labels.length) {
      const t = clean([...el.labels].map((l) => l.textContent).join(" "));
      if (t) return t;
    }
    const al = clean(el.getAttribute("aria-label"));
    if (al) return al;
    const wrap = el.closest("label");
    if (wrap) {
      const t = clean(wrap.textContent);
      if (t) return t;
    }
    const anc = ancestorLabel(el);
    if (anc) return anc;
    return clean(el.getAttribute("placeholder")) || clean(el.getAttribute("name")) || "";
  }

  function optionLabel(el) {
    if (el.labels && el.labels.length) return clean(el.labels[0].textContent);
    const wrap = el.closest("label");
    if (wrap) return clean(wrap.textContent);
    const al = clean(el.getAttribute("aria-label"));
    if (al) return al;
    return clean(el.nextSibling?.textContent) || el.value;
  }

  function groupLabel(el) {
    const fs = el.closest("fieldset");
    if (fs) {
      const lg = fs.querySelector("legend");
      if (lg && clean(lg.textContent)) return clean(lg.textContent);
    }
    const rg = el.closest("[role='radiogroup'], [role='group']");
    if (rg) {
      const lb = rg.getAttribute("aria-labelledby");
      if (lb && idsText(lb)) return idsText(lb);
      const al = clean(rg.getAttribute("aria-label"));
      if (al) return al;
    }
    return ancestorLabel(el) || clean(el.getAttribute("name"));
  }

  function tag(el) {
    if (!el.dataset.jafId) el.dataset.jafId = `${frameKey}-${++counter}`;
    return el.dataset.jafId;
  }

  // ---------- custom dropdowns (react-select, Greenhouse, etc.) ----------
  function key(el, k) {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, code: k, keyCode: KEYCODES[k], which: KEYCODES[k], bubbles: true, cancelable: true })
    );
  }

  function comboOptionEls(el) {
    const id = el.getAttribute("aria-controls");
    const lb = id && document.getElementById(id);
    return [...(lb || document).querySelectorAll("[role='option']")];
  }

  async function readComboOptions(el) {
    el.focus();
    key(el, "ArrowDown");
    await sleep(200);
    const labels = comboOptionEls(el)
      .map((o) => clean(o.textContent))
      .filter(Boolean);
    key(el, "Escape");
    el.blur();
    return labels.slice(0, 80);
  }

  async function fillCombo(el, value) {
    const v = clean(String(value)).toLowerCase();
    el.focus();
    key(el, "ArrowDown");
    await sleep(200);
    setNative(el, clean(String(value)));
    fire(el, ["input"]);
    let hit = null;
    for (let i = 0; i < 8 && !hit; i++) {
      await sleep(300);
      const opts = comboOptionEls(el);
      hit =
        opts.find((o) => clean(o.textContent).toLowerCase() === v) ||
        opts.find((o) => clean(o.textContent).toLowerCase().startsWith(v)) ||
        opts.find((o) => clean(o.textContent).toLowerCase().includes(v)) ||
        null;
    }
    if (!hit) {
      setNative(el, "");
      fire(el, ["input"]);
      key(el, "Escape");
      el.blur();
      return false;
    }
    hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    hit.click();
    await sleep(100);
    el.blur();
    return true;
  }

  // ---------- scan ----------
  async function scan() {
    const fields = [];
    const seenRadioGroups = new Set();
    const combos = [];

    document.querySelectorAll("input, textarea, select").forEach((el) => {
      if (el.disabled) return;
      if (el.closest("footer, nav, header")) return; // newsletter/search/login boxes
      const tagName = el.tagName.toLowerCase();
      const type = tagName === "input" ? (el.type || "text").toLowerCase() : tagName;
      const isCombo = tagName === "input" && el.getAttribute("role") === "combobox";
      if (el.readOnly && !isCombo) return;
      if (SKIP_TYPES.has(type)) return;

      if (isCombo) {
        if (!isVisible(el)) return;
        el.dataset.jafCombo = "1";
        const f = {
          id: tag(el),
          type: "dropdown",
          label: cut(labelFor(el), 250),
          required: el.required || el.getAttribute("aria-required") === "true",
        };
        fields.push(f);
        combos.push([el, f]);
        return;
      }

      if (type === "radio") {
        const scope = el.form || document;
        const key2 = (el.form ? "f:" : "d:") + (el.name || tag(el));
        if (el.name && seenRadioGroups.has(key2)) return;
        seenRadioGroups.add(key2);
        const radios = el.name
          ? [...scope.querySelectorAll("input[type=radio]")].filter((r) => r.name === el.name && !r.disabled)
          : [el];
        fields.push({
          id: tag(el),
          type: "radio",
          label: cut(groupLabel(el), 250),
          options: radios.map((r) => ({ value: r.value, label: cut(optionLabel(r), 120) })),
          required: radios.some((r) => r.required),
        });
        return;
      }

      if (type === "checkbox") {
        if (!isVisible(el) && !el.labels?.length) return;
        fields.push({
          id: tag(el),
          type: "checkbox",
          label: cut(optionLabel(el) || labelFor(el), 250),
          group: cut(ancestorLabel(el), 200),
          required: el.required,
          current: el.checked,
        });
        return;
      }

      if (!isVisible(el)) return;

      const f = {
        id: tag(el),
        type,
        label: cut(labelFor(el), 250),
        placeholder: clean(el.getAttribute("placeholder")),
        required: el.required || el.getAttribute("aria-required") === "true",
        current: el.value || "",
      };
      if (tagName === "select") {
        f.options = [...el.options]
          .filter((o) => o.value !== "" || clean(o.textContent))
          .map((o) => ({ value: o.value, label: cut(clean(o.textContent), 120) }));
      }
      if (tagName === "textarea" && el.maxLength > 0) f.maxLength = el.maxLength;
      fields.push(f);
    });

    // Read the real choices of custom dropdowns (one at a time)
    for (const [el, f] of combos.slice(0, 25)) {
      try {
        const labels = await readComboOptions(el);
        if (labels.length) f.options = labels.map((l) => ({ value: l, label: l }));
        else f.searchable = true; // type-to-search box (e.g. city autocomplete)
      } catch (e) {
        f.searchable = true;
      }
    }

    let jobText = "";
    if (window === window.top) {
      const root = document.querySelector("main, article, [role='main']") || document.body;
      jobText = cut(clean(root.innerText || ""), 6000);
    }
    return { url: location.href, title: document.title, jobText, fields };
  }

  // ---------- filling ----------
  function fire(el, types) {
    types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true, cancelable: true })));
  }

  function setNative(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function mark(el) {
    try {
      el.style.outline = "2px solid #2e9e5b";
      el.style.outlineOffset = "1px";
    } catch (e) {}
  }

  async function fillOne(el, value) {
    const tagName = el.tagName.toLowerCase();
    const type = tagName === "input" ? (el.type || "text").toLowerCase() : tagName;

    if (el.dataset.jafCombo) {
      const ok = await fillCombo(el, value);
      if (ok) mark(el.closest("[class*='control' i]") || el);
      return ok;
    }

    if (type === "checkbox") {
      const want = value === true || String(value).toLowerCase() === "true";
      if (el.checked !== want) el.click();
      mark(el);
      return true;
    }

    if (type === "radio") {
      const scope = el.form || document;
      const radios = el.name
        ? [...scope.querySelectorAll("input[type=radio]")].filter((r) => r.name === el.name)
        : [el];
      const v = clean(String(value)).toLowerCase();
      const hit =
        radios.find((r) => r.value.toLowerCase() === v) ||
        radios.find((r) => optionLabel(r).toLowerCase() === v) ||
        radios.find((r) => optionLabel(r).toLowerCase().includes(v));
      if (!hit) return false;
      hit.click();
      mark(hit);
      return true;
    }

    if (type === "select") {
      const v = clean(String(value)).toLowerCase();
      const opts = [...el.options];
      const hit =
        opts.find((o) => o.value.toLowerCase() === v) ||
        opts.find((o) => clean(o.textContent).toLowerCase() === v) ||
        opts.find((o) => clean(o.textContent).toLowerCase().includes(v));
      if (!hit) return false;
      el.focus();
      setNative(el, hit.value);
      fire(el, ["input", "change"]);
      mark(el);
      return true;
    }

    el.focus();
    setNative(el, String(value));
    fire(el, ["input", "change"]);
    el.blur();
    mark(el);
    return true;
  }

  async function fill(values) {
    const filled = [];
    const failed = [];
    for (const [id, value] of Object.entries(values || {})) {
      if (!id.startsWith(frameKey + "-")) continue; // belongs to another frame
      const el = document.querySelector(`[data-jaf-id="${id}"]`);
      if (!el) {
        failed.push(id);
        continue;
      }
      try {
        ((await fillOne(el, value)) ? filled : failed).push(id);
      } catch (e) {
        failed.push(id);
      }
    }
    return { filled, failed };
  }

  // Clicks a Next/Continue button. Never clicks anything that looks like Submit/Apply.
  function clickNext() {
    const nextRe = /^(next|continue|next step|save (and|&) continue|save (and|&) next|proceed)\b/i;
    const badRe = /submit|apply|send|finish|confirm|place order|review/i;
    const btns = [
      ...document.querySelectorAll("button, input[type=button], input[type=submit], a[role=button], [role=button]"),
    ];
    for (const b of btns) {
      if (b.disabled || !isVisible(b)) continue;
      const text = clean(b.innerText || b.value || b.getAttribute("aria-label"));
      if (nextRe.test(text) && !badRe.test(text)) {
        b.click();
        return text;
      }
    }
    return null;
  }

  window.__jaf = { scan, fill, clickNext };
})();
