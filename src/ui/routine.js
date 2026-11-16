// Routine tab: project info, start pose, the ordered step list and each step's editor.

import { displayDeg } from '../geometry.js';
import { findStep } from '../store.js';
import { PATH_COLORS } from '../render.js';
import { fmtSec, h, roundTo, uid } from '../util.js';
import { checkbox, exprInput, fld, numInput, selectInput, textArea, textInput } from './fields.js';

const STEP_META = {
  path: { icon: '〰', label: 'Path', color: '#facc15' },
  action: { icon: '⚙', label: 'Action', color: '#ef4444' },
  wait: { icon: '⏱', label: 'Wait', color: '#64748b' },
  turn: { icon: '⟳', label: 'Turn', color: '#c084fc' },
  java: { icon: '{ }', label: 'Java', color: '#94a3b8' },
};

const HEADING_MODES = [
  ['linear', 'Linear (start → end heading)'],
  ['constant', 'Constant'],
  ['tangent', 'Tangent (face where it drives)'],
  ['reverseTangent', 'Reverse tangent (back first)'],
  ['facing', 'Face a point'],
  ['piecewise', 'Piecewise'],
];

const PIECE_MODES = [
  ['constant', 'Constant'],
  ['linear', 'Linear'],
  ['tangent', 'Tangent'],
  ['reverseTangent', 'Reverse tangent'],
  ['facing', 'Face point'],
];

const HEADING_REFS = [['start', 'start heading'], ['end', 'end heading'], ['custom', 'custom °']];

function mut(app, stepId) {
  return (fn, opts) => app.store.update((pr) => {
    const s = findStep(pr, stepId);
    if (s) fn(s, pr);
  }, opts);
}

export function stepTitle(step) {
  if (step.type === 'path') return step.name || 'path';
  if (step.type === 'action') return step.label || (step.cmds || []).map((c) => c.lib).join(' + ') || 'action';
  if (step.type === 'wait') return `Wait ${step.seconds ?? 0} s`;
  if (step.type === 'turn') return `Turn to ${step.h ?? 0}°`;
  return 'Java';
}

/* ---------- command references ---------- */

function commandOptions(settings, filter) {
  const lib = (settings.commands || []).filter((c) => !filter || filter(c));
  return [
    { group: 'Commands', options: lib.filter((c) => c.type !== 'instant').map((c) => [c.id, c.name]) },
    { group: 'Instant actions', options: lib.filter((c) => c.type === 'instant').map((c) => [c.id, c.name]) },
  ];
}

function cmdRefEditor(app, key, ref, change, remove) {
  const settings = app.store.state.settings;
  const lib = (settings.commands || []).find((c) => c.id === ref.lib);
  const sel = selectInput(`${key}.lib`, commandOptions(settings), ref.lib, (v) => change((r) => { r.lib = v; r.params = {}; }));
  const params = h('div.params', {}, (lib?.params || []).map((p) => fld(p.label || p.key, exprInput(app, `${key}.p.${p.key}`, ref.params?.[p.key] ?? p.default, (v, o) => change((r) => {
    r.params = r.params || {};
    r.params[p.key] = v;
  }, o)))));
  return h('div.cmdref', {}, [
    sel,
    h('button.ghost', { title: 'Remove', onclick: remove, text: '✕' }),
    lib?.params?.length ? params : null,
  ]);
}

/* ---------- heading editor ---------- */

function headingRefFields(app, key, which, deg, setWhich, setDeg, label) {
  const parts = [fld(label, selectInput(`${key}.ref`, HEADING_REFS, which || 'start', setWhich))];
  if (which === 'custom') parts.push(fld('°', exprInput(app, `${key}.deg`, deg ?? 0, setDeg)));
  return parts;
}

function pointPicker(app, key, onPick) {
  const pts = app.store.state.settings.points || [];
  if (!pts.length) return null;
  return fld('Use point', selectInput(key, [['', 'choose…'], ...pts.map((p, i) => [String(i), p.name])], '', (v) => {
    if (v === '') return;
    onPick(pts[Number(v)]);
  }));
}

