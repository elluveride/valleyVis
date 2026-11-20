// Regression tests for issues found by the backtest against ValleyLib 2.0.0 / Pedro 3.0.1 source.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateJava } from '../src/codegen.js';
import { DEFAULT_SETTINGS, emptyProject } from '../src/defaults.js';
import { buildPath, deg2rad } from '../src/geometry.js';
import { makeInterpolator } from '../src/heading.js';
import { PRESETS } from '../src/presets.js';
import { resolveProject } from '../src/resolve.js';
import { namedEndPose, nearestPoint } from '../src/poses.js';
import { looksLikeProject, normalizeProject, normalizeSettings } from '../src/schema.js';
import { maxAchievableVelocity, profilePath, simulate } from '../src/simulate.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);
const run = (project) => simulate(resolveProject(project, DEFAULT_SETTINGS, 'blue'), DEFAULT_SETTINGS);
const line = (id, x, y, extra = {}) => ({ id, type: 'path', name: id, endName: `${id}End`, segments: [{ type: 'line', controls: [], end: { x, y } }], endH: 0, heading: { mode: 'constant', hold: 'start' }, during: [], markers: [], ...extra });

test('longLinear matches Pedro at the tie cases (equal headings, exactly 180 degrees apart)', () => {
  const g = buildPath([[{ x: 0, y: 0 }, { x: 10, y: 0 }]]);
  // Angle.turnDirection treats a 180 degree difference as counter-clockwise, so the long way is clockwise
  const half = makeInterpolator({ k: 'linear', a: 0, b: Math.PI, long: true }, g);
  near(half(0.5), (3 * Math.PI) / 2, 1e-9);
  // equal headings: a full clockwise turn
  const full = makeInterpolator({ k: 'linear', a: deg2rad(90), b: deg2rad(90), long: true }, g);
  near(full(0.25), 0, 1e-9);
});

test('an action with a timeout ends at whichever comes first (TimeoutCommand)', () => {
  const p = emptyProject();
  p.steps = [
    { id: 'a', type: 'action', label: '', cmds: [{ lib: 'shoot', params: { timeoutMs: 2500 } }], timeout: 4 },
    { id: 'b', type: 'action', label: '', cmds: [{ lib: 'shoot', params: { timeoutMs: 2500 } }], timeout: 1 },
    { id: 'c', type: 'action', label: '', cmds: [{ lib: 'shoot', params: { timeoutMs: 1000 } }, { lib: 'holdPosition', params: {} }], timeout: 3 },
  ];
  const sim = run(p);
  near(sim.items[0].t1 - sim.items[0].t0, 2.5);
  near(sim.items[1].t1 - sim.items[1].t0, 1);
  near(sim.items[2].t1 - sim.items[2].t0, 3); // parallel with a never-ending command runs to the timeout
  assert.equal(sim.items[2].forever, false);
});

test('a parallel action with a never-ending command and no timeout is flagged', () => {
  const p = emptyProject();
  p.steps = [{ id: 'a', type: 'action', label: '', cmds: [{ lib: 'holdPosition', params: {} }], timeout: null }];
  const sim = run(p);
  assert.equal(sim.items[0].forever, true);
  assert.ok(sim.issues.some((i) => /never finishes/.test(i.msg)));
});

test('a finite command during a path ends early; a never-ending one is cut with the path', () => {
  const p = emptyProject();
  p.steps = [line('go', 100, 60, { during: [{ lib: 'shoot', params: { timeoutMs: 300 } }, { lib: 'intakeTransfer', params: {} }] })];
  const item = run(p).items[0];
  const [shoot, intake] = item.spans;
  near(shoot.t1 - shoot.t0, 0.3);
  near(intake.t1, item.t1);
});

test('top speed depends on drive direction like Pedro\'s mecanum model', () => {
  const m = DEFAULT_SETTINGS.motion;
  near(maxAchievableVelocity(m, 0), m.maxVelForward, 1e-9);
  near(maxAchievableVelocity(m, Math.PI / 2), m.maxVelStrafe, 1e-9);
  const diagonal = maxAchievableVelocity(m, Math.PI / 4);
  assert.ok(diagonal < m.maxVelStrafe && diagonal > 40, String(diagonal));
  const g = buildPath([[{ x: 0, y: 0 }, { x: 120, y: 0 }]]);
  const forward = profilePath(g, makeInterpolator({ k: 'constant', h: 0 }, g), m, 1).duration;
  const strafe = profilePath(g, makeInterpolator({ k: 'constant', h: Math.PI / 2 }, g), m, 1).duration;
  const diag = profilePath(g, makeInterpolator({ k: 'constant', h: Math.PI / 4 }, g), m, 1).duration;
  assert.ok(forward < strafe && strafe < diag, `${forward} < ${strafe} < ${diag}`);
  // follow(path, maxSpeed) above 1 cannot exceed the robot's top speed
  near(profilePath(g, makeInterpolator({ k: 'constant', h: 0 }, g), m, 3).duration, forward, 1e-9);
});

