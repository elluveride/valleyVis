// Pointer + keyboard handling for the field canvas: dragging poses, control points,
// headings and markers; drawing keep-out zones; inserting/removing control points.

import { closestCompletion, displayDeg } from './geometry.js';
import { evalValue } from './expr.js';
import { nearestPoint } from './poses.js';
import { symbolTable } from './resolve.js';
import { findStep } from './store.js';
import { roundTo, uid } from './util.js';

function distToPolyline(p, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

function hitHandle(handles, p) {
  let best = null;
  let bestD = Infinity;
  // later handles are drawn on top: prefer them on ties
  for (let i = handles.length - 1; i >= 0; i--) {
    const hd = handles[i];
    const d = Math.hypot(hd.x - p.x, hd.y - p.y);
    if (d <= hd.r && d < bestD - 0.5) {
      best = hd;
      bestD = d;
    }
  }
  return best;
}

/** Where a path step's start point really comes from (previous path end, or the start pose). */
export function startSource(project, stepId) {
  const idx = project.steps.findIndex((s) => s.id === stepId);
  for (let i = idx - 1; i >= 0; i--) {
    const s = project.steps[i];
    if (s.type === 'path' && s.segments?.length) return { kind: 'path', step: s };
  }
  return { kind: 'start' };
}

export function attachInteractions(canvas, app) {
  const { store } = app;
  let drag = null;
  let draft = null;

  const settings = () => store.state.settings;
  const frame = () => store.derived().resolved.frame;
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const realAt = (p) => app.view().toField(p.x, p.y);
  const snapStep = (e) => (e.shiftKey ? 0.01 : settings().field.snap || 0);
  const toDesign = (real, e) => {
    const d = frame().point(real.x, real.y);
    const st = snapStep(e);
    return { x: roundTo(d.x, st), y: roundTo(d.y, st) };
  };
  const headingDeg = (fromReal, toReal, e) => {
    const realH = Math.atan2(toReal.y - fromReal.y, toReal.x - fromReal.x);
    const deg = displayDeg(frame().heading(realH));
    return e.shiftKey ? Math.round(deg * 10) / 10 : roundTo(deg, 5);
  };
  const num = (v) => {
    try {
      return evalValue(v, symbolTable(settings()).values);
    } catch {
      return 0;
    }
  };

  function zoneFrame(zone) {
    const mirrored = store.state.ui.alliance === 'red' && zone.mirror;
    return mirrored ? frame().point : (x, y) => ({ x, y });
  }

  function applyDrag(e) {
    const p = local(e);
    const real = realAt(p);
    const h = drag.handle;
    const project = store.state.project;
    if (h.kind === 'start') {
      const d = toDesign(real, e);
      store.update((pr) => { pr.start.x = d.x; pr.start.y = d.y; }, { history: false });
    } else if (h.kind === 'startHeading') {
      const deg = headingDeg(store.derived().resolved.start, real, e);
      store.update((pr) => { pr.start.h = deg; }, { history: false });
    } else if (h.kind === 'segEnd' || h.kind === 'control') {
      const d = toDesign(real, e);
      // path ends are magnetic to named points (Shift turns it off)
      const raw = frame().point(real.x, real.y);
      const magnet = h.kind === 'segEnd' && !e.shiftKey ? nearestPoint(settings(), raw.x, raw.y, 2.5) : null;
      store.update((pr) => {
        const s = findStep(pr, h.stepId);
        const seg = s?.segments[h.seg];
        if (!seg) return;
        if (h.kind === 'control') {
          seg.controls[h.ctrl] = { x: d.x, y: d.y };
          return;
        }
        const isLast = h.seg === s.segments.length - 1;
        if (magnet) {
          seg.end = { x: magnet.x, y: magnet.y }; // keeps expressions such as 144-L/2
          if (isLast && magnet.ph !== null) {
            s.endH = magnet.h;
            s.endRef = magnet.name;
          }
        } else {
          seg.end = { x: d.x, y: d.y };
          if (isLast) delete s.endRef;
        }
      }, { history: false });
    } else if (h.kind === 'pathStart') {
      const d = toDesign(real, e);
      const src = startSource(project, h.stepId);
      store.update((pr) => {
        if (src.kind === 'start') { pr.start.x = d.x; pr.start.y = d.y; return; }
        const s = findStep(pr, src.step.id);
        s.segments[s.segments.length - 1].end = { x: d.x, y: d.y };
      }, { history: false });
    } else if (h.kind === 'endHeading' || h.kind === 'turnHeading') {
      const rs = store.derived().resolved.steps.find((s) => s.id === h.stepId);
      const center = h.kind === 'endHeading' ? rs.end : rs.start;
      const deg = headingDeg(center, real, e);
      store.update((pr) => {
        const s = findStep(pr, h.stepId);
        if (h.kind === 'endHeading') s.endH = deg; else s.h = deg;
      }, { history: false });
    } else if (h.kind === 'marker') {
      const rs = store.derived().resolved.steps.find((s) => s.id === h.stepId);
      const at = Math.round(closestCompletion(rs.geom, real).s * 100) / 100;
      store.update((pr) => {
        const s = findStep(pr, h.stepId);
        if (s?.markers?.[h.marker]) s.markers[h.marker].at = at;
      }, { history: false });
    } else if (h.kind === 'zoneBody') {
      const zf = zoneFrame(drag.zone);
      const a = zf(drag.startReal.x, drag.startReal.y);
      const b = zf(real.x, real.y);
      const st = snapStep(e);
      const dx = roundTo(b.x - a.x, st);
      const dy = roundTo(b.y - a.y, st);
      store.update((pr) => {
        const z = pr.zones.find((q) => q.id === h.zoneId);
        const o = drag.zone;
        if (z.shape === 'rect') { z.x = num(o.x) + dx; z.y = num(o.y) + dy; }
        else if (z.shape === 'circle') { z.cx = num(o.cx) + dx; z.cy = num(o.cy) + dy; }
        else z.points = o.points.map((q) => ({ x: num(q.x) + dx, y: num(q.y) + dy }));
      }, { history: false });
    } else if (h.kind === 'zoneVertex') {
      const zf = zoneFrame(drag.zone);
      const pt = zf(real.x, real.y);
      const st = snapStep(e);
      const q = { x: roundTo(pt.x, st), y: roundTo(pt.y, st) };
      store.update((pr) => {
        const z = pr.zones.find((zz) => zz.id === h.zoneId);
        const o = drag.zone;
        if (z.shape === 'circle') {
          z.r = roundTo(Math.hypot(q.x - num(o.cx), q.y - num(o.cy)), st || 0.5);
        } else if (z.shape === 'rect') {
          const x0 = num(o.x); const y0 = num(o.y); const x1 = x0 + num(o.w); const y1 = y0 + num(o.h);
          const corners = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
          const opp = corners[(h.vertex + 2) % 4];
          z.x = Math.min(opp.x, q.x); z.y = Math.min(opp.y, q.y);
          z.w = Math.max(0.5, Math.abs(q.x - opp.x)); z.h = Math.max(0.5, Math.abs(q.y - opp.y));
        } else {
          z.points[h.vertex] = q;
        }
      }, { history: false });
    }
  }

  function selectFromHandle(h) {
    if (h.kind === 'start' || h.kind === 'startHeading') store.setUi({ selectedStepId: '__start', selectedZoneId: null });
    else if (h.stepId) store.setUi({ selectedStepId: h.stepId, selectedZoneId: null });
    else if (h.zoneId) store.setUi({ selectedZoneId: h.zoneId });
  }

  function hitPath(p) {
    const { pathPolys } = app.lastRender();
    let best = null;
    let bestD = 8;
    for (const pp of pathPolys) {
      const d = distToPolyline(p, pp.pts);
      if (d < bestD) { bestD = d; best = pp; }
    }
    return best;
  }

  function finishDraft(e) {
    if (!draft) return;
    const toZone = (pt) => frame().point(pt.x, pt.y); // new zones mirror with alliance
    const n = (store.state.project.zones || []).length + 1;
    const st = snapStep(e || {}) || 0.5;
    let zone = null;
    if (draft.kind === 'rect' && draft.a && draft.b) {
      const a = toZone(draft.a);
      const b = toZone(draft.b);
      const w = Math.abs(b.x - a.x);
      const hgt = Math.abs(b.y - a.y);
      if (w > 0.5 && hgt > 0.5) zone = { shape: 'rect', x: roundTo(Math.min(a.x, b.x), st), y: roundTo(Math.min(a.y, b.y), st), w: roundTo(w, st), h: roundTo(hgt, st) };
    } else if (draft.kind === 'circle' && draft.a && draft.b) {
      const a = toZone(draft.a);
      const r = Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y);
      if (r > 0.5) zone = { shape: 'circle', cx: roundTo(a.x, st), cy: roundTo(a.y, st), r: roundTo(r, st) };
    } else if (draft.kind === 'poly' && draft.pts.length >= 3) {
      zone = { shape: 'poly', points: draft.pts.map((p) => { const q = toZone(p); return { x: roundTo(q.x, st), y: roundTo(q.y, st) }; }) };
    }
    draft = null;
    if (zone) {
      const id = uid('zone');
      store.update((pr) => {
        pr.zones = pr.zones || [];
        pr.zones.push({ id, name: `Keep-out ${n}`, clearance: 2, enabled: true, mirror: true, ...zone });
      });
      store.setUi({ selectedZoneId: id, tool: 'select', tab: 'zones' });
    }
    app.requestRender();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.focus();
    const p = local(e);
    const real = realAt(p);
    const tool = store.state.ui.tool;
    if (tool !== 'select') {
      if (tool === 'poly') {
        draft = draft?.kind === 'poly' ? draft : { kind: 'poly', pts: [] };
        const first = draft.pts[0] && app.view().toScreen(draft.pts[0]);
        if (first && draft.pts.length >= 3 && Math.hypot(first.x - p.x, first.y - p.y) < 10) finishDraft(e);
        else draft.pts.push(real);
      } else {
        draft = { kind: tool, a: real, b: real };
        canvas.setPointerCapture(e.pointerId);
      }
      app.requestRender();
      return;
    }
    const h = hitHandle(app.lastRender().handles, p);
    if (h) {
      selectFromHandle(h);
      store.beginEdit();
      const zone = h.zoneId ? JSON.parse(JSON.stringify(store.state.project.zones.find((z) => z.id === h.zoneId))) : null;
      drag = { handle: h, startReal: real, zone, moved: false };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const hp = hitPath(p);
    if (hp) {
      store.setUi({ selectedStepId: hp.stepId, selectedZoneId: null });
      return;
    }
    store.setUi({ selectedStepId: null, selectedZoneId: null });
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    const real = realAt(p);
    app.setHover(real);
    if (draft && (draft.kind === 'rect' || draft.kind === 'circle') && draft.a) {
      draft.b = real;
      app.requestRender();
      return;
    }
    if (draft?.kind === 'poly') {
      draft.hover = real;
      app.requestRender();
    }
    if (drag) {
      drag.moved = true;
      applyDrag(e);
      return;
    }
    if (store.state.ui.tool !== 'select') {
      canvas.style.cursor = 'crosshair';
      return;
    }
    const h = hitHandle(app.lastRender().handles, p);
    canvas.style.cursor = h ? 'grab' : hitPath(p) ? 'pointer' : 'default';
  });

  const endDrag = (e) => {
    if (draft && (draft.kind === 'rect' || draft.kind === 'circle')) {
      finishDraft(e);
      return;
    }
    if (drag) {
      store.commit();
      drag = null;
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => app.setHover(null));

  canvas.addEventListener('dblclick', (e) => {
    const p = local(e);
    if (draft?.kind === 'poly') {
      // the dblclick's own clicks already added two points at the same spot
      draft.pts.pop();
      finishDraft(e);
      return;
    }
    const sel = store.state.ui.selectedStepId;
    const rs = store.derived().resolved.steps.find((s) => s.id === sel);
    if (!rs || rs.type !== 'path') return;
    const pp = app.lastRender().pathPolys.find((q) => q.stepId === sel);
    if (!pp || distToPolyline(p, pp.pts) > 10) return;
    const real = realAt(p);
    const { s } = closestCompletion(rs.geom, real);
    const loc = rs.geom.localCompletion(s);
    const d = toDesign(real, e);
    store.update((pr) => {
      const step = findStep(pr, sel);
      const seg = step.segments[loc.index];
      if (seg.type !== 'curve' || !seg.controls?.length) {
        seg.type = 'curve';
        seg.controls = [d];
      } else {
        const at = Math.min(seg.controls.length, Math.floor(loc.completion * (seg.controls.length + 1)));
        seg.controls.splice(at, 0, d);
      }
    });
  });

  canvas.addEventListener('contextmenu', (e) => {
    const p = local(e);
    const h = hitHandle(app.lastRender().handles, p);
    if (!h) return;
    e.preventDefault();
    if (h.kind === 'control') {
      store.update((pr) => {
        const seg = findStep(pr, h.stepId).segments[h.seg];
        seg.controls.splice(h.ctrl, 1);
        if (!seg.controls.length) seg.type = 'line';
      });
    } else if (h.kind === 'zoneVertex') {
      store.update((pr) => {
        const z = pr.zones.find((q) => q.id === h.zoneId);
        if (z.shape === 'poly' && z.points.length > 3) z.points.splice(h.vertex, 1);
      });
    } else if (h.kind === 'marker') {
      store.update((pr) => { findStep(pr, h.stepId).markers.splice(h.marker, 1); });
    }
  });

  window.addEventListener('keydown', (e) => {
    if (app.blocked && app.blocked()) return; // a dialog or menu is open
    const tag = (e.target?.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      if (e.shiftKey) store.redo(); else store.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y' && !typing) {
      e.preventDefault();
      store.redo();
      return;
    }
    if (typing || mod) return;
    if (e.key === ' ') {
      // a button reached with the keyboard keeps its normal Space behaviour
      if (tag === 'button' && e.target.matches(':focus-visible')) return;
      e.preventDefault();
      app.togglePlay();
    } else if (e.key === 'Escape') {
      if (draft) { draft = null; app.requestRender(); return; }
      if (store.state.ui.tool !== 'select') { store.setUi({ tool: 'select' }); return; }
      store.setUi({ selectedStepId: null, selectedZoneId: null });
    } else if (e.key === 'Enter' && draft?.kind === 'poly') {
      finishDraft(e);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      const { selectedZoneId, selectedStepId } = store.state.ui;
      if (selectedZoneId) {
        store.update((pr) => { pr.zones = pr.zones.filter((z) => z.id !== selectedZoneId); });
        store.setUi({ selectedZoneId: null });
      } else if (selectedStepId && selectedStepId !== '__start') {
        store.update((pr) => { pr.steps = pr.steps.filter((s) => s.id !== selectedStepId); });
        store.setUi({ selectedStepId: null });
      }
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      app.seek(store.playback.time + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 0.1));
    }
  });

  return { getDraft: () => draft, cancelDraft: () => { draft = null; } };
}

export function hoverText(real, store) {
  if (!real) return '';
  const fr = store.derived().resolved.frame;
  const d = fr.point(real.x, real.y);
  const tag = fr.mirrored ? ' (blue frame)' : '';
  return `x ${d.x.toFixed(1)}  y ${d.y.toFixed(1)}${tag}`;
}