function pieceEditor(app, key, piece, idx, m) {
  const set = (fn, o) => m((s) => fn(s.heading.pieces[idx]), o);
  const extra = [];
  if (piece.mode === 'constant') {
    extra.push(...headingRefFields(app, `${key}.hold`, piece.hold, piece.deg, (v) => set((p) => { p.hold = v; }), (v, o) => set((p) => { p.deg = v; }, o), 'Hold'));
  } else if (piece.mode === 'linear') {
    extra.push(...headingRefFields(app, `${key}.from`, piece.from, piece.fromDeg, (v) => set((p) => { p.from = v; }), (v, o) => set((p) => { p.fromDeg = v; }, o), 'From'));
    extra.push(...headingRefFields(app, `${key}.to`, piece.to || 'end', piece.toDeg, (v) => set((p) => { p.to = v; }), (v, o) => set((p) => { p.toDeg = v; }, o), 'To'));
    extra.push(checkbox(`${key}.long`, 'long way', piece.long, (v) => set((p) => { p.long = v; })));
  } else if (piece.mode === 'facing') {
    extra.push(fld('x', exprInput(app, `${key}.x`, piece.x ?? 72, (v, o) => set((p) => { p.x = v; }, o))));
    extra.push(fld('y', exprInput(app, `${key}.y`, piece.y ?? 72, (v, o) => set((p) => { p.y = v; }, o))));
    extra.push(pointPicker(app, `${key}.pick`, (pt) => set((p) => { p.x = pt.x; p.y = pt.y; })));
  }
  return h('div.piece', {}, [
    fld('until', numInput(app, `${key}.until`, piece.until, (v, o) => set((p) => { p.until = v; }, o), { step: 0.05, min: 0, max: 1 })),
    fld('heading', selectInput(`${key}.mode`, PIECE_MODES, piece.mode, (v) => set((p) => { p.mode = v; }))),
    h('button.ghost', { title: 'Remove piece', text: '✕', onclick: () => m((s) => { s.heading.pieces.splice(idx, 1); }) }),
    extra.length ? h('div.extra', {}, extra) : null,
  ]);
}

function headingEditor(app, step, m) {
  const hd = step.heading || { mode: 'linear' };
  const key = `${step.id}.heading`;
  const box = h('div.sub');
  box.append(fld('Heading', selectInput(`${key}.mode`, HEADING_MODES, hd.mode, (v) => m((s) => {
    const prev = s.heading || {};
    s.heading = { mode: v };
    if (v === 'piecewise') {
      s.heading.pieces = prev.pieces || [
        { until: 0.2, mode: 'constant', hold: 'start' },
        { until: 0.8, mode: 'linear', from: 'start', to: 'end' },
        { until: 1, mode: 'constant', hold: 'end' },
      ];
    }
    if (v === 'linear') s.heading.endT = 1;
    if (v === 'constant') s.heading.hold = 'end';
    if (v === 'facing') { s.heading.x = 72; s.heading.y = 72; }
  }))));
  if (hd.mode === 'linear') {
    box.append(h('div.grid2', {}, [
      fld('Finish turning at (0–1)', numInput(app, `${key}.endT`, hd.endT ?? 1, (v, o) => m((s) => { s.heading.endT = v; }, o), { step: 0.05, min: 0.05, max: 1 }), 'Path.linear(start, end, endT): reach the end heading by this fraction of the path'),
      h('div.fld', {}, [h('span', { text: ' ' }), checkbox(`${key}.long`, 'turn the long way', hd.long, (v) => m((s) => { s.heading.long = v; }), 'Interpolator.longLinear')]),
    ]));
  } else if (hd.mode === 'constant') {
    box.append(h('div.grid2', {}, headingRefFields(app, `${key}.hold`, hd.hold || 'start', hd.deg, (v) => m((s) => { s.heading.hold = v; }), (v, o) => m((s) => { s.heading.deg = v; }, o), 'Hold')));
  } else if (hd.mode === 'facing') {
    box.append(h('div.grid3', {}, [
      fld('Point x', exprInput(app, `${key}.x`, hd.x ?? 72, (v, o) => m((s) => { s.heading.x = v; }, o))),
      fld('Point y', exprInput(app, `${key}.y`, hd.y ?? 72, (v, o) => m((s) => { s.heading.y = v; }, o))),
      pointPicker(app, `${key}.pick`, (pt) => m((s) => { s.heading.x = pt.x; s.heading.y = pt.y; })),
    ]));
  } else if (hd.mode === 'piecewise') {
    (hd.pieces || []).forEach((p, i) => box.append(pieceEditor(app, `${key}.pc${i}`, p, i, m)));
    box.append(h('div.add-row', {}, [
      h('button.small', { text: '+ piece', onclick: () => m((s) => {
        const pcs = s.heading.pieces || (s.heading.pieces = []);
        if (pcs.length) {
          const lastPiece = pcs[pcs.length - 1];
          const prevUntil = pcs.length > 1 ? pcs[pcs.length - 2].until : 0;
          if (lastPiece.until >= 1) lastPiece.until = roundTo((prevUntil + 1) / 2, 0.05);
        }
        pcs.push({ until: 1, mode: 'constant', hold: 'end' });
      }) }),
      h('button.small', { text: 'hold → turn → hold', title: 'The team pattern: keep start heading for 20%, turn until 80%, then hold the end heading', onclick: () => m((s) => {
        s.heading.pieces = [
          { until: 0.2, mode: 'constant', hold: 'start' },
          { until: 0.8, mode: 'linear', from: 'start', to: 'end' },
          { until: 1, mode: 'constant', hold: 'end' },
        ];
      }) }),
    ]));
  }
  return box;
}