test('piecewise headings on multi-segment paths are exported inside jointSafe()', () => {
  const solo = PRESETS.find((p) => p.id === 'solo').make();
  const out = generateJava(solo, DEFAULT_SETTINGS, resolveProject(solo, DEFAULT_SETTINGS, 'blue'));
  assert.match(out.methods, /\.heading\(jointSafe\(Interpolator\.piecewise\(\)/);
  assert.match(out.methods, /private static Interpolator jointSafe\(Interpolator heading\)/);
  assert.match(out.methods, /Math\.max\(0\.0, t - 1e-9\)/);
  assert.ok(out.warnings.some((w) => /jointSafe/.test(w)));
  // single-segment piecewise paths stay in the plain team style
  const up = PRESETS.find((p) => p.id === 'up').make();
  const upOut = generateJava(up, DEFAULT_SETTINGS, resolveProject(up, DEFAULT_SETTINGS, 'blue'));
  assert.doesNotMatch(upOut.methods, /jointSafe/);
  // linear(start, end, endT) is a piecewise inside Pedro, so it gets the same guard on multi-segment paths
  const p = emptyProject();
  p.steps = [{ ...line('two', 100, 100), segments: [{ type: 'line', controls: [], end: { x: 100, y: 120 } }, { type: 'line', controls: [], end: { x: 100, y: 60 } }], heading: { mode: 'linear', endT: 0.5 } }];
  const two = generateJava(p, DEFAULT_SETTINGS, resolveProject(p, DEFAULT_SETTINGS, 'blue'));
  assert.match(two.methods, /jointSafe\(Interpolator\.piecewise\(\)\s+\.until\(0\.5, Interpolator\.linear\(start, twoEnd\)\)\s+\.until\(1\.0, Interpolator\.constant\(twoEnd\)\)\)/);
});

test('normalizeProject repairs or drops anything malformed', () => {
  for (const junk of [null, undefined, 5, 'x', [], {}, { steps: 'no', zones: 7, start: [] }]) {
    const p = normalizeProject(junk);
    assert.ok(Array.isArray(p.steps) && Array.isArray(p.zones) && typeof p.name === 'string');
    assert.doesNotThrow(() => run(p));
  }
  const p = normalizeProject({
    name: 'x',
    start: { x: 10 },
    steps: [
      { type: 'path' }, { type: 'path', id: 'dup', segments: [{ type: 'curve' }, null, { type: 'curve', controls: [{ x: 1, y: 2 }, 'bad'], end: { x: 3 } }], heading: { mode: 'piecewise', pieces: [null, { until: 'a', mode: 'nope' }] }, markers: [{ at: 7, cmd: { lib: 'shoot' } }, { at: 0.2 }], during: [{}, { lib: 'intake', params: 'x' }] },
      { type: 'action', id: 'dup', cmds: 'x' }, { type: 'wat' }, null, { type: 'turn' }, { type: 'wait', seconds: {} }, { type: 'java', code: 9 },
    ],
    zones: [{ shape: 'rect' }, { shape: 'poly', points: [{ x: 1, y: 1 }] }, { shape: 'circle', clearance: -4 }, null, { shape: 'blob' }],
  });
  assert.deepEqual(p.steps.map((s) => s.type), ['path', 'path', 'action', 'turn', 'wait', 'java']);
  assert.equal(new Set(p.steps.map((s) => s.id)).size, p.steps.length, 'ids are unique');
  assert.equal(p.steps[0].segments.length, 1);
  assert.equal(p.steps[1].segments.length, 2);
  assert.equal(p.steps[1].segments[0].type, 'line'); // a curve without control points is a line
  assert.deepEqual(p.steps[1].segments[1].controls, [{ x: 1, y: 2 }]);
  assert.equal(p.steps[1].markers.length, 1);
  assert.equal(p.steps[1].markers[0].at, 1);
  assert.deepEqual(p.steps[1].during, [{ lib: 'intake', params: {} }]);
  assert.deepEqual(p.zones.map((z) => z.shape), ['rect', 'circle']);
  assert.equal(p.zones[1].clearance, 0);
  assert.doesNotThrow(() => run(p));
  assert.equal(looksLikeProject({ hello: 1 }), false);
  assert.equal(looksLikeProject({ steps: [], start: {} }), true);
});

test('normalizeProject is idempotent and does not change what a valid routine does or exports', () => {
  for (const preset of PRESETS) {
    const p = preset.make();
    const once = normalizeProject(JSON.parse(JSON.stringify(p)));
    assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(once))), once, preset.id);
    const code = (proj) => generateJava(proj, DEFAULT_SETTINGS, resolveProject(proj, DEFAULT_SETTINGS, 'blue')).routineClass;
    assert.equal(code(once), code(p), preset.id);
    near(run(once).routineTotal, run(p).routineTotal, 1e-12);
  }
});

