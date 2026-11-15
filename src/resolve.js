// Raw project (numbers or expressions, blue design frame) -> numeric model in the
// field frame of the previewed alliance. Mirrors what PoseFactory f = field() does in Java.

import { evalValue } from './expr.js';
import { buildPath, deg2rad, normAngle } from './geometry.js';
import { makeInterpolator, validatePiecewise } from './heading.js';

export function symbolTable(settings) {
  const values = { L: settings.robot.length, W: settings.robot.width };
  const java = { L: settings.robot.lengthJava, W: settings.robot.widthJava };
  for (const c of settings.constants || []) {
    if (!c.name) continue;
    values[c.name] = Number(c.value);
    java[c.name] = c.java || c.name;
  }
  return { values, java };
}

const TRANSFORMS = {
  none: { p: (x, y) => ({ x, y }), h: (h) => h },
  point: { p: (x, y) => ({ x: 144 - x, y: 144 - y }), h: (h) => h + Math.PI },
  mirrorX: { p: (x, y) => ({ x: 144 - x, y }), h: (h) => Math.PI - h },
  mirrorY: { p: (x, y) => ({ x, y: 144 - y }), h: (h) => -h },
};

/** All supported transforms are involutions, so the same frame also maps back. */
export function makeFrame(settings, alliance) {
  const key = alliance === 'red' ? settings.alliance.redTransform || 'point' : 'none';
  const t = TRANSFORMS[key] || TRANSFORMS.none;
  return {
    key,
    mirrored: key !== 'none',
    point: (x, y) => t.p(x, y),
    heading: (h) => normAngle(t.h(h)),
    pose: (x, y, hDeg) => ({ ...t.p(x, y), h: normAngle(t.h(deg2rad(hDeg))) }),
  };
}

function makeEvaluator(scope, issues) {
  const ev = (v, where, stepId, extra) => {
    try {
      return evalValue(v, extra ? { ...scope, ...extra } : scope);
    } catch (e) {
      issues.push({ level: 'error', stepId, msg: `${where}: ${e.message}` });
      return 0;
    }
  };
  return ev;
}

export function resolveCommand(ref, settings, ev, stepId) {
  const lib = (settings.commands || []).find((c) => c.id === ref?.lib);
  if (!lib) {
    return { ok: false, name: `Unknown command "${ref?.lib}"`, color: '#888', type: 'command', duration: 0, requires: [], params: {}, lib: null };
  }
  const params = {};
  for (const p of lib.params || []) {
    const raw = ref.params && ref.params[p.key] !== undefined && ref.params[p.key] !== '' ? ref.params[p.key] : p.default;
    params[p.key] = ev(raw, `${lib.name} → ${p.label || p.key}`, stepId);
  }
  let duration = 0;
  const dur = String(lib.duration ?? '').trim().replace(/[{}]/g, '');
  if (lib.type === 'instant') duration = 0;
  else if (dur === '' || dur.toLowerCase() === 'forever') duration = Infinity;
  else duration = ev(dur, `${lib.name} duration`, stepId, params);
  const requires = String(lib.requires || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { ok: true, lib, name: lib.name, color: lib.color || '#888', type: lib.type, params, duration, requires };
}

function headingRef(which, deg, ctx) {
  if (which === 'end') return ctx.end.h;
  if (which === 'custom') return ctx.frame.heading(deg2rad(ctx.ev(deg ?? 0, 'Custom heading', ctx.stepId)));
  return ctx.start.h;
}

function pieceDescriptor(p, ctx) {
  switch (p.mode) {
    case 'constant': return { k: 'constant', h: headingRef(p.hold || 'start', p.deg, ctx) };
    case 'linear': return { k: 'linear', a: headingRef(p.from || 'start', p.fromDeg, ctx), b: headingRef(p.to || 'end', p.toDeg, ctx), long: !!p.long };
    case 'tangent': return { k: 'tangent', rev: false };
    case 'reverseTangent': return { k: 'tangent', rev: true };
    case 'facing': return { k: 'facing', p: ctx.frame.point(ctx.ev(p.x ?? 72, 'Facing x', ctx.stepId), ctx.ev(p.y ?? 72, 'Facing y', ctx.stepId)) };
    default: return { k: 'constant', h: ctx.start.h };
  }
}

export function headingDescriptor(heading, ctx) {
  const h = heading || { mode: 'linear' };
  switch (h.mode) {
    case 'piecewise':
      return { k: 'piecewise', pieces: (h.pieces || []).map((p) => ({ until: Number(p.until), i: pieceDescriptor(p, ctx), mode: p.mode })) };
    case 'linear': {
      const endT = Number(h.endT ?? 1);
      const lin = { k: 'linear', a: ctx.start.h, b: ctx.end.h, long: !!h.long };
      if (endT >= 1 || !(endT > 0)) return lin;
      return { k: 'piecewise', pieces: [{ until: endT, i: lin }, { until: 1, i: { k: 'constant', h: ctx.end.h } }] };
    }
    default:
      return pieceDescriptor(h, ctx);
  }
}

function resolvePath(step, ctx) {
  const { ev, frame } = ctx;
  const segs = step.segments || [];
  let from = { x: ctx.pose.x, y: ctx.pose.y };
  const segPts = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const controls = s.type === 'curve' ? (s.controls || []).map((c, k) => frame.point(ev(c.x, `Segment ${i + 1} control ${k + 1} x`, step.id), ev(c.y, `Segment ${i + 1} control ${k + 1} y`, step.id))) : [];
    const end = frame.point(ev(s.end.x, `Segment ${i + 1} end x`, step.id), ev(s.end.y, `Segment ${i + 1} end y`, step.id));
    segPts.push([from, ...controls, end]);
    from = end;
  }
  const endRaw = segs.length ? segs[segs.length - 1].end : { x: ctx.pose.x, y: ctx.pose.y };
  const endPose = frame.pose(ev(endRaw.x, 'End x', step.id), ev(endRaw.y, 'End y', step.id), ev(step.endH ?? 0, 'End heading', step.id));
  const start = { ...ctx.pose };
  const geom = buildPath(segPts.length ? segPts : [[start, start]]);
  const hctx = { ...ctx, start, end: endPose, stepId: step.id };
  const desc = headingDescriptor(step.heading, hctx);
  const issues = [];
  if (desc.k === 'piecewise') {
    for (const iss of validatePiecewise(desc.pieces)) issues.push({ ...iss, stepId: step.id });
  }
  if (!segs.length) issues.push({ level: 'error', stepId: step.id, msg: 'Path has no segments.' });
  geom.segs.forEach((sg, i) => {
    if (sg.length < 1e-6) {
      issues.push({ level: 'error', stepId: step.id, msg: `Segment ${i + 1} has zero length (Pedro throws "Line cannot have zero length").` });
    }
  });
  let interp;
  try {
    interp = makeInterpolator(desc, geom);
  } catch (e) {
    interp = () => start.h;
    issues.push({ level: 'error', stepId: step.id, msg: e.message });
  }
  const maxSpeed = step.maxSpeed === null || step.maxSpeed === undefined || step.maxSpeed === '' ? null : ev(step.maxSpeed, 'Max speed', step.id);
  const timeout = step.timeout === null || step.timeout === undefined || step.timeout === '' ? null : ev(step.timeout, 'Timeout', step.id);
  const during = (step.during || []).map((r) => resolveCommand(r, ctx.settings, ev, step.id));
  const markers = (step.markers || []).map((m) => ({ id: m.id, at: Math.min(Math.max(Number(m.at) || 0, 0), 1), cmd: resolveCommand(m.cmd, ctx.settings, ev, step.id) }));
  return { type: 'path', id: step.id, raw: step, start, end: endPose, segPts, geom, interp, desc, maxSpeed, timeout, during, markers, issues };
}

