// Random routines for the backtest: every feature the editor has, plus shapes Pedro rejects.
// usage: node fuzz-export.mjs <outDir> <seed> <count>
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, emptyProject } from '../../src/defaults.js';
import { resolveProject } from '../../src/resolve.js';
import { simulate } from '../../src/simulate.js';
import { checkCollisions } from '../../src/collision.js';
import { lintProject } from '../../src/lint.js';
import { normalizeProject } from '../../src/schema.js';
import { generateJava } from '../../src/codegen.js';

let seed = Number(process.argv[3] || 1);
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (n) => Math.floor(rnd() * n);
const coord = () => pick([Math.round(10 + rnd() * 124), Math.round((10 + rnd() * 124) * 2) / 2, '144-L/2', 'W/2', '72+L/2', '(144 - W) / 2', '-L/2 + 100']);
const deg = () => pick([0, 90, -90, 180, 45, Math.round(rnd() * 360 - 180), 'L*2']);
const NAMES = ['go', 'to garden', 'class', '2nd pass', 'sweep', 'b', 'f', 'start', 'reached', 'jointSafe', 'path', 'Pose', 'héllo wörld', '', 'x-y', 'subsystems'];
const libs = DEFAULT_SETTINGS.commands;
const cmd = () => { const l = pick(libs); const params = {}; for (const p of l.params) if (rnd() < 0.6) params[p.key] = pick([p.default, 1500, 0.4, 250]); return { lib: l.id, params }; };
const ref = () => pick(['start', 'end', 'custom']);
const piece = (until) => {
  const mode = pick(['constant', 'linear', 'tangent', 'reverseTangent', 'facing']);
  const p = { until, mode };
  if (mode === 'constant') { p.hold = ref(); if (p.hold === 'custom') p.deg = deg(); }
  if (mode === 'linear') { p.from = ref(); p.to = ref(); p.long = rnd() < 0.3; if (p.from === 'custom') p.fromDeg = deg(); if (p.to === 'custom') p.toDeg = deg(); }
  if (mode === 'facing') { p.x = coord(); p.y = coord(); }
  return p;
};
const heading = () => {
  const mode = pick(['linear', 'linear', 'constant', 'tangent', 'reverseTangent', 'facing', 'piecewise', 'piecewise']);
  const h = { mode };
  if (mode === 'linear') { h.endT = pick([1, 1, 0.6, 0.25]); h.long = rnd() < 0.3; }
  if (mode === 'constant') { h.hold = ref(); if (h.hold === 'custom') h.deg = deg(); }
  if (mode === 'facing') { h.x = coord(); h.y = coord(); }
  if (mode === 'piecewise') { const n = 1 + int(4); h.pieces = []; for (let i = 0; i < n; i++) h.pieces.push(piece(i === n - 1 ? 1 : Math.round(((i + 1) / n) * 100) / 100)); }
  return h;
};
const step = (i) => {
  const type = pick(['path', 'path', 'path', 'action', 'action', 'wait', 'turn', 'java']);
  const id = `s${i}`;
  if (type === 'path') {
    const nseg = 1 + int(3);
    const segments = [];
    for (let k = 0; k < nseg; k++) { const nc = int(4); segments.push({ type: nc ? 'curve' : 'line', controls: Array.from({ length: nc }, () => ({ x: coord(), y: coord() })), end: { x: coord(), y: coord() } }); }
    return { id, type, name: pick(NAMES), endName: pick(NAMES), segments, endH: deg(), heading: heading(), maxSpeed: pick([null, null, 0.5, 1]), timeout: pick([null, null, 3, 0.75]), during: Array.from({ length: int(3) }, cmd), markers: Array.from({ length: int(3) }, (_, m) => ({ id: `${id}m${m}`, at: Math.round(rnd() * 100) / 100, cmd: cmd() })) };
  }
  if (type === 'action') return { id, type, label: pick(['', 'shoot', 'note */ with // odd chars', 'line1']), cmds: Array.from({ length: int(4) }, cmd), timeout: pick([null, null, 2, 0.5]) };
  if (type === 'wait') return { id, type, seconds: pick([0, 0.5, 2, 'L/10']) };
  if (type === 'turn') return { id, type, h: deg() };
  return { id, type, code: pick(['b.waitUntilDriveIdle();', '// just a note', 'b.ifElse(() -> Constants.side == Constants.BACK_SIDE, Commands.none(), Commands.none());', '']), duration: 0 };
};

