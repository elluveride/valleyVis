// Backtest for the HuskyLens pickup.
//   node vision-check.mjs gen <work> <seed> <scenarios> <routines>   write the Java + scenarios
//   node vision-check.mjs compare <work>                               compare the Java run with the preview
// The Java side (VisionSim) runs the generated VisionPickupCmd closed-loop against a simulated robot
// and camera; this checks it ends where the visualizer said it would.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, cloneDeep } from '../../../src/defaults.js';
import { normalizeProject, normalizeSettings } from '../../../src/schema.js';
import { resolveProject } from '../../../src/resolve.js';
import { simulate } from '../../../src/simulate.js';
import { generateJava } from '../../../src/codegen.js';
import { visionSetup } from '../../../src/visionJava.js';
import { BALLS, robotToPixel, toRobotFrame } from '../../../src/camera.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const [mode, work] = process.argv.slice(2);
let seed = Number(process.argv[4] || 2844);
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const between = (a, b) => a + rnd() * (b - a);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const r2 = (v) => Math.round(v * 100) / 100;

const TEAM = 'org/firstinspires/ftc/team2844simple';

/** Settings whose timing model matches the simulated robot in VisionSim (40 in/s, 90°/s, no ramps). */
function simSettings(cam) {
  const s = cloneDeep(DEFAULT_SETTINGS);
  Object.assign(s.motion, { maxVelForward: 40, maxVelStrafe: 40, accel: 1e6, decel: 1e6, lateralAccel: 1e6, turnRate: 90, settle: 0 });
  Object.assign(s.camera, cam, { calibrated: true });
  return normalizeSettings(s);
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function scenario(i) {
  const cam = {
    x: r2(between(3, 9)), y: r2(between(-3, 3)), height: r2(between(6, 14)), yaw: r2(between(-15, 15)), pitch: r2(between(12, 40)),
    hfov: r2(between(50, 75)), minArea: Math.round(between(60, 160)), lookTime: pick([0.2, 0.3, 0.5]), commitDistance: pick([8, 12, 16]), reaimDistance: pick([2, 3, 5]),
  };
  cam.vfov = r2((2 * Math.atan(Math.tan((cam.hfov * Math.PI) / 360) * 0.75) * 180) / Math.PI);
  const start = { x: r2(between(24, 120)), y: r2(between(24, 120)), h: r2(between(-180, 180)) };
  const bearing = (start.h + pick([between(-25, 25), between(-120, 120), between(-170, 170)])) * Math.PI / 180;
  const range = between(12, 60);
  const ball = { x: r2(start.x + Math.cos(bearing) * range), y: r2(start.y + Math.sin(bearing) * range) };
  const half = between(10, 22);
  // usually the ball sits well inside the search area; sometimes the area is somewhere else
  const outside = rnd() < 0.15;
  const c = outside ? { x: ball.x + (half + between(6, 20)) * pick([1, -1]), y: ball.y } : { x: ball.x + between(-(half - 5), half - 5), y: ball.y + between(-(half - 5), half - 5) };
  const area = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: r2(c.x + u * half), y: r2(c.y + v * half) }));
  const distractor = rnd() < 0.4;
  const other = { x: r2(ball.x + between(-6, 6)), y: r2(ball.y + between(-6, 6)) };
  return {
    id: `v${i}`, alliance: pick([0, 2]), target: pick(['pollen', 'nectar']), start, ball, area, distractor, other,
    reach: pick(['L/2', 6, 9.5]), scan: pick([0, 30, 60, 90, 150]), timeout: 12, cam,
  };
}

