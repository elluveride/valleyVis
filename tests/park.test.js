import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateJava } from '../src/codegen.js';
import { cloneDeep, DEFAULT_SETTINGS, emptyProject } from '../src/defaults.js';
import { parkJava, planPark } from '../src/park.js';
import { PRESETS } from '../src/presets.js';
import { resolveProject } from '../src/resolve.js';
import { normalizeSettings } from '../src/schema.js';
import { simulate } from '../src/simulate.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);
const edited = (fn = () => {}) => { const s = cloneDeep(DEFAULT_SETTINGS); s.park.edited = true; fn(s.park); return s; };
const deg = (d) => (d * Math.PI) / 180;

test('team code (AutoPaths of Nov 17): across at 75%, down the corridor, in; red mirrors blue', () => {
  const from = { x: 96, y: 108, h: deg(-90) };
  const blue = planPark(from, 'blue', DEFAULT_SETTINGS);
  assert.equal(blue.pairs.length, 3);
  assert.equal(blue.jump, 0);
  assert.equal(blue.corridor, 'outer');
  near(blue.pairs[0][1].x, 120);
  near(blue.pairs[0][1].y, 108);
  assert.deepEqual(blue.speeds, [0.75, null, null]);
  const mid = planPark({ x: 60, y: 100, h: 0 }, 'blue', DEFAULT_SETTINGS);
  assert.equal(mid.corridor, 'middle');
  near(mid.pairs[0][1].x, 72 + 15.875 / 2); // correctX = f.of(72 + W/2, 0, 0).withY(from.y())
  near(mid.pairs[0][1].y, 100);
  near(mid.pairs[0][1].h, 0);
  near(mid.pairs[1][1].x, 84); // correctY = f.of(84, 24, 0)
  near(mid.pairs[1][1].y, 24);
  near(mid.pairs[2][1].h, Math.PI);
  const red = planPark({ x: 48, y: 36, h: deg(90) }, 'red', DEFAULT_SETTINGS);
  assert.equal(red.jump, 0, 'starts where the robot is');
  near(red.pairs[0][0].x, 48);
  red.pairs.forEach(([, to], i) => {
    near(to.x, 144 - blue.pairs[i][1].x, 1e-9);
    near(to.y, 144 - blue.pairs[i][1].y, 1e-9);
  });
});

test('edited: starts where the robot is and red is an exact mirror of blue', () => {
  const s = edited();
  for (const [x, y, h] of [[96, 108, -90], [30, 120, 0], [110, 40, 45]]) {
    const b = planPark({ x, y, h: deg(h) }, 'blue', s);
    const r = planPark({ x: 144 - x, y: 144 - y, h: deg(h + 180) }, 'red', s);
    assert.equal(b.jump, 0);
    assert.equal(r.jump, 0);
    near(r.pairs[0][0].x, 144 - x, 1e-9);
    assert.equal(b.pairs.length, r.pairs.length);
    b.pairs.forEach(([, bt], i) => {
      near(r.pairs[i][1].x, 144 - bt.x, 1e-9);
      near(r.pairs[i][1].y, 144 - bt.y, 1e-9);
    });
    assert.equal(b.corridor, r.corridor);
  }
});

test('edited: the corridor, approach line, headings and pose all come from the settings', () => {
  const s = edited((p) => { p.middleX = 70; p.outerX = 110; p.middleMaxX = 80; p.approachY = 30; p.corridorH = 0; p.approachH = 90; p.pose = { x: 12, y: '144-W/2', h: 45 }; });
  const mid = planPark({ x: 60, y: 100, h: 0 }, 'blue', s);
  assert.equal(mid.corridor, 'middle');
  near(mid.pairs[0][1].x, 70);
  near(mid.pairs[0][1].h, 0);
  near(mid.pairs[1][1].y, 30);
  near(mid.pairs[1][1].h, deg(90));
  near(mid.pairs[2][1].x, 12);
  near(mid.pairs[2][1].y, 144 - 15.875 / 2);
  near(mid.pairs[2][1].h, deg(45));
  assert.equal(planPark({ x: 90, y: 100, h: 0 }, 'blue', s).corridor, 'outer');
});