/* ---------- path editor ---------- */

function towardCenter(p, dist = 24) {
  const dx = 72 - p.x;
  const dy = 72 - p.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { x: roundTo(p.x + dist, 0.5), y: roundTo(p.y, 0.5) };
  return { x: roundTo(p.x + (dx / len) * dist, 0.5), y: roundTo(p.y + (dy / len) * dist, 0.5) };
}

function segmentsEditor(app, step, m, numVal) {
  const box = h('div.sub');
  const segs = step.segments || [];
  segs.forEach((seg, si) => {
    const key = `${step.id}.seg${si}`;
    const last = si === segs.length - 1;
    const rows = [h('div.row', {}, [
      h('b', { text: `Segment ${si + 1}` }),
      selectInput(`${key}.type`, [['line', 'Line'], ['curve', 'Bézier curve']], seg.type === 'curve' ? 'curve' : 'line', (v) => m((s) => {
        const sg = s.segments[si];
        sg.type = v;
        if (v === 'curve' && !(sg.controls || []).length) {
          const startPt = si === 0 ? app.poseBefore(step.id) : { x: numVal(s.segments[si - 1].end.x), y: numVal(s.segments[si - 1].end.y) };
          const endPt = { x: numVal(sg.end.x), y: numVal(sg.end.y) };
          sg.controls = [{ x: roundTo((startPt.x + endPt.x) / 2 + (endPt.y - startPt.y) * 0.25, 0.5), y: roundTo((startPt.y + endPt.y) / 2 - (endPt.x - startPt.x) * 0.25, 0.5) }];
        }
      })),
      h('span.spacer'),
      segs.length > 1 ? h('button.ghost', { title: 'Remove segment', text: '✕', onclick: () => m((s) => { s.segments.splice(si, 1); }) }) : null,
    ])];
    if (seg.type === 'curve') {
      (seg.controls || []).forEach((c, ci) => {
        rows.push(h('div.grid3', {}, [
          fld(`Control ${ci + 1} x`, exprInput(app, `${key}.c${ci}x`, c.x, (v, o) => m((s) => { s.segments[si].controls[ci].x = v; }, o))),
          fld('y', exprInput(app, `${key}.c${ci}y`, c.y, (v, o) => m((s) => { s.segments[si].controls[ci].y = v; }, o))),
          h('div.fld', {}, [h('span', { text: ' ' }), h('button.ghost', { text: '✕ remove', onclick: () => m((s) => {
            const sg = s.segments[si];
            sg.controls.splice(ci, 1);
            if (!sg.controls.length) sg.type = 'line';
          }) })]),
        ]));
      });
      rows.push(h('button.small', { text: '+ control point', onclick: () => m((s) => {
        const sg = s.segments[si];
        const lastC = sg.controls[sg.controls.length - 1] || sg.end;
        sg.controls.push({ x: roundTo(numVal(lastC.x) + 6, 0.5), y: roundTo(numVal(lastC.y) + 6, 0.5) });
      }) }));
    }
    if (!last) {
      rows.push(h('div.grid2', {}, [
        fld('Joint x', exprInput(app, `${key}.ex`, seg.end.x, (v, o) => m((s) => { s.segments[si].end.x = v; }, o))),
        fld('Joint y', exprInput(app, `${key}.ey`, seg.end.y, (v, o) => m((s) => { s.segments[si].end.y = v; }, o))),
      ]));
    }
    box.append(h('div.sub', {}, rows));
  });
  box.append(h('button.small', { text: '+ segment (continue the path)', onclick: () => m((s) => {
    const lastSeg = s.segments[s.segments.length - 1];
    const end = { x: numVal(lastSeg.end.x), y: numVal(lastSeg.end.y) };
    s.segments.push({ type: 'line', controls: [], end: towardCenter(end) });
  }) }));
  return box;
}