function preview(sc) {
  const settings = simSettings(sc.cam);
  const project = normalizeProject({
    name: sc.id, start: sc.start,
    steps: [{ id: 'v', type: 'vision', name: 'pickup', target: sc.target, area: sc.area, spots: [sc.ball], spot: 0, reach: sc.reach, maxSpeed: null, timeout: sc.timeout, scan: sc.scan, during: [] }],
    zones: [],
  });
  const resolved = resolveProject(project, settings, 'blue');
  const sim = simulate(resolved, settings);
  const step = resolved.steps[0];
  const item = sim.items[0];
  return { found: step.plan.found, end: step.end, duration: item.t1 - item.t0, reach: step.reach, turns: step.plan.phases.filter((p) => p.kind === 'turn').length };
}

/** True if, from every heading the scan can reach, the ball is at best within 3 px of the image edge or the size cutoff. */
function edgeOnly(sc) {
  const d = BALLS[sc.target].diameter;
  const cam = sc.cam;
  let margin = -Infinity;
  for (let k = -sc.scan * 4 - 40; k <= sc.scan * 4 + 40; k++) {
    const pose = { x: sc.start.x, y: sc.start.y, h: ((sc.start.h + k / 4) * Math.PI) / 180 };
    const r = toRobotFrame(pose, sc.ball);
    const p = robotToPixel(cam, r.x, r.y, d);
    if (!p.inFront) continue;
    const m = Math.min(p.px, 320 - p.px, p.py, 240 - p.py, p.width - Math.sqrt(cam.minArea));
    margin = Math.max(margin, m);
  }
  return margin < 3;
}

function scenarioLine(sc, p) {
  const c = sc.cam;
  return [
    sc.id, sc.alliance, sc.target === 'pollen' ? 'P' : 'N',
    sc.start.x, sc.start.y, (sc.start.h * Math.PI) / 180,
    sc.ball.x, sc.ball.y, sc.distractor ? 1 : 0, sc.other.x, sc.other.y,
    p.reach, sc.scan, sc.timeout, c.lookTime, c.commitDistance, c.reaimDistance,
    c.x, c.y, c.height, c.yaw, c.pitch, c.hfov, c.vfov, c.minArea,
    sc.area.length, ...sc.area.flatMap((q) => [q.x, q.y]),
  ].join(' ');
}

/** Routines with pickups in them, for the compile check (both export layouts). */
function routine(i) {
  const h = () => pick([{ mode: 'linear' }, { mode: 'constant', hold: 'end' }, { mode: 'tangent' }, { mode: 'facing', x: 72, y: 72 }, { mode: 'linear', endT: 0.5 }]);
  const pathStep = (k, end) => ({ id: `p${k}`, type: 'path', name: `leg${k}`, endName: `pose${k}`, segments: [{ type: rnd() < 0.5 ? 'curve' : 'line', controls: [{ x: r2(between(20, 124)), y: r2(between(20, 124)) }], end }], endH: Math.round(between(-180, 180)), heading: h(), maxSpeed: pick([null, 0.7]), timeout: pick([null, 3]), during: pick([[], [{ lib: 'intakeTransfer', params: {} }]]), markers: pick([[], [{ id: `m${k}`, at: 0.5, cmd: { lib: 'spinUp', params: {} } }]]) });
  const vision = (k) => ({ id: `v${k}`, type: 'vision', name: pick(['pickup', 'grab pollen', 'class', 'here']), target: pick(['pollen', 'nectar']), area: [{ x: 40, y: 40 }, { x: 100, y: 40 }, { x: 100, y: 100 }, { x: 40, y: 100 }], spots: [{ x: 70, y: 70 }], reach: pick(['L/2', 8]), maxSpeed: pick([null, 0.6]), timeout: pick([3, 'L/4']), scan: pick([0, 60]), during: pick([[], [{ lib: 'intakeTransfer', params: {} }]]) });
  const steps = [pathStep(1, { x: 60, y: 30 }), vision(1)];
  steps.push(pick([pathStep(2, { x: 30, y: 110 }), { id: 't2', type: 'turn', h: 90 }]));
  steps.push(pathStep(3, { x: 120, y: 120 }), vision(2), pathStep(4, { x: 20, y: 20 }));
  return normalizeProject({ name: `Vision ${i}`, className: `Vis${i}Routine`, opModeName: `Vis ${i}`, start: { x: 20, y: 72, h: 0 }, steps, zones: [] });
}

