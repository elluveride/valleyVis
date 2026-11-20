// Makes anything loaded from outside (browser storage, opened files, share links) safe to use:
// wrong types are replaced with defaults, broken entries are dropped, ids are made unique.

import { cloneDeep, DEFAULT_POINTS, DEFAULT_SETTINGS, defaultZones } from './defaults.js';

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
        segments, endH: val(s.endH, 0), ...(typeof s.endRef === 'string' && s.endRef ? { endRef: s.endRef } : {}), heading: heading(s.heading),
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
    case 'vision': {
      const area = (Array.isArray(s.area) ? s.area : []).filter(isObj).map((p) => point(p));
      const spots = (Array.isArray(s.spots) ? s.spots : []).filter(isObj).map((p) => point(p));
      const spot = Number.isInteger(s.spot) && s.spot >= 0 && s.spot < spots.length ? s.spot : 0;
      return {
        id, type: 'vision', name: str(s.name, 'pickup'), label: str(s.label),
        target: s.target === 'nectar' ? 'nectar' : 'pollen',
        area: area.length >= 3 ? area : [{ x: 60, y: 60 }, { x: 84, y: 60 }, { x: 84, y: 84 }, { x: 60, y: 84 }],
        spots: spots.length ? spots : [{ x: 72, y: 72 }],
        spot,
        reach: val(s.reach, 'L/2'),
        maxSpeed: optVal(s.maxSpeed),
        timeout: val(s.timeout, 4),
        scan: val(s.scan, 60),
        during: (Array.isArray(s.during) ? s.during : []).map(cmdRef).filter(Boolean),
      };
    }
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
  s.points = s.points.filter(isObj).map((p) => ({ name: str(p.name, 'Point'), x: val(p.x, 72), y: val(p.y, 72), h: optVal(p.h), java: str(p.java) }));
  // settings saved before version 2 get the team's shared poses added once
  const savedVersion = isObj(raw) && isNum(raw.version) ? raw.version : null;
  if (savedVersion !== null && savedVersion < 2) {
    for (const d of DEFAULT_POINTS) {
      if (d.h !== null && !s.points.some((p) => p.name === d.name)) s.points.push({ ...d });
    }
  }
  s.commands = uniqueIds(s.commands.map(command).filter(Boolean), 'cmd');
  // the park pose and middle corridor may be numbers or expressions; conform() only keeps the default's type
  const rawPark = isObj(raw) && isObj(raw.park) ? raw.park : {};
  const rp = isObj(rawPark.pose) ? rawPark.pose : {};
  const dp = DEFAULT_SETTINGS.park.pose;
  s.park.pose = { x: val(rp.x, dp.x), y: val(rp.y, dp.y), h: val(rp.h, dp.h) };
  s.park.middleX = val(rawPark.middleX, DEFAULT_SETTINGS.park.middleX);
  s.park.firstLegSpeed = rawPark.firstLegSpeed === null ? null : isNum(rawPark.firstLegSpeed) && rawPark.firstLegSpeed > 0 ? rawPark.firstLegSpeed : DEFAULT_SETTINGS.park.firstLegSpeed;
  if (!s.park.edited) {
    // not edited means "the team code", whatever an older version of this app thought that was
    s.park = cloneDeep(DEFAULT_SETTINGS.park);
  } else if (savedVersion !== null && savedVersion < 3) {
    // an edit made before the middle corridor had two x values or the first leg had a speed cap:
    // keep the route the team exported back then
    s.park.middleEndX = isNum(rawPark.middleX) ? rawPark.middleX : s.park.middleEndX;
    s.park.firstLegSpeed = null;
  }
  s.robot.length = Math.max(0.5, s.robot.length);
  s.robot.width = Math.max(0.5, s.robot.width);
  s.field.plusX = oneOf(s.field.plusX, ['up', 'right', 'down', 'left'], 'up');
  s.field.customImagePlusX = oneOf(s.field.customImagePlusX, ['up', 'right', 'down', 'left'], 'up');
  const cam = s.camera;
  cam.hfov = Math.min(170, Math.max(5, cam.hfov));
  cam.vfov = Math.min(170, Math.max(5, cam.vfov));
  cam.height = Math.max(0, cam.height);
  cam.minArea = Math.max(1, cam.minArea);
  cam.lookTime = Math.max(0, cam.lookTime);
  cam.commitDistance = Math.max(0, cam.commitDistance);
  cam.reaimDistance = Math.max(0.5, cam.reaimDistance);
  for (const k of ['idPollen', 'idNectarRed', 'idNectarBlue']) cam[k] = Math.max(1, Math.round(cam[k]));
  s.alliance.redTransform = oneOf(s.alliance.redTransform, ['point', 'mirrorX', 'mirrorY', 'none'], 'point');
  return s;
}