function pathEditor(app, step, m, item, rstep) {
  const numVal = app.numVal;
  const last = step.segments[step.segments.length - 1];
  const key = step.id;
  const body = [];
  body.push(h('div.grid2', {}, [
    fld('Path name (Java)', textInput(app, `${key}.name`, step.name, (v, o) => m((s) => { s.name = v; }, o), { mono: true })),
    fld('End pose name (Java)', textInput(app, `${key}.endName`, step.endName, (v, o) => m((s) => { s.endName = v; }, o), { mono: true })),
  ]));
  body.push(h('div.section-title', { text: 'End pose (blue frame)' }));
  body.push(h('div.grid3', {}, [
    fld('x', exprInput(app, `${key}.x`, last?.end.x, (v, o) => m((s) => { s.segments[s.segments.length - 1].end.x = v; }, o))),
    fld('y', exprInput(app, `${key}.y`, last?.end.y, (v, o) => m((s) => { s.segments[s.segments.length - 1].end.y = v; }, o))),
    fld('heading °', exprInput(app, `${key}.h`, step.endH, (v, o) => m((s) => { s.endH = v; }, o))),
  ]));
  body.push(h('div.section-title', { text: 'Shape' }));
  body.push(segmentsEditor(app, step, m, numVal));
  body.push(h('div.section-title', { text: 'Heading' }));
  body.push(headingEditor(app, step, m));
  body.push(h('div.grid2', {}, [
    fld('Max speed (0–1, blank = full)', numInput(app, `${key}.speed`, step.maxSpeed ?? '', (v, o) => m((s) => { s.maxSpeed = v; }, o), { step: 0.05, min: 0.05, max: 1, allowEmpty: true }), 'drive.follow(path, maxSpeed): fraction of max achievable velocity'),
    fld('Timeout s (blank = none)', numInput(app, `${key}.timeout`, step.timeout ?? '', (v, o) => m((s) => { s.timeout = v; }, o), { step: 0.25, min: 0, allowEmpty: true })),
  ]));

  body.push(h('div.section-title', { text: 'While driving (deadlineWith)' }));
  const during = h('div.sub');
  (step.during || []).forEach((r, i) => during.append(cmdRefEditor(app, `${key}.during${i}`, r, (fn, o) => m((s) => fn(s.during[i]), o), () => m((s) => { s.during.splice(i, 1); }))));
  during.append(h('button.small', { text: '+ run during path', onclick: () => m((s) => {
    const lib = app.store.state.settings.commands;
    const pick = lib.find((c) => c.id === 'intakeTransfer') || lib[0];
    (s.during = s.during || []).push({ lib: pick?.id, params: {} });
  }) }));
  body.push(during);

  body.push(h('div.section-title', { text: 'Markers (fire at % of path)' }));
  const markers = h('div.sub');
  (step.markers || []).forEach((mk, i) => {
    markers.append(h('div.row', {}, [
      fld('at %', numInput(app, `${key}.mk${i}.at`, Math.round((mk.at ?? 0.5) * 1000) / 10, (v, o) => m((s) => { s.markers[i].at = Math.min(1, Math.max(0, v / 100)); }, o), { step: 5, min: 0, max: 100 })),
    ]));
    markers.append(cmdRefEditor(app, `${key}.mk${i}.cmd`, mk.cmd, (fn, o) => m((s) => fn(s.markers[i].cmd), o), () => m((s) => { s.markers.splice(i, 1); })));
  });
  markers.append(h('button.small', { text: '+ marker', onclick: () => m((s) => {
    const lib = app.store.state.settings.commands;
    const pick = lib.find((c) => c.id === 'spinUp') || lib[0];
    (s.markers = s.markers || []).push({ id: uid('mk'), at: 0.5, cmd: { lib: pick?.id, params: {} } });
  }) }));
  markers.append(h('div.hint', { text: 'Drag the ◆ on the field to move a marker; right-click it to delete.' }));
  body.push(markers);

  if (rstep && item) {
    const moveDur = item.motion?.prof?.duration ?? 0;
    // headings are stored in the blue frame; the preview may be mirrored for red
    const fr = app.store.derived().resolved.frame;
    const actual = displayDeg(fr.heading(rstep.interp(1)));
    const declared = displayDeg(fr.heading(rstep.end.h));
    body.push(h('div.stat', { text: `length ${rstep.geom.length.toFixed(1)} in · drive ${moveDur.toFixed(2)} s · step ${(item.t1 - item.t0).toFixed(2)} s · ends facing ${actual}°` }));
    const off = Math.abs(((actual - declared + 540) % 360) - 180);
    if (off > 1) {
      body.push(h('div.sub', {}, [
        h('div.hint', { text: `With this heading mode the robot ends facing ${actual}°, but the end pose says ${declared}°. The next path's "start heading" comes from the end pose, so it would begin with a jump.` }),
        h('button.small', { 'data-key': `${key}.fixH`, text: `Set end heading to ${Math.round(actual * 10) / 10}°`, onclick: () => m((s) => { s.endH = Math.round(actual * 10) / 10; }) }),
      ]));
    }
  }
  return body;
}