test('normalizeSettings falls back to defaults for wrong types and keeps valid values', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS))), DEFAULT_SETTINGS);
  const s = normalizeSettings({ robot: { length: 18, width: 'wide' }, motion: 3, commands: [{ id: 'x' }, { name: 'no id' }, null], constants: 'x', points: [{ x: 1 }], field: { plusX: 'sideways', snap: 1 } });
  assert.equal(s.robot.length, 18);
  assert.equal(s.robot.width, DEFAULT_SETTINGS.robot.width);
  assert.deepEqual(s.motion, DEFAULT_SETTINGS.motion);
  assert.equal(s.commands.length, 1);
  assert.equal(s.commands[0].type, 'command');
  assert.deepEqual(s.constants, []);
  assert.equal(s.points[0].name, 'Point');
  assert.equal(s.field.plusX, 'up');
  assert.equal(s.field.snap, 1);
});

test('classes used in hand-written Java steps are imported', () => {
  const p = emptyProject();
  p.steps = [{ id: 'j', type: 'java', code: 'b.ifElse(() -> Constants.side == Constants.BACK_SIDE, Commands.none(), new ShootCmd(subsystems.intake, subsystems.pollen, subsystems.transfer, 500));', duration: 0 }];
  const out = generateJava(p, DEFAULT_SETTINGS, resolveProject(p, DEFAULT_SETTINGS, 'blue'));
  for (const imp of ['com.vcs.valleylib.core.command.Commands', 'org.firstinspires.ftc.team2844simple.helpers.Constants', 'org.firstinspires.ftc.team2844simple.commands.shoot.ShootCmd']) {
    assert.ok(out.imports.includes(imp), `missing ${imp}`);
  }
  assert.ok(!out.imports.includes('com.pedropathing.follower.Follower'), 'no unused imports');
});

test('shapes Pedro cannot follow are flagged the way the real library behaves', () => {
  const issuesFor = (segments, heading, extra = {}) => {
    const p = emptyProject();
    p.start = { name: 'start', x: 20, y: 20, h: 0 };
    p.steps = [{ id: 'p', type: 'path', name: 'p', endName: 'e', segments, endH: 0, heading, during: [], markers: [], ...extra }];
    return resolveProject(p, DEFAULT_SETTINGS, 'blue').issues;
  };
  const curve = (controls, end) => ({ type: 'curve', controls, end });
  // first control point on the start: always throws, whatever the heading
  let iss = issuesFor([curve([{ x: 20, y: 20 }], { x: 80, y: 60 })], { mode: 'linear' });
  assert.ok(iss.some((i) => i.throws === true && /first control point/.test(i.msg)));
  // last control point on the end: only a problem for tangent headings
  iss = issuesFor([curve([{ x: 80, y: 60 }], { x: 80, y: 60 })], { mode: 'linear' });
  assert.ok(iss.every((i) => i.level !== 'error') && iss.some((i) => i.level === 'warn' && /last control point/.test(i.msg)));
  iss = issuesFor([curve([{ x: 80, y: 60 }], { x: 80, y: 60 })], { mode: 'tangent' });
  assert.ok(iss.some((i) => i.throws === true && /last control point/.test(i.msg)));
  iss = issuesFor([curve([{ x: 80, y: 60 }], { x: 80, y: 60 })], { mode: 'piecewise', pieces: [{ until: 0.5, mode: 'tangent' }, { until: 1, mode: 'constant', hold: 'end' }] });
  assert.ok(iss.every((i) => i.throws !== true), 'tangent piece that is not last does not throw at the end');
  // on a multi-segment path it depends on rounding, so it is flagged as "can throw"
  iss = issuesFor([curve([{ x: 80, y: 60 }], { x: 80, y: 60 }), { type: 'line', controls: [], end: { x: 100, y: 100 } }], { mode: 'tangent' });
  assert.ok(iss.some((i) => i.throws === 'maybe'));
  // zero-length pieces
  iss = issuesFor([{ type: 'line', controls: [], end: { x: 20, y: 20 } }], { mode: 'linear' });
  assert.ok(iss.some((i) => i.throws === true && /zero length/.test(i.msg)));
  iss = issuesFor([curve([{ x: 20, y: 20 }], { x: 20, y: 20 })], { mode: 'linear' });
  assert.ok(iss.some((i) => i.throws === true && /zero length/.test(i.msg)));
  // out-and-back curve: a cusp warning, not an error
  iss = issuesFor([curve([{ x: 80, y: 20 }], { x: 20, y: 20.0001 })], { mode: 'linear' });
  assert.ok(iss.some((i) => i.level === 'warn' && /doubles back/.test(i.msg)));
  // speed cap of zero
  iss = issuesFor([{ type: 'line', controls: [], end: { x: 80, y: 60 } }], { mode: 'linear' }, { maxSpeed: 0 });
  assert.ok(iss.some((i) => i.throws === true && /Max speed/.test(i.msg)));
  // a normal curve is clean
  assert.equal(issuesFor([curve([{ x: 50, y: 20 }], { x: 80, y: 60 })], { mode: 'tangent' }).length, 0);
});