if (mode === 'gen') {
  const nScen = Number(process.argv[5] || 200);
  const nRout = Number(process.argv[6] || 20);
  const gen = path.join(work, 'gen');
  const settings = normalizeSettings({ ...cloneDeep(DEFAULT_SETTINGS), camera: { ...DEFAULT_SETTINGS.camera, ballInJava: '' } });
  const files = visionSetup(settings);
  const names = { camera: 'HuskyCamera', subsystem: 'HuskyLensSubsystem', command: 'VisionPickupCmd', check: 'HuskyLensCheck' };
  for (const [k, cls] of Object.entries(names)) write(path.join(gen, TEAM, 'vision', `${cls}.java`), files[k]);
  const baseConstants = fs.readFileSync(path.join(HERE, '..', 'stubs', TEAM, 'helpers', 'Constants.java'), 'utf8');
  write(path.join(gen, TEAM, 'helpers', 'Constants.java'), baseConstants.replace(/}\s*$/, `${files.constants}}\n`));
  const baseSubs = fs.readFileSync(path.join(HERE, '..', 'stubs', TEAM, 'helpers', 'Subsystems.java'), 'utf8');
  write(path.join(gen, TEAM, 'helpers', 'Subsystems.java'), baseSubs.replace('import org.firstinspires.ftc.team2844simple.subsystems.*;', 'import org.firstinspires.ftc.team2844simple.subsystems.*;\nimport org.firstinspires.ftc.team2844simple.vision.HuskyLensSubsystem;').replace(/}\s*$/, ' public HuskyLensSubsystem husky; }\n'));

  const geometries = [];
  for (let i = 0; i < nRout; i++) {
    const project = routine(i);
    const blue = resolveProject(project, settings, 'blue');
    const inline = generateJava(project, settings, blue);
    write(path.join(gen, TEAM, 'autos', 'routines', `${inline.className}.java`), inline.routineClass);
    for (const op of [inline.blueOpMode, inline.redOpMode]) {
      const cls = op.match(/public class (\w+)/)[1];
      const pkg = op.match(/^package ([\w.]+);/m)[1];
      write(path.join(gen, ...pkg.split('.'), `${cls}.java`), op);
    }
    // the team layout, in its own package so the class names do not clash; with a ball-in check
    const teamSettings = cloneDeep(settings);
    teamSettings.code.routinePackage = 'org.firstinspires.ftc.team2844simple.autos.teamroutines';
    teamSettings.camera.ballInJava = i % 2 ? 'subsystems.intake != null' : '';
    const team = generateJava(project, teamSettings, blue);
    write(path.join(gen, TEAM, 'autos', 'teamroutines', `${team.className}.java`), team.teamRoutineClass);
    write(path.join(gen, TEAM, 'autos', 'geometries', `${team.geometryName}.java`), team.geometryClass);
    geometries.push(`org.firstinspires.ftc.team2844simple.autos.geometries.${team.geometryName}`);
  }
  write(path.join(work, 'geometries.txt'), `${geometries.join('\n')}\n`);

  const scen = [];
  const expect = [];
  for (let i = 0; i < nScen; i++) {
    const sc = scenario(i);
    const p = preview(sc);
    scen.push(scenarioLine(sc, p));
    expect.push({ id: sc.id, ...p, sc });
  }
  write(path.join(work, 'scenarios.txt'), `${scen.join('\n')}\n`);
  write(path.join(work, 'expected.json'), JSON.stringify(expect));
  console.log(`wrote ${nRout} routines (both layouts) and ${nScen} pickup scenarios`);
} else if (mode === 'compare') {
  const expect = JSON.parse(fs.readFileSync(path.join(work, 'expected.json'), 'utf8'));
  const lines = fs.readFileSync(path.join(work, 'java.txt'), 'utf8').trim().split('\n');
  const got = new Map(lines.filter((l) => /^v\d/.test(l)).map((l) => { const a = l.split(' '); return [a[0], { found: a[1] === '1', done: a[2] === '1', x: +a[3], y: +a[4], h: +a[5], t: +a[6], follows: +a[7], stillReading: a[8] === '1' }]; }));
  let agree = 0;
  let posMax = 0;
  let headMax = 0;
  const timeErr = [];
  const bad = [];
  const edges = [];
  for (const e of expect) {
    const g = got.get(e.id);
    if (!g) { bad.push(`${e.id}: no Java result`); continue; }
    if (g.stillReading) bad.push(`${e.id}: the HuskyLens kept reading after the pickup ended`);
    // running into the limit is fine when the preview said it would (a wide scan that finds nothing)
    if (!g.done && e.duration < e.sc.timeout - 0.1) bad.push(`${e.id}: the pickup never finished (ran into the ${e.sc.timeout} s limit; the preview said ${e.duration.toFixed(2)} s)`);
    if (g.found !== e.found && edgeOnly(e.sc)) { edges.push(e.id); continue; }
    if (g.found !== e.found) { bad.push(`${e.id}: preview ${e.found ? 'found' : 'did not find'} the ball, the robot ${g.found ? 'did' : 'did not'}`); continue; }
    agree++;
    const dpos = Math.hypot(g.x - e.end.x, g.y - e.end.y);
    const dh = Math.abs(Math.atan2(Math.sin(g.h - e.end.h), Math.cos(g.h - e.end.h))) * 180 / Math.PI;
    posMax = Math.max(posMax, dpos);
    if (e.found) headMax = Math.max(headMax, dh);
    timeErr.push(Math.abs(g.t - e.duration));
    if (dpos > 1.5 || (e.found && dh > 4)) bad.push(`${e.id}: ends ${dpos.toFixed(2)} in / ${dh.toFixed(1)}° from the preview (robot ${g.x.toFixed(1)},${g.y.toFixed(1)} vs ${e.end.x.toFixed(1)},${e.end.y.toFixed(1)})`);
  }
  timeErr.sort((a, b) => a - b);
  const pct = (q) => timeErr[Math.min(timeErr.length - 1, Math.floor(q * timeErr.length))] ?? 0;
  const found = expect.filter((e) => e.found).length;
  console.log(`pickups: ${expect.length} scenarios (${found} where the ball is found, ${expect.filter((e) => e.turns > 0).length} that turn to scan, ${expect.filter((e) => e.sc.distractor).length} with the other alliance's nectar in view)`);
  console.log(`found / not found agrees with the preview: ${agree} / ${expect.length}`);
  console.log(`end pose vs preview: worst ${posMax.toFixed(2)} in, ${headMax.toFixed(2)}°`);
  console.log(`time vs preview: median ${pct(0.5).toFixed(3)} s, 95% ${pct(0.95).toFixed(3)} s, worst ${pct(1).toFixed(3)} s`);
  if (edges.length) console.log(`  (${edges.length} more where the ball only ever reaches the edge of the image or the blob-size cutoff: ${edges.join(', ')}. Either answer is fair there.)`);
  const check = lines.filter((l) => l.startsWith('CHECK'));
  const runtime = lines.filter((l) => l.startsWith('RUNTIME'));
  console.log(`HuskyLensCheck ran: ${check.length ? check[0].slice(6) : 'NO'}`);
  console.log(`paths that start after a pickup, built from 6 robot poses each: ${runtime.reduce((a, l) => a + Number(l.split(' ')[2]), 0)} builds, no exceptions`);
  if (bad.length) {
    console.log(`${bad.length} problem(s):`);
    for (const b of bad.slice(0, 30)) console.log(`  ${b}`);
    process.exitCode = 1;
  }
}
