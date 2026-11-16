// A small popover menu anchored under a button. One menu open at a time.

import { h } from '../util.js';

let open = null;

export function closeMenu() {
  if (!open) return;
  open.el.remove();
  document.removeEventListener('pointerdown', open.onDown, true);
  document.removeEventListener('keydown', open.onKey, true);
  open.anchor.setAttribute('aria-expanded', 'false');
  open = null;
}

/**
 * items: { label, hint?, onClick, danger?, id?, current? } | { title } | { separator: true } | { node }
 * Row extras: { actions: [{ label, title, onClick, id? }] } adds small buttons on the right.
 */
export function openMenu(anchor, items) {
  const wasThis = open && open.anchor === anchor;
  closeMenu();
  if (wasThis) return;
  const el = h('div.menu', { role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.separator) el.append(h('div.menu-sep'));
    else if (it.title) el.append(h('div.menu-title', { text: it.title }));
    else if (it.node) el.append(it.node);
    else {
      const row = h(`div.menu-row${it.current ? '.current' : ''}`);
      const main = h(`button.menu-item${it.danger ? '.danger' : ''}`, {
        role: 'menuitem',
        'data-menu': it.id,
        onclick: () => { closeMenu(); it.onClick(); },
      }, [h('span.menu-label', { text: it.label }), it.hint ? h('span.menu-hint', { text: it.hint }) : null]);
      row.append(main);
      for (const a of it.actions || []) {
        row.append(h('button.ghost.small', { title: a.title, 'data-menu': a.id, text: a.label, onclick: (e) => { e.stopPropagation(); closeMenu(); a.onClick(); } }));
      }
      el.append(row);
    }
  }
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const width = el.offsetWidth;
  el.style.top = `${Math.round(r.bottom + 4)}px`;
  el.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - width - 8)))}px`;
  el.style.maxHeight = `${Math.max(160, window.innerHeight - r.bottom - 16)}px`;
  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); anchor.focus(); } };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  anchor.setAttribute('aria-expanded', 'true');
  open = { el, anchor, onDown, onKey };
  el.querySelector('button')?.focus({ preventScroll: true });
}

export const menuIsOpen = () => !!open;