test('a path that ends on a named pose exports the pose\'s Java', () => {
  const p = emptyProject();
  const path = { id: 'p', type: 'path', name: 'toFlower', endName: 'flower', segments: [{ type: 'line', controls: [], end: { x: 96, y: 'L/2' } }], endH: -90, endRef: 'xFlower', heading: { mode: 'linear' }, during: [], markers: [] };
  p.steps = [path];
  assert.equal(namedEndPose(path, DEFAULT_SETTINGS).name, 'xFlower');
  let out = generateJava(p, DEFAULT_SETTINGS, resolveProject(p, DEFAULT_SETTINGS, 'blue'));
  assert.match(out.methods, /Pose flower = AutoPaths\.xFlower\(f\);/);
  assert.ok(out.imports.includes('org.firstinspires.ftc.team2844simple.autos.AutoPaths'));
  // moved off the pose (or turned): back to plain coordinates, and no stray import
  for (const change of [(s) => { s.segments[0].end.x = 97; }, (s) => { s.endH = 0; }, (s) => { s.endRef = 'nope'; }, (s) => { delete s.endRef; }]) {
    const q = JSON.parse(JSON.stringify(p));
    change(q.steps[0]);
    assert.equal(namedEndPose(q.steps[0], DEFAULT_SETTINGS), null);
    out = generateJava(q, DEFAULT_SETTINGS, resolveProject(q, DEFAULT_SETTINGS, 'blue'));
    assert.match(out.methods, /Pose flower = f\.of\(/);
    assert.ok(!out.imports.includes('org.firstinspires.ftc.team2844simple.autos.AutoPaths'));
  }
  // the tie follows the robot size because the pose is an expression
  const bigger = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  bigger.robot.length = 18;
  assert.equal(namedEndPose(path, bigger).name, 'xFlower');
  // equivalent heading spellings still match
  assert.equal(namedEndPose({ ...path, endH: 270 }, DEFAULT_SETTINGS).name, 'xFlower');
});

test('only poses are magnetic, and only within reach', () => {
  assert.equal(nearestPoint(DEFAULT_SETTINGS, 96.8, 8.5, 2.5).name, 'xFlower');
  assert.equal(nearestPoint(DEFAULT_SETTINGS, 100, 12, 2.5), null);
  assert.equal(nearestPoint(DEFAULT_SETTINGS, 84, 66, 2.5), null, 'aim targets are not places to drive to');
});

test('settings saved before named poses existed gain the team poses once', () => {
  const old = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  old.version = 1;
  old.points = [{ name: 'Blue audience cell', x: 84, y: 66 }, { name: 'My spot', x: 10, y: 10 }];
  const migrated = normalizeSettings(old);
  assert.deepEqual(migrated.points.map((p) => p.name), ['Blue audience cell', 'My spot', 'xFlower', 'yFlower', 'park']);
  assert.equal(migrated.version, DEFAULT_SETTINGS.version);
  // someone who deleted a pose on purpose does not get it back
  const current = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  current.points = current.points.filter((p) => p.name !== 'park');
  assert.ok(!normalizeSettings(current).points.some((p) => p.name === 'park'));
});

test('activeAt reports the step and the commands running at a time', () => {
  const up = PRESETS.find((p) => p.id === 'up').make();
  const sim = run(up);
  let a = sim.activeAt(1);
  assert.equal(a.phase, 'routine');
  assert.equal(a.item.stepId, 'u1');
  assert.deepEqual(a.spans.map((s) => s.name), ['Shoot']);
  a = sim.activeAt(sim.items[1].t0 + 0.5);
  assert.equal(a.item.stepId, 'u2');
  assert.deepEqual(a.spans.map((s) => s.name), ['Intake + transfer']);
  assert.equal(sim.activeAt(sim.routineTotal + 0.5).phase, 'park');
  assert.equal(sim.activeAt(sim.end + 1).phase, 'done');
});
