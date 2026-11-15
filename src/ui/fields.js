// Form controls shared by the sidebar and the settings page.
// Text/number inputs edit live (no sidebar re-render while typing) and make one undo step per edit.

import { evalValue } from '../expr.js';
import { symbolTable } from '../resolve.js';
import { h } from '../util.js';

/** "12" -> 12, "144-L/2" -> "144-L/2", "" -> "" */
export function rawFromText(text) {
  const t = String(text).trim();
  if (t === '') return '';
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}

export function fld(label, input, title) {
  return h('label.fld', { title }, [h('span', { text: label }), input]);
}

function liveBind(el, app, apply, opts = {}) {
  const live = opts.live !== false;
  el.addEventListener('focus', () => app.store.beginEdit());
  if (live) el.addEventListener('input', () => apply(el.value, { history: false, source: 'sidebar' }));
  el.addEventListener('change', () => {
    if (!live) apply(el.value, { history: false, source: 'sidebar' });
    app.store.commit();
    // after the browser has moved focus (Tab), so preserveFocus lands on the next field
    setTimeout(() => app.refreshPanels(), 0);
  });
  el.addEventListener('blur', () => app.store.commit());
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && el.tagName === 'INPUT') el.blur();
  });
}

/** Number-or-expression input. apply(rawValue, opts). */
export function exprInput(app, key, value, apply, opts = {}) {
  const el = h('input.expr', { 'data-key': key, value: value ?? '', placeholder: opts.placeholder || '', spellcheck: 'false', title: opts.title || 'A number, or an expression like 144-L/2 (L, W = robot length/width; add more in Settings → Constants)' });
  const validate = () => {
    if (el.value.trim() === '' && opts.allowEmpty) { el.classList.remove('invalid'); return; }
    try {
      evalValue(rawFromText(el.value), symbolTable(app.store.state.settings).values);
      el.classList.remove('invalid');
    } catch {
      el.classList.add('invalid');
    }
  };
  validate();
  liveBind(el, app, (v, o) => {
    validate();
    apply(rawFromText(v), o);
  });
  return el;
}

export function textInput(app, key, value, apply, opts = {}) {
  const el = h('input', { 'data-key': key, value: value ?? '', placeholder: opts.placeholder || '', spellcheck: 'false' });
  if (opts.mono) el.classList.add('expr');
  liveBind(el, app, (v, o) => apply(v, o));
  return el;
}

export function numInput(app, key, value, apply, opts = {}) {
  const el = h('input', { 'data-key': key, type: 'number', value: value ?? '', step: opts.step ?? 'any', min: opts.min, max: opts.max, placeholder: opts.placeholder || '' });
  liveBind(el, app, (v, o) => {
    if (v === '' && opts.allowEmpty) return apply(null, o);
    const n = Number(v);
    if (Number.isFinite(n)) apply(n, o);
  });
  return el;
}

export function textArea(app, key, value, apply, opts = {}) {
  const el = h('textarea', { 'data-key': key, rows: opts.rows || 4, spellcheck: 'false' });
  el.value = value ?? '';
  liveBind(el, app, (v, o) => apply(v, o));
  return el;
}

/** options: [[value, label], ...] or [{ group, options }] */
export function selectInput(key, options, value, onChange) {
  const el = h('select', { 'data-key': key });
  const addOpt = (parent, [v, label]) => parent.append(h('option', { value: v, text: label }));
  for (const o of options) {
    if (Array.isArray(o)) addOpt(el, o);
    else {
      const g = h('optgroup', { label: o.group });
      o.options.forEach((x) => addOpt(g, x));
      el.append(g);
    }
  }
  el.value = value ?? '';
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function checkbox(key, label, value, onChange, title) {
  const el = h('input', { type: 'checkbox', 'data-key': key, checked: !!value });
  el.addEventListener('change', () => onChange(el.checked));
  return h('label.row', { title }, [el, h('span', { text: label })]);
}

/** Re-render a container while keeping focus/caret on the same data-key input. */
export function preserveFocus(container, renderFn) {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.getAttribute('data-key') : null;
  const sel = key && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = container.scrollTop;
  renderFn();
  container.scrollTop = scroll;
  if (key) {
    const el = container.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && el.setSelectionRange) {
        try { el.setSelectionRange(sel[0], sel[1]); } catch { /* number inputs */ }
      }
    }
  }
}