function resolveZone(z, frame, ev, mirrorActive) {
  const map = mirrorActive && z.mirror ? frame.point : (x, y) => ({ x, y });
  const n = (v, w) => ev(v, `Zone "${z.name}" ${w}`, null);
  const clearance = Math.max(0, n(z.clearance ?? 0, 'clearance'));
  if (z.shape === 'circle') {
    const c = map(n(z.cx, 'cx'), n(z.cy, 'cy'));
    return { id: z.id, name: z.name, kind: 'circle', cx: c.x, cy: c.y, r: Math.max(0, n(z.r, 'r')), clearance, enabled: z.enabled !== false, raw: z };
  }
  let pts;
  if (z.shape === 'rect') {
    const x = n(z.x, 'x');
    const y = n(z.y, 'y');
    const w = n(z.w, 'w');
    const h = n(z.h, 'h');
    pts = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  } else {
    pts = (z.points || []).map((p) => ({ x: n(p.x, 'x'), y: n(p.y, 'y') }));
  }
  return { id: z.id, name: z.name, kind: 'poly', pts: pts.map((p) => map(p.x, p.y)), clearance, enabled: z.enabled !== false, raw: z };
}

export function resolveProject(project, settings, alliance = 'blue') {
  const issues = [];
  const { values } = symbolTable(settings);
  const ev = makeEvaluator(values, issues);
  const frame = makeFrame(settings, alliance);
  const s = project.start || { x: 72, y: 72, h: 0 };
  const start = frame.pose(ev(s.x, 'Start x', 'start'), ev(s.y, 'Start y', 'start'), ev(s.h ?? 0, 'Start heading', 'start'));
  let pose = { ...start };
  const steps = [];
  (project.steps || []).forEach((step, index) => {
    const ctx = { ev, frame, settings, pose };
    let r;
    if (step.type === 'path') {
      r = resolvePath(step, ctx);
      pose = { ...r.end };
    } else if (step.type === 'turn') {
      const h = frame.heading(deg2rad(ev(step.h ?? 0, 'Turn heading', step.id)));
      r = { type: 'turn', id: step.id, raw: step, start: { ...pose }, end: { ...pose, h }, issues: [] };
      pose = { ...r.end };
    } else if (step.type === 'wait') {
      r = { type: 'wait', id: step.id, raw: step, seconds: Math.max(0, ev(step.seconds ?? 0, 'Wait', step.id)), pose: { ...pose }, issues: [] };
    } else if (step.type === 'action') {
      const cmds = (step.cmds || []).map((c) => resolveCommand(c, settings, ev, step.id));
      const timeout = step.timeout === null || step.timeout === undefined || step.timeout === '' ? null : ev(step.timeout, 'Timeout', step.id);
      r = { type: 'action', id: step.id, raw: step, cmds, timeout, pose: { ...pose }, issues: [] };
    } else {
      r = { type: 'java', id: step.id, raw: step, duration: Math.max(0, ev(step.duration ?? 0, 'Duration', step.id)), pose: { ...pose }, issues: [] };
    }
    r.index = index;
    steps.push(r);
  });
  const zones = (project.zones || []).map((z) => resolveZone(z, frame, ev, alliance === 'red'));
  const points = (settings.points || []).map((p) => ({ name: p.name, ...frame.point(ev(p.x, `Point ${p.name} x`, null), ev(p.y, `Point ${p.name} y`, null)) }));
  for (const st of steps) issues.push(...st.issues);
  return { alliance, frame, start, steps, zones, points, issues };
}
