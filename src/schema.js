// Makes anything loaded from outside (browser storage, opened files, share links) safe to use:
// wrong types are replaced with defaults, broken entries are dropped, ids are made unique.

import { cloneDeep, DEFAULT_SETTINGS, defaultZones } from './defaults.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** A number, or an expression string; anything else becomes the fallback. */
const val = (v, fallback) => (isNum(v) || (typeof v === 'string' && v.trim() !== '') ? v : fallback);
const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const optVal = (v) => (v === null || v === undefined || v === '' ? null : val(v, null));
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

const HEADING_MODES = ['linear', 'constant', 'tangent', 'reverseTangent', 'facing', 'piecewise'];
const PIECE_MODES = ['constant', 'linear', 'tangent', 'reverseTangent', 'facing'];
const REFS = ['start', 'end', 'custom'];

let counter = 0;
function freshId(prefix) {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-n${counter.toString(36)}`;
}

function point(p, fallback = { x: 72, y: 72 }) {
  if (!isObj(p)) return { ...fallback };
  return { x: val(p.x, fallback.x), y: val(p.y, fallback.y) };
}

function cmdRef(r) {
  if (!isObj(r) || typeof r.lib !== 'string') return null;
  return { lib: r.lib, params: isObj(r.params) ? { ...r.params } : {} };
}

function headingFields(h, out) {
  if (out.mode === 'constant') {
    out.hold = oneOf(h.hold, REFS, 'start');
    if (out.hold === 'custom') out.deg = val(h.deg, 0);
  } else if (out.mode === 'linear') {
    out.long = bool(h.long, false);
  } else if (out.mode === 'facing') {
    out.x = val(h.x, 72);
    out.y = val(h.y, 72);
  }
  return out;
}

function piece(p) {
  if (!isObj(p)) return null;
  const out = { until: isNum(Number(p.until)) ? Number(p.until) : 1, mode: oneOf(p.mode, PIECE_MODES, 'constant') };
  headingFields(p, out);
  if (out.mode === 'linear') {
    out.from = oneOf(p.from, REFS, 'start');
    out.to = oneOf(p.to, REFS, 'end');
    if (out.from === 'custom') out.fromDeg = val(p.fromDeg, 0);
    if (out.to === 'custom') out.toDeg = val(p.toDeg, 0);
  }
  return out;
}

function heading(h) {
  if (!isObj(h)) return { mode: 'linear', endT: 1, long: false };
  const out = { mode: oneOf(h.mode, HEADING_MODES, 'linear') };
  headingFields(h, out);
  if (out.mode === 'linear') out.endT = isNum(Number(h.endT)) && Number(h.endT) > 0 ? Math.min(1, Number(h.endT)) : 1;
  if (out.mode === 'piecewise') {
    out.pieces = (Array.isArray(h.pieces) ? h.pieces : []).map(piece).filter(Boolean);
    if (!out.pieces.length) out.pieces = [{ until: 1, mode: 'constant', hold: 'end' }];
  }
  return out;
}

function segment(s) {
  if (!isObj(s)) return null;
  const controls = (Array.isArray(s.controls) ? s.controls : []).filter(isObj).map((c) => point(c));
  const type = s.type === 'curve' && controls.length ? 'curve' : 'line';
  return { type, controls: type === 'curve' ? controls : [], end: point(s.end) };
}

function marker(m) {
  if (!isObj(m)) return null;
  const cmd = cmdRef(m.cmd);
  if (!cmd) return null;
  const at = Number(m.at);
  return { id: str(m.id) || freshId('mk'), at: isNum(at) ? Math.min(1, Math.max(0, at)) : 0.5, cmd };
}

function step(s) {
  if (!isObj(s)) return null;
  const id = str(s.id) || freshId('step');
  switch (s.type) {
    case 'path': {
      const segments = (Array.isArray(s.segments) ? s.segments : []).map(segment).filter(Boolean);
      if (!segments.length) segments.push({ type: 'line', controls: [], end: { x: 72, y: 72 } });
      return {
        id, type: 'path', name: str(s.name, 'path'), endName: str(s.endName, ''),
        segments, endH: val(s.endH, 0), heading: heading(s.heading),
        maxSpeed: optVal(s.maxSpeed), timeout: optVal(s.timeout),
        during: (Array.isArray(s.during) ? s.during : []).map(cmdRef).filter(Boolean),
        markers: (Array.isArray(s.markers) ? s.markers : []).map(marker).filter(Boolean),
      };
    }
    case 'action':
      return { id, type: 'action', label: str(s.label), cmds: (Array.isArray(s.cmds) ? s.cmds : []).map(cmdRef).filter(Boolean), timeout: optVal(s.timeout) };
    case 'wait':
      return { id, type: 'wait', seconds: val(s.seconds, 0) };
    case 'turn':
      return { id, type: 'turn', h: val(s.h, 0) };
    case 'java':
      return { id, type: 'java', code: str(s.code), duration: val(s.duration, 0) };
    default:
      return null;
  }
}

function zone(z) {
  if (!isObj(z)) return null;
  const base = {
    id: str(z.id) || freshId('zone'),
    name: str(z.name, 'Keep-out'),
    clearance: isNum(Number(z.clearance)) ? Math.max(0, Number(z.clearance)) : 2,
    enabled: bool(z.enabled, true),
    mirror: bool(z.mirror, false),
  };
  if (z.shape === 'rect') return { ...base, shape: 'rect', x: val(z.x, 60), y: val(z.y, 60), w: val(z.w, 12), h: val(z.h, 12) };
  if (z.shape === 'circle') return { ...base, shape: 'circle', cx: val(z.cx, 72), cy: val(z.cy, 72), r: val(z.r, 6) };
  if (z.shape === 'poly') {
    const points = (Array.isArray(z.points) ? z.points : []).filter(isObj).map((p) => point(p));
    return points.length >= 3 ? { ...base, shape: 'poly', points } : null;
  }
  return null;
}

function uniqueIds(items, prefix) {
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it.id)) it.id = freshId(prefix);
    seen.add(it.id);
  }
  return items;
}

export function normalizeProject(raw) {
  const p = isObj(raw) ? raw : {};
  const start = isObj(p.start) ? p.start : {};
  return {
    version: 1,
    name: str(p.name, 'New Auto') || 'New Auto',
    className: str(p.className, 'NewAutoRoutine'),
    opModeName: str(p.opModeName, 'New Auto'),
    blueTarget: str(p.blueTarget, 'Constants.BACK_SIDE'),
    redTarget: str(p.redTarget, 'Constants.AUDIENCE_SIDE'),
    start: { name: 'start', x: val(start.x, '72+L/2'), y: val(start.y, '144-W/2'), h: val(start.h, -90) },
    steps: uniqueIds((Array.isArray(p.steps) ? p.steps : []).map(step).filter(Boolean), 'step'),
    zones: Array.isArray(p.zones) ? uniqueIds(p.zones.map(zone).filter(Boolean), 'zone') : defaultZones(),
  };
}

/** True if this looks like a routine at all (used to reject unrelated files). */
export function looksLikeProject(raw) {
  return isObj(raw) && Array.isArray(raw.steps) && isObj(raw.start);
}

function conform(saved, def) {
  if (Array.isArray(def)) return Array.isArray(saved) ? saved : cloneDeep(def);
  if (isObj(def)) {
    const out = {};
    for (const k of Object.keys(def)) out[k] = conform(isObj(saved) ? saved[k] : undefined, def[k]);
    return out;
  }
  if (typeof def === 'number') return isNum(saved) ? saved : def;
  if (typeof def === 'string') return typeof saved === 'string' ? saved : def;
  if (typeof def === 'boolean') return typeof saved === 'boolean' ? saved : def;
  if (def === null) return typeof saved === 'string' ? saved : null;
  return saved ?? def;
}

function command(c) {
  if (!isObj(c) || typeof c.id !== 'string' || !c.id) return null;
  return {
    id: c.id,
    name: str(c.name, c.id),
    type: c.type === 'instant' ? 'instant' : 'command',
    color: /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : '#888888',
    java: str(c.java),
    params: (Array.isArray(c.params) ? c.params : []).filter((p) => isObj(p) && typeof p.key === 'string' && p.key).map((p) => ({ key: p.key, label: str(p.label, p.key), default: p.default ?? 0 })),
    duration: isNum(c.duration) ? String(c.duration) : str(c.duration, '0'),
    requires: str(c.requires),
    imports: str(c.imports),
  };
}

export function normalizeSettings(raw) {
  const s = conform(raw, DEFAULT_SETTINGS);
  s.version = DEFAULT_SETTINGS.version;
  s.constants = s.constants.filter((c) => isObj(c) && typeof c.name === 'string').map((c) => ({ name: c.name, value: isNum(Number(c.value)) ? Number(c.value) : 0, java: str(c.java) }));
  s.points = s.points.filter(isObj).map((p) => ({ name: str(p.name, 'Point'), x: val(p.x, 72), y: val(p.y, 72) }));
  s.commands = uniqueIds(s.commands.map(command).filter(Boolean), 'cmd');
  s.robot.length = Math.max(0.5, s.robot.length);
  s.robot.width = Math.max(0.5, s.robot.width);
  s.field.plusX = oneOf(s.field.plusX, ['up', 'right', 'down', 'left'], 'up');
  s.field.customImagePlusX = oneOf(s.field.customImagePlusX, ['up', 'right', 'down', 'left'], 'up');
  s.alliance.redTransform = oneOf(s.alliance.redTransform, ['point', 'mirrorX', 'mirrorY', 'none'], 'point');
  return s;
}