const out = process.argv[2];
const n = Number(process.argv[4] || 40);
let issuesSeen = 0;
const expectations = [];
const allProjects = [];
for (let c = 0; c < n; c++) {
  const p = emptyProject();
  p.name = `Fuzz ${c}`; p.className = `Fuzz${c}Routine`; p.opModeName = `Fuzz ${c}`;
  p.start = { name: 'start', x: coord(), y: coord(), h: deg() };
  p.steps = Array.from({ length: 1 + int(9) }, (_, i) => step(i));
  const bad = rnd() < 0.35 ? pick(['zero', 'order', 'speed', 'short', 'ctlStart', 'ctlEnd', 'ctlStart', 'ctlEnd', 'ctlBoth']) : null;
  const firstPath = p.steps.find((s) => s.type === 'path');
  if (bad && firstPath) {
    if (bad === 'zero') { const k = firstPath.segments.length - 1; firstPath.segments.push({ type: 'line', controls: [], end: { ...firstPath.segments[k].end } }); }
    if (bad === 'order') firstPath.heading = { mode: 'piecewise', pieces: [{ until: 0.6, mode: 'constant', hold: 'start' }, { until: 0.4, mode: 'tangent' }, { until: 1, mode: 'constant', hold: 'end' }] };
    if (bad === 'short') firstPath.heading = { mode: 'piecewise', pieces: [{ until: 0.6, mode: 'constant', hold: 'start' }] };
    if (bad === 'speed') firstPath.maxSpeed = 0;
    if (bad.startsWith('ctl')) {
      // put a control point exactly on a curve's start or end, on a random segment
      const paths = p.steps.filter((s) => s.type === 'path');
      const target = pick(paths);
      const k = int(target.segments.length);
      const seg = target.segments[k];
      const idx = p.steps.indexOf(target);
      let startPt = p.start;
      if (k > 0) startPt = target.segments[k - 1].end;
      else { for (let q = idx - 1; q >= 0; q--) if (p.steps[q].type === 'path') { startPt = p.steps[q].segments.at(-1).end; break; } }
      seg.type = 'curve';
      if (!seg.controls.length) seg.controls = [{ x: coord(), y: coord() }];
      if (bad !== 'ctlEnd') seg.controls[0] = { x: startPt.x, y: startPt.y };
      if (bad !== 'ctlStart') seg.controls[seg.controls.length - 1] = { x: seg.end.x, y: seg.end.y };
    }
  }
  const proj = normalizeProject(p);
  for (const al of ['blue', 'red']) {
    const r = resolveProject(proj, DEFAULT_SETTINGS, al);
    const sim = simulate(r, DEFAULT_SETTINGS);
    const col = checkCollisions(sim, r, DEFAULT_SETTINGS);
    issuesSeen += r.issues.length + sim.issues.length + col.issues.length + lintProject(proj, r).length;
    for (let t = 0; t <= sim.end + 1; t += 0.37) { const q = sim.poseAt(t); if (![q.x, q.y, q.h].every(Number.isFinite)) throw new Error(`NaN pose in case ${c} at t=${t}`); }
  }
  const verdict = {};
  for (const al of ['blue', 'red']) {
    const r = resolveProject(proj, DEFAULT_SETTINGS, al);
    const all = [...r.issues, ...lintProject(proj, r)].filter((i) => i.level === 'error' && i.throws);
    verdict[al] = all.filter((i) => i.throws === true).map((i) => i.msg);
    verdict[al + 'Maybe'] = all.filter((i) => i.throws === 'maybe').map((i) => i.msg);
  }
  expectations.push({ c, bad: firstPath ? bad : null, ...verdict });
  allProjects.push(proj);
  const g = generateJava(proj, DEFAULT_SETTINGS, resolveProject(proj, DEFAULT_SETTINGS, 'blue'));
  const write = (pkg, src) => { const cls = src.match(/public (?:abstract )?class (\w+)/)[1]; const dir = path.join(out, ...pkg.split('.')); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${cls}.java`), src); };
  write(DEFAULT_SETTINGS.code.routinePackage, g.routineClass);
  write(DEFAULT_SETTINGS.code.bluePackage, g.blueOpMode);
  write(DEFAULT_SETTINGS.code.redPackage, g.redOpMode);
}
fs.writeFileSync(path.join(out, 'expect.json'), JSON.stringify(expectations));
fs.writeFileSync(path.join(out, 'projects.json'), JSON.stringify(allProjects));
console.log(`wrote ${n} random routines (${issuesSeen} issues reported across them, no NaN poses)`);
