import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evalValue, fmtNum, javaValue } from '../src/expr.js';
import { buildPath, deg2rad, normAngle } from '../src/geometry.js';
import { makeInterpolator, validatePiecewise } from '../src/heading.js';
import { polyPolyDistance, robotCorners, wallOverrun, zoneDistance } from '../src/collision.js';
import { DEFAULT_SETTINGS } from '../src/defaults.js';
import { makeFrame, resolveProject } from '../src/resolve.js';
import { parkLegs, profilePath, simulate } from '../src/simulate.js';
import { PRESETS } from '../src/presets.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);

test('expressions evaluate with robot constants and export to Java', () => {
  const scope = { L: 15.875, W: 15.875 };
  near(evalValue('72+L/2', scope), 79.9375);
  near(evalValue('-(144 - W) / 2', scope), -64.0625);
  near(evalValue(12), 12);
  near(evalValue('12.5'), 12.5);
  assert.throws(() => evalValue('Q+1', scope), /unknown name/);
  assert.throws(() => evalValue('1+', scope));
  assert.equal(javaValue('144-L/2', { L: 'Constants.ROBOT_LENGTH' }), '144.0 - Constants.ROBOT_LENGTH / 2.0');
  assert.equal(javaValue(-90), '-90.0');
  assert.equal(fmtNum(79.93751), '79.9375');
  assert.equal(fmtNum(-0), '0.0');
});

test('line geometry: completion equals parameter', () => {
  const g = buildPath([[{ x: 0, y: 0 }, { x: 10, y: 0 }]]);
  near(g.length, 10, 1e-9);
  near(g.pointAt(0.3).x, 3, 1e-9);
  near(g.paramOfCompletion(0.3), 0.3, 1e-9);
  near(g.tangentAt(0.5), 0);
});

test('compound path splits Pedro t by segment length', () => {
  const g = buildPath([[{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 10, y: 0 }, { x: 10, y: 30 }]]);
  near(g.length, 40, 1e-9);
  near(g.segs[0].t1, 0.25, 1e-9);
  const p = g.pointAtParam(0.625); // halfway through segment 2
  near(p.x, 10, 1e-9);
  near(p.y, 15, 1e-9);
  const loc = g.localCompletion(0.625);
  assert.equal(loc.index, 1);
  near(loc.completion, 0.5, 1e-9);
});

test('bezier arc length is close to the analytic value for a straight cubic', () => {
  const g = buildPath([[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]]);
  near(g.length, 3, 1e-6);
});

test('linear interpolation takes the short way, longLinear the long way', () => {
  const g = buildPath([[{ x: 0, y: 0 }, { x: 10, y: 0 }]]);
  const short = makeInterpolator({ k: 'linear', a: deg2rad(170), b: deg2rad(-170) }, g);
  near(normAngle(short(0.5)), Math.PI, 1e-9);
  const long = makeInterpolator({ k: 'linear', a: deg2rad(170), b: deg2rad(-170), long: true }, g);
  near(long(0.5), 0, 1e-9);
});

test('piecewise interpolator re-scales t per piece like Pedro', () => {
  const g = buildPath([[{ x: 0, y: 0 }, { x: 10, y: 0 }]]);
  const pw = makeInterpolator({
    k: 'piecewise',
    pieces: [
      { until: 0.2, i: { k: 'constant', h: 0 } },
      { until: 0.8, i: { k: 'linear', a: 0, b: Math.PI / 2 } },
      { until: 1, i: { k: 'constant', h: Math.PI / 2 } },
    ],
  }, g);
  near(pw(0.1), 0);
  near(pw(0.5), Math.PI / 4, 1e-9); // halfway through the 0.2..0.8 piece
  near(pw(0.95), Math.PI / 2);
  // a tangent piece gets evaluated at the re-scaled t (Pedro 3.0.1 behaviour)
  const arc = buildPath([[{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]]);
  const quirk = makeInterpolator({ k: 'piecewise', pieces: [{ until: 0.5, i: { k: 'constant', h: 0 } }, { until: 1, i: { k: 'tangent' } }] }, arc);
  const t = arc.paramOfCompletion(0.5);
  near(quirk(t + 1e-9), normAngle(arc.tangentAtParam(0)), 1e-3);
});

test('piecewise validation mirrors the Java exceptions', () => {
  assert.ok(validatePiecewise([{ until: 0.5 }, { until: 0.4 }, { until: 1 }]).some((i) => i.level === 'error'));
  assert.ok(validatePiecewise([{ until: 0.5 }]).some((i) => /1\.0/.test(i.msg)));
  assert.equal(validatePiecewise([{ until: 0.3, mode: 'constant' }, { until: 1, mode: 'linear' }]).length, 0);
});

test('robot footprint distance to zones', () => {
  const robot = robotCorners({ x: 10, y: 10, h: 0 }, 10, 10); // spans 5..15
  const rect = [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 20, y: 20 }];
  near(polyPolyDistance(robot, rect), 5, 1e-9);
  const rotated = robotCorners({ x: 10, y: 10, h: Math.PI / 4 }, 10, 10);
  near(polyPolyDistance(rotated, rect), 10 - 5 * Math.SQRT2, 1e-9);
  near(zoneDistance(robot, { kind: 'circle', cx: 25, cy: 10, r: 3 }), 7, 1e-9);
  assert.equal(zoneDistance(robot, { kind: 'circle', cx: 10, cy: 10, r: 1 }), 0);
  near(wallOverrun(robotCorners({ x: 3, y: 72, h: 0 }, 10, 10)), 2, 1e-9);
});

test('red frame is the AutoPaths.RED point mirror', () => {
  const f = makeFrame(DEFAULT_SETTINGS, 'red');
  const p = f.pose(96, 18, -90);
  near(p.x, 48);
  near(p.y, 126);
  near(p.h, deg2rad(90), 1e-9);
});

test('velocity profile respects distance, accel and speed limits', () => {
  const g = buildPath([[{ x: 0, y: 0 }, { x: 100, y: 0 }]]);
  const interp = makeInterpolator({ k: 'constant', h: 0 }, g);
  const motion = { maxVelForward: 50, maxVelStrafe: 50, accel: 50, decel: 50, lateralAccel: 50, turnRate: 180 };
  const prof = profilePath(g, interp, motion, 1);
  // 1 s up to 50 in/s (25 in), 50 in cruise (1 s), 1 s down (25 in) => 3 s
  near(prof.duration, 3, 0.02);
  const half = profilePath(g, interp, motion, 0.5);
  assert.ok(half.duration > prof.duration);
});

test('Up preset simulates and its park route mirrors AutoPaths.routeToPark', () => {
  const project = PRESETS.find((p) => p.id === 'up').make();
  const r = resolveProject(project, DEFAULT_SETTINGS, 'blue');
  assert.equal(r.issues.length, 0);
  const sim = simulate(r, DEFAULT_SETTINGS);
  assert.equal(sim.items.length, 6);
  near(sim.items[0].t1 - sim.items[0].t0, 4); // ShootCmd 4000 ms
  assert.ok(sim.routineTotal < DEFAULT_SETTINGS.match.routineTimeout);
  const legs = parkLegs({ x: 96, y: 108, h: -Math.PI / 2 }, 'blue', DEFAULT_SETTINGS);
  near(legs[0][1].x, 120); // x >= 96 is not "in the middle" -> 120 corridor
  near(legs[2][1].x, 144 - 15.875 / 2);
  near(legs[2][1].y, 24);
});
