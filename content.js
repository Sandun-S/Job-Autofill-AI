// Injected on demand into every frame of the active tab (see popup.js).
// Defines window.__jaf with scan(), fill(values) and clickNext().
(() => {
  if (window.__jaf) return;

  const frameKey = Math.random().toString(36).slice(2, 6);
  let counter = 0;
  const fieldEls = new Map();
  const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "password", "search"]);
  const KEYCODES = { ArrowDown: 40, Escape: 27, Enter: 13 };

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const cut = (s, n) => (s.length > n ? s.slice(0, n) : s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function shadowHost(el) {
    const root = el?.getRootNode?.();
    return root instanceof ShadowRoot ? root.host : null;
  }

  function parentDeep(node) {
    if (!node) return null;
    return node.parentElement || shadowHost(node);
  }

  function closestDeep(el, selector) {
    for (let node = el; node; node = parentDeep(node)) {
      if (node.nodeType === 1 && node.matches(selector)) return node;
    }
    return null;
  }

  function containsDeep(container, target) {
    for (let node = target; node; node = parentDeep(node)) {
      if (node === container) return true;
    }
    return false;
  }

  function queryAllDeep(selector, root = document) {
    const out = [];
    const walk = (node) => {
      if (!node || !node.querySelectorAll) return;
      for (const el of node.querySelectorAll("*")) {
        if (el.matches(selector)) out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(root);
    return out;
  }

  function getByIdDeep(id, el) {
    if (!id) return null;
    for (let node = el; node; node = shadowHost(node)) {
      const root = node.getRootNode?.();
      if (root && typeof root.getElementById === "function") {
        const found = root.getElementById(id);
        if (found) return found;
      }
      if (!root || root === document) break;
    }
    return document.getElementById(id);
  }

  function deepText(node) {
    if (!node) return "";
    if (node.nodeType === 3) return node.textContent || "";
    if (node.nodeType !== 1) return "";
    if (node.tagName === "SLOT") {
      return node.assignedNodes({ flatten: true }).map(deepText).join("");
    }
    let s = "";
    for (const ch of node.childNodes) s += deepText(ch);
    return s;
  }

  function isVisible(el) {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }

  function idsText(attr, el) {
    return clean(
      attr
        .split(/\s+/)
        .map((id) => deepText(getByIdDeep(id, el)))
        .join(" ")
    );
  }

  function ancestorLabel(el) {
    let node = parentDeep(el);
    for (let i = 0; i < 6 && node; i++, node = parentDeep(node)) {
      if (node.tagName === "FIELDSET") {
        const lg = node.querySelector("legend");
        if (lg && clean(deepText(lg))) return clean(deepText(lg));
      }
      const cand = node.querySelector("label, legend, [class*='label' i], [class*='question' i], [data-test='section-title']");
      if (cand && !containsDeep(cand, el)) {
        const t = clean(deepText(cand));
        if (t) return t;
      }
    }
    return "";
  }

  function labelFor(el) {
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = idsText(lb, el);
      if (t) return t;
    }
    if (el.labels && el.labels.length) {
      const t = clean([...el.labels].map((l) => deepText(l)).join(" "));
      if (t) return t;
    }
    const al = clean(el.getAttribute("aria-label"));
    if (al) return al;
    const wrap = el.closest("label");
    if (wrap) {
      const t = clean(deepText(wrap));
      if (t) return t;
    }
    const host = shadowHost(el);
    if (host) {
      const hl = clean(host.getAttribute("label")) || clean(host.getAttribute("aria-label"));
      if (hl) return hl;
      const hlb = host.getAttribute("aria-labelledby");
      if (hlb) {
        const t = idsText(hlb, host);
        if (t) return t;
      }
    }
    const anc = ancestorLabel(el);
    if (anc) return anc;
    return (
      clean(el.getAttribute("placeholder")) ||
      clean(el.getAttribute("name")) ||
      clean(host?.getAttribute("placeholder")) ||
      clean(host?.getAttribute("name")) ||
      ""
    );
  }

  function isRequired(el) {
    if (el.required || el.getAttribute("aria-required") === "true") return true;
    const host = shadowHost(el);
    return !!(host && (host.hasAttribute("required") || host.getAttribute("aria-required") === "true"));
  }

  function optionLabel(el) {
    const lb = el.getAttribute("aria-labelledby");
    if (el.labels && el.labels.length) {
      const t = clean(deepText(el.labels[0]));
      if (t) return t;
    }
    const wrap = el.closest("label");
    if (wrap) {
      const t = clean(deepText(wrap));
      if (t) return t;
    }
    // Visible text comes first: some pages set aria-labelledby on every radio to the
    // QUESTION, which would make all options look identical.
    // Text kept in a neighbouring element (common in React UIs such as LinkedIn)
    for (const s of [el.nextElementSibling, el.previousElementSibling]) {
      if (!s || s.matches("input, select, textarea")) continue;
      const t = clean(deepText(s));
      if (t && t.length <= 120) return t;
    }
    let node = parentDeep(el);
    for (let i = 0; i < 3 && node; i++, node = parentDeep(node)) {
      if (queryAllDeep("input[type=radio], input[type=checkbox]", node).length > 1) break;
      const t = clean(deepText(node));
      if (t && t.length <= 120) return t;
    }
    if (lb) {
      const t = idsText(lb, el);
      if (t) return t;
    }
    const al = clean(el.getAttribute("aria-label"));
    if (al) return al;
    const host = shadowHost(el);
    if (host) {
      const hl = clean(host.getAttribute("label")) || clean(host.getAttribute("aria-label"));
      if (hl) return hl;
    }
    return el.value;
  }

  // The question text sitting above a radio group: the nearest container that holds
  // the radios plus some text that is not one of the option labels.
  function questionText(radios) {
    const opts = new Set(radios.map((r) => optionLabel(r).toLowerCase()));
    let node = parentDeep(radios[0]);
    for (let i = 0; i < 7 && node; i++, node = parentDeep(node)) {
      const parts = [];
      for (const child of node.children) {
        if (radios.some((r) => containsDeep(child, r))) continue;
        if (child.matches("script, style, svg")) continue;
        const t = clean(child.textContent);
        if (t && !opts.has(t.toLowerCase())) parts.push(t);
      }
      if (parts.length) return cut(parts.join(" "), 250);
    }
    return "";
  }

  function groupLabel(el, radios) {
    const fs = closestDeep(el, "fieldset");
    if (fs) {
      const lg = fs.querySelector("legend");
      if (lg && clean(lg.textContent)) return clean(lg.textContent);
    }
    const rg = closestDeep(el, "[role='radiogroup'], [role='group']");
    if (rg) {
      const lb = rg.getAttribute("aria-labelledby");
      if (lb && idsText(lb, rg)) return idsText(lb, rg);
      const al = clean(rg.getAttribute("aria-label"));
      if (al) return al;
    }
    return questionText(radios || [el]) || ancestorLabel(el) || clean(el.getAttribute("name"));
  }

  function tag(el) {
    if (!el.dataset.jafId) el.dataset.jafId = `${frameKey}-${++counter}`;
    fieldEls.set(el.dataset.jafId, el);
    return el.dataset.jafId;
  }

  // ---------- custom dropdowns (react-select, Greenhouse, etc.) ----------
  function key(el, k) {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, code: k, keyCode: KEYCODES[k], which: KEYCODES[k], bubbles: true, cancelable: true, composed: true })
    );
  }

  function comboOptionEls(el) {
    const id = el.getAttribute("aria-controls");
    const lb = id && getByIdDeep(id, el);
    if (lb) return queryAllDeep("[role='option']", lb).filter(isVisible);
    const root = el.getRootNode?.() instanceof ShadowRoot ? el.getRootNode() : document;
    let opts = queryAllDeep("[role='option']", root).filter(isVisible);
    if (!opts.length && root !== document) {
      opts = queryAllDeep("[role='option']", document).filter(isVisible);
    }
    return opts;
  }

  const norm = (s) =>
    clean(String(s))
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .replace(/\s+/g, " ")
      .trim();

  function mouse(el, type) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0 }));
  }

  function comboControl(el) {
    return closestDeep(el, "[class*='control' i], [class*='trigger' i]") || parentDeep(el) || el;
  }

  // Opens the menu the way a real click does (click / mousedown on the input or control), falls back to ArrowDown.
  async function openCombo(el) {
    el.focus();
    if (comboOptionEls(el).length) return true;
    mouse(el, "mousedown");
    mouse(el, "mouseup");
    el.click();
    await sleep(250);
    if (comboOptionEls(el).length) return true;
    const ctrl = comboControl(el);
    if (ctrl && ctrl !== el) {
      mouse(ctrl, "mousedown");
      mouse(ctrl, "mouseup");
      ctrl.click?.();
      await sleep(250);
      if (comboOptionEls(el).length) return true;
    }
    key(el, "ArrowDown");
    await sleep(300);
    return comboOptionEls(el).length > 0;
  }

  function pickOption(opts, value) {
    const v = norm(value);
    if (!v) return null;
    const items = opts.map((o) => ({ o, t: norm(deepText(o)) })).filter((x) => x.t);
    const hit =
      items.find((x) => x.t === v) ||
      items.find((x) => x.t.startsWith(v)) ||
      items.find((x) => x.t.includes(v)) ||
      items.find((x) => x.t.length > 1 && v.includes(x.t));
    if (hit) return hit.o;
    // word-overlap fallback
    const vt = v.split(" ").filter((w) => w.length > 1);
    let best = null;
    let bestScore = 0;
    for (const x of items) {
      const xt = new Set(x.t.split(" "));
      const score = vt.filter((w) => xt.has(w)).length;
      if (score > bestScore) {
        best = x.o;
        bestScore = score;
      }
    }
    return bestScore >= Math.max(1, Math.ceil(vt.length / 2)) ? best : null;
  }

  async function readComboOptions(el) {
    await openCombo(el);
    const labels = comboOptionEls(el)
      .map((o) => clean(deepText(o)))
      .filter(Boolean);
    key(el, "Escape");
    el.blur();
    await sleep(120);
    if (comboOptionEls(el).length && document.body) {
      mouse(document.body, "mousedown");
      mouse(document.body, "mouseup");
      document.body.click();
      await sleep(100);
    }
    return labels.slice(0, 80);
  }

  async function fillCombo(el, value) {
    const text = clean(String(value));
    const opened = await openCombo(el);
    let opts = comboOptionEls(el);
    let hit = pickOption(opts, text);

    if (!hit) {
      // type to filter / search (also covers async autocompletes like City)
      setNative(el, text);
      fire(el, ["input"]);
      for (let i = 0; i < 8 && !hit; i++) {
        await sleep(300);
        opts = comboOptionEls(el);
        hit = pickOption(opts, text);
      }
    }

    if (!hit) {
      const have = comboOptionEls(el)
        .slice(0, 6)
        .map((o) => clean(deepText(o)))
        .join(" | ");
      setNative(el, "");
      fire(el, ["input"]);
      key(el, "Escape");
      el.blur();
      throw new Error(opened || have ? `no option matches "${text}" (options: ${have || "none"})` : "could not open the dropdown");
    }

    const wanted = norm(deepText(hit));
    mouse(hit, "mousedown");
    mouse(hit, "mouseup");
    hit.click();
    await sleep(250);
    // verify; if the menu is still open and the value did not take, press Enter on the focused option
    if (!norm(deepText(comboControl(el))).includes(wanted) && comboOptionEls(el).length) {
      key(el, "Enter");
      await sleep(250);
    }
    el.blur();
    return true;
  }

  // ---------- scan ----------
  async function scan() {
    const fields = [];
    const seenRadioGroups = new Set();
    const combos = [];

    queryAllDeep("input, textarea, select").forEach((el) => {
      if (el.disabled || shadowHost(el)?.hasAttribute("disabled")) return;
      if (closestDeep(el, "footer, nav, header")) return; // newsletter/search/login boxes
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
          required: isRequired(el),
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
          ? queryAllDeep("input[type=radio]", scope).filter((r) => r.name === el.name && !r.disabled)
          : [el];
        fields.push({
          id: tag(el),
          type: "radio",
          label: cut(groupLabel(el, radios), 250),
          options: (() => {
            let labels = radios.map((r) => cut(optionLabel(r), 120));
            // if the options are indistinguishable, fall back to their values
            if (radios.length > 1 && new Set(labels).size < radios.length) {
              labels = radios.map((r, i) => (r.value && r.value !== "on" ? r.value : `Option ${i + 1}`));
            }
            // many UIs give every radio the same generic value ("on"); use the visible text instead
            return radios.map((r, i) => ({ value: r.value && r.value !== "on" ? r.value : labels[i], label: labels[i] }));
          })(),
          required: radios.some((r) => isRequired(r)),
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
          required: isRequired(el),
          current: el.checked,
        });
        return;
      }

      if (type === "file") {
        fields.push({
          id: tag(el),
          type: "file",
          label: cut(labelFor(el) || ancestorLabel(el) || "File upload", 250),
          accept: el.getAttribute("accept") || "",
          required: isRequired(el),
          current: el.files && el.files.length ? el.files[0].name : "",
        });
        return;
      }

      if (!isVisible(el)) return;

      const f = {
        id: tag(el),
        type,
        label: cut(labelFor(el), 250),
        placeholder: clean(el.getAttribute("placeholder") || shadowHost(el)?.getAttribute("placeholder")),
        required: isRequired(el),
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

    // A trailing * in the question text means the field is required (LinkedIn and others)
    fields.forEach((f) => {
      if (!f.required && /\*\s*$/.test(f.label || "")) f.required = true;
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
    types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true, cancelable: true, composed: true })));
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

    if (type === "file") {
      if (!value || typeof value !== "object" || !value.data || !value.name) return false;
      const bin = atob(value.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], value.name, { type: value.type || "application/pdf" });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      fire(el, ["input", "change"]);
      mark(isVisible(el) ? el : shadowHost(el) || parentDeep(el) || el);
      return true;
    }

    if (el.dataset.jafCombo) {
      const ok = await fillCombo(el, value);
      if (ok) mark(el.closest("[class*='control' i]") || shadowHost(el) || el);
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
        ? queryAllDeep("input[type=radio]", scope).filter((r) => r.name === el.name)
        : [el];
      const v = clean(String(value)).toLowerCase();
      const nv = norm(value);
      const hit =
        radios.find((r) => r.value && r.value !== "on" && r.value.toLowerCase() === v) ||
        radios.find((r) => norm(optionLabel(r)) === nv) ||
        radios.find((r) => nv && norm(optionLabel(r)).startsWith(nv)) ||
        radios.find((r) => nv && norm(optionLabel(r)).includes(nv));
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
    const errors = {};
    let matchedFrame = 0;
    const entries = Object.entries(values || {});
    for (const [id, value] of entries) {
      const el = fieldEls.get(id) || (!id.startsWith(frameKey + "-") ? queryAllDeep(`[data-jaf-id="${id}"]`)[0] : null);
      if (!id.startsWith(frameKey + "-") && !el) continue; // belongs to another frame or stale scan
      matchedFrame++;
      if (!el || !el.isConnected) {
        failed.push(id);
        errors[id] = "field no longer on the page (rescan)";
        continue;
      }
      try {
        if (await fillOne(el, value)) filled.push(id);
        else {
          failed.push(id);
          errors[id] = "no matching option";
        }
      } catch (e) {
        failed.push(id);
        errors[id] = (e && e.message) || String(e);
      }
    }
    return { filled, failed, errors, stale: entries.length > 0 && matchedFrame === 0 };
  }

  // Clicks a Next/Continue button. Never clicks anything that looks like Submit/Apply.
  function clickNext() {
    const nextRe = /^(next|continue|next step|save (and|&) continue|save (and|&) next|proceed)\b/i;
    const badRe = /submit|apply|send|finish|confirm|place order|review/i;
    const btns = queryAllDeep("button, input[type=button], input[type=submit], a[role=button], [role=button]");
    for (const b of btns) {
      if (b.disabled || shadowHost(b)?.hasAttribute("disabled") || !isVisible(b)) continue;
      const host = shadowHost(b);
      const text = clean(b.innerText || b.value || b.getAttribute("aria-label") || host?.innerText || host?.textContent);
      if (nextRe.test(text) && !badRe.test(text)) {
        b.click();
        return text;
      }
    }
    return null;
  }

  window.__jaf = { scan, fill, clickNext };
})();