function actionEditor(app, step, m) {
  const key = step.id;
  const box = [];
  box.push(fld('Label (comment in Java)', textInput(app, `${key}.label`, step.label, (v, o) => m((s) => { s.label = v; }, o))));
  const list = h('div.sub');
  (step.cmds || []).forEach((r, i) => list.append(cmdRefEditor(app, `${key}.cmd${i}`, r, (fn, o) => m((s) => fn(s.cmds[i]), o), () => m((s) => { s.cmds.splice(i, 1); }))));
  list.append(h('button.small', { text: '+ command (runs in parallel)', onclick: () => m((s) => {
    const lib = app.store.state.settings.commands;
    (s.cmds = s.cmds || []).push({ lib: lib[0]?.id, params: {} });
  }) }));
  box.push(list);
  box.push(fld('Timeout s (blank = until the commands finish)', numInput(app, `${key}.timeout`, step.timeout ?? '', (v, o) => m((s) => { s.timeout = v; }, o), { step: 0.25, min: 0, allowEmpty: true })));
  return box;
}

function stepEditor(app, step, d) {
  const m = mut(app, step.id);
  const item = d.sim.items.find((i) => i.stepId === step.id);
  const rstep = d.resolved.steps.find((s) => s.id === step.id);
  if (step.type === 'path') return pathEditor(app, step, m, item, rstep);
  if (step.type === 'action') return actionEditor(app, step, m);
  if (step.type === 'wait') return [fld('Seconds', exprInput(app, `${step.id}.sec`, step.seconds, (v, o) => m((s) => { s.seconds = v; }, o)))];
  if (step.type === 'turn') {
    return [
      fld('Turn to heading ° (blue frame)', exprInput(app, `${step.id}.h`, step.h, (v, o) => m((s) => { s.h = v; }, o))),
      h('div.hint', { text: 'Uses the turn command from Settings → Code (TurnToCmd by default). Drag the knob on the field to aim.' }),
    ];
  }
  return [
    fld('Java inside the builder (b is the PedroAutoDsl builder)', textArea(app, `${step.id}.code`, step.code, (v, o) => m((s) => { s.code = v; }, o), { rows: 5 })),
    fld('Estimated seconds (for the timeline)', exprInput(app, `${step.id}.dur`, step.duration ?? 0, (v, o) => m((s) => { s.duration = v; }, o))),
  ];
}

/* ---------- list ---------- */

function moveStep(app, id, delta) {
  app.store.update((pr) => {
    const i = pr.steps.findIndex((s) => s.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= pr.steps.length) return;
    const [s] = pr.steps.splice(i, 1);
    pr.steps.splice(j, 0, s);
  });
}