test('edited: legs too short to follow are skipped, and an already-parked robot still gets a path', () => {
  const s = edited();
  // robot already on the outer corridor: the first leg would have zero length
  const onCorridor = planPark({ x: 120, y: 100, h: deg(-90) }, 'blue', s);
  assert.equal(onCorridor.pairs.length, 2);
  // park pose on the corridor corner: that leg disappears
  const s2 = edited((p) => { p.pose = { x: 120, y: 24, h: 90 }; });
  assert.equal(planPark({ x: 100, y: 100, h: 0 }, 'blue', s2).pairs.length, 2);
  // nothing left to drive (robot on the corner and the park pose is the corner): one tiny nudge leg
  const parked = planPark({ x: 120, y: 24, h: deg(90) }, 'blue', s2);
  assert.equal(parked.pairs.length, 1);
  near(parked.pairs[0][1].x, 120.01, 1e-9);
  for (const [a, b] of [...onCorridor.pairs, ...parked.pairs]) assert.ok(Math.hypot(b.x - a.x, b.y - a.y) > 0);
});

test('the park export uses the edited values', () => {
  const s = edited((p) => { p.middleX = 70; p.middleEndX = 75; p.outerX = 110.5; p.middleMaxX = 80; p.approachY = 30; p.corridorH = 0; p.approachH = 90; p.pose = { x: '144-L/2', y: 30, h: 90 }; });
  const java = parkJava(s);
  assert.match(java, /return f\.of\(144\.0 - Constants\.ROBOT_LENGTH \/ 2\.0, 30\.0, 90\.0\);/);
  assert.match(java, /boolean middle = blue\.x\(\) < 80\.0;/);
  assert.match(java, /double corridorX = middle \? 70\.0 : 110\.5;/);
  assert.match(java, /double corridorEndX = middle \? 75\.0 : 110\.5;/);
  assert.match(java, /f\.of\(corridorX, blue\.y\(\), 0\.0\),/);
  assert.match(java, /f\.of\(corridorEndX, 30\.0, 90\.0\),/);
  assert.match(java, /Pose blue = normalized\(here, alliance\);/);
  assert.match(java, /i == 0 \? leg\.with\(PedroConstants\.foresightConfig\.maxPathSpeed\.at\(0\.75\)\) : leg/);
  const p = emptyProject();
  assert.equal(generateJava(p, s, resolveProject(p, s, 'blue')).parkRoute, java);
  // the team's own middle corridor x is an expression
  assert.match(parkJava(edited()), /double corridorX = middle \? 72\.0 \+ Constants\.ROBOT_WIDTH \/ 2\.0 : 120\.0;/);
  const full = edited((p) => { p.firstLegSpeed = null; });
  assert.doesNotMatch(parkJava(full), /maxPathSpeed/);
});

test('older saved settings: an unedited park becomes the new team code, an edited one keeps its route', () => {
  const unedited = normalizeSettings({ version: 2, park: { edited: false, middleX: 84, corridorH: -90 } });
  assert.deepEqual(unedited.park, DEFAULT_SETTINGS.park);
  const kept = normalizeSettings({ version: 2, park: { edited: true, middleMaxX: 96, middleX: 84, outerX: 120, approachY: 24, corridorH: -90, approachH: 0, pose: { x: 130, y: 24, h: 180 } } });
  assert.equal(kept.park.middleX, 84);
  assert.equal(kept.park.middleEndX, 84);
  assert.equal(kept.park.firstLegSpeed, null);
  assert.equal(kept.park.corridorH, -90);
});

test('simulation reports an edited park, and a park that cannot finish in time', () => {
  const up = PRESETS.find((x) => x.id === 'up').make();
  const run = (s) => simulate(resolveProject(up, s, 'blue'), s);
  assert.ok(!run(DEFAULT_SETTINGS).issues.some((i) => i.stepId === '__park'));
  assert.ok(run(edited()).issues.some((i) => i.stepId === '__park' && i.level === 'info'));
  const slow = edited();
  slow.match.parkTimeout = 1;
  const sim = run(slow);
  assert.ok(sim.issues.some((i) => /more than AutoBase/.test(i.msg)));
  near(sim.park.t1 - sim.park.t0, 1, 1e-9);
  const bad = edited((p) => { p.pose.x = 'nope'; });
  assert.ok(run(bad).issues.some((i) => i.level === 'error' && /Park x/.test(i.msg)));
});

test('park settings survive storage, including number or expression poses', () => {
  const s = edited((p) => { p.pose = { x: 130, y: 'W/2+10', h: 0 }; p.middleX = 77; });
  const back = normalizeSettings(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back.park, s.park);
  const old = normalizeSettings({ robot: { length: 16 } }); // saved before the park could be edited
  assert.deepEqual(old.park, DEFAULT_SETTINGS.park);
});