function duplicateStep(app, id) {
  const newId = uid('step');
  app.store.update((pr) => {
    const i = pr.steps.findIndex((s) => s.id === id);
    const copy = JSON.parse(JSON.stringify(pr.steps[i]));
    copy.id = newId;
    if (copy.name) copy.name = `${copy.name}Copy`;
    if (copy.endName) copy.endName = `${copy.endName}Copy`;
    (copy.markers || []).forEach((mk) => { mk.id = uid('mk'); });
    pr.steps.splice(i + 1, 0, copy);
  });
  app.store.setUi({ selectedStepId: newId });
}

function stepCard(app, step, index, d, pathColor) {
  const { ui } = app.store.state;
  const sel = ui.selectedStepId === step.id;
  const meta = STEP_META[step.type] || STEP_META.java;
  const item = d.sim.items.find((i) => i.stepId === step.id);
  const issues = d.issues.filter((i) => i.stepId === step.id);
  const worst = issues.some((i) => i.level === 'error') ? 'err' : issues.some((i) => i.level === 'warn') ? 'warn' : null;
  const dur = item ? (item.forever ? '∞' : fmtSec(item.t1 - item.t0)) : '';
  const hd = h('div.hd', { onclick: () => {
    app.store.setUi({ selectedStepId: sel ? null : step.id, selectedZoneId: null });
    if (!sel && item) app.seek(item.t0);
  } }, [
    h('span.num', { text: index + 1 }),
    h('span.chip', { style: { background: step.type === 'path' ? pathColor : meta.color } }),
    h('span.title', { text: `${meta.label} · ${stepTitle(step)}` }),
    worst ? h(`span.dot.${worst}`, { title: issues.map((i) => i.msg).join('\n') }) : null,
    h('span.dur', { text: dur }),
    h('button.ghost', { title: 'Move up', text: '↑', onclick: (e) => { e.stopPropagation(); moveStep(app, step.id, -1); } }),
    h('button.ghost', { title: 'Move down', text: '↓', onclick: (e) => { e.stopPropagation(); moveStep(app, step.id, 1); } }),
    h('button.ghost', { title: 'Duplicate', text: '⧉', onclick: (e) => { e.stopPropagation(); duplicateStep(app, step.id); } }),
    h('button.ghost', { title: 'Delete', text: '✕', onclick: (e) => {
      e.stopPropagation();
      app.store.update((pr) => { pr.steps = pr.steps.filter((s) => s.id !== step.id); });
      if (sel) app.store.setUi({ selectedStepId: null });
    } }),
  ]);
  const card = h(`div.card${sel ? '.sel' : ''}`, { 'data-step': step.id }, [hd]);
  if (sel) {
    const body = h('div.bd', {}, stepEditor(app, step, d));
    for (const iss of issues) body.append(h(`div.issue.${iss.level}`, {}, [h(`span.dot.${iss.level === 'error' ? 'err' : iss.level === 'warn' ? 'warn' : 'info'}`), h('span', { text: iss.msg })]));
    card.append(body);
  }
  return card;
}

function newStep(app, type) {
  const { store } = app;
  const sel = store.state.ui.selectedStepId;
  const steps = store.state.project.steps;
  const insertAt = sel && sel !== '__start' ? steps.findIndex((s) => s.id === sel) + 1 : steps.length;
  const pose = app.poseAt(insertAt);
  const n = steps.filter((s) => s.type === 'path').length + 1;
  const id = uid('step');
  const lib = store.state.settings.commands;
  let step;
  if (type === 'path') {
    step = {
      id, type: 'path', name: `path${n}`, endName: `pose${n}`,
      segments: [{ type: 'line', controls: [], end: towardCenter(pose) }],
      endH: Math.round(pose.hDeg), heading: { mode: 'linear', endT: 1, long: false },
      maxSpeed: null, timeout: null, during: [], markers: [],
    };
  } else if (type === 'action') step = { id, type: 'action', label: '', cmds: [{ lib: lib[0]?.id, params: {} }], timeout: null };
  else if (type === 'wait') step = { id, type: 'wait', seconds: 1 };
  else if (type === 'turn') step = { id, type: 'turn', h: Math.round(pose.hDeg + 90) };
  else step = { id, type: 'java', code: '// runs inside PedroAutoDsl.auto(..., b -> { ... })\nb.waitUntilDriveIdle();', duration: 0 };
  store.update((pr) => { pr.steps.splice(insertAt, 0, step); });
  store.setUi({ selectedStepId: id, selectedZoneId: null });
}

function projectCard(app) {
  const { project } = app.store.state;
  const open = app.store.state.ui.projectOpen;
  const set = (fn, o) => app.store.update(fn, o);
  const hd = h('div.hd', { onclick: () => app.store.setUi({ projectOpen: !open }) }, [
    h('span.chip', { style: { background: '#e5e7eb' } }),
    h('span.title', { text: `Export names · ${project.className || 'class'}` }),
    h('span.faint', { text: open ? '▾' : '▸' }),
  ]);
  const card = h('div.card', {}, [hd]);
  if (open) {
    const targets = [['Constants.BACK_SIDE', 'BACK_SIDE'], ['Constants.AUDIENCE_SIDE', 'AUDIENCE_SIDE']];
    card.append(h('div.bd', {}, [
      h('div.grid2', {}, [
        fld('Routine class', textInput(app, 'proj.class', project.className, (v, o) => set((p) => { p.className = v; }, o), { mono: true })),
        fld('OpMode name', textInput(app, 'proj.opmode', project.opModeName, (v, o) => set((p) => { p.opModeName = v; }, o))),
        fld('Blue target()', selectInput('proj.bt', targets, project.blueTarget, (v) => set((p) => { p.blueTarget = v; }))),
        fld('Red target()', selectInput('proj.rt', targets, project.redTarget, (v) => set((p) => { p.redTarget = v; }))),
      ]),
    ]));
  }
  return card;
}

function startCard(app) {
  const { project, ui } = app.store.state;
  const sel = ui.selectedStepId === '__start';
  const s = project.start;
  const set = (fn, o) => app.store.update((pr) => fn(pr.start), o);
  const hd = h('div.hd', { onclick: () => app.store.setUi({ selectedStepId: sel ? null : '__start' }) }, [
    h('span.num', { text: '0' }),
    h('span.chip', { style: { background: ui.alliance === 'red' ? '#ef4444' : '#3b82f6' } }),
    h('span.title', { text: `Start pose · (${s.x}, ${s.y}, ${s.h}°)` }),
  ]);
  const card = h(`div.card${sel ? '.sel' : ''}`, {}, [hd]);
  if (sel) {
    card.append(h('div.bd', {}, [
      h('div.grid3', {}, [
        fld('x', exprInput(app, 'start.x', s.x, (v, o) => set((p) => { p.x = v; }, o))),
        fld('y', exprInput(app, 'start.y', s.y, (v, o) => set((p) => { p.y = v; }, o))),
        fld('heading °', exprInput(app, 'start.h', s.h, (v, o) => set((p) => { p.h = v; }, o))),
      ]),
      h('div.hint', { text: 'Blue-frame coordinates, like the team geometry files: f.of(x, y, heading). Expressions such as 72+L/2 export as Constants.ROBOT_LENGTH maths.' }),
    ]));
  }
  return card;
}

export function renderRoutineTab(container, app) {
  const d = app.store.derived();
  const { project } = app.store.state;
  container.append(projectCard(app));
  container.append(startCard(app));
  let colorIdx = 0;
  project.steps.forEach((step, i) => {
    const color = step.type === 'path' ? PATH_COLORS[colorIdx++ % PATH_COLORS.length] : null;
    container.append(stepCard(app, step, i, d, color));
  });
  const sel = app.store.state.ui.selectedStepId;
  container.append(h('div.section-title', { text: sel && sel !== '__start' ? 'Add after selected step' : 'Add step' }));
  container.append(h('div.add-row', {}, [
    h('button', { text: '+ Path', onclick: () => newStep(app, 'path') }),
    h('button', { text: '+ Action', onclick: () => newStep(app, 'action') }),
    h('button', { text: '+ Wait', onclick: () => newStep(app, 'wait') }),
    h('button', { text: '+ Turn', onclick: () => newStep(app, 'turn') }),
    h('button', { text: '+ Java', onclick: () => newStep(app, 'java') }),
  ]));
  container.append(h('div.hint', { html: 'Field: drag ● points and ■ control points, drag the knob to aim, <b>double-click</b> a selected path to add a control point, <b>right-click</b> a control point to remove it. <b>Shift</b> = no snapping. <b>Space</b> = play.' }));
}

