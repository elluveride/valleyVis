import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cloneDeep, DEFAULT_SETTINGS } from '../src/defaults.js';
import { pointArray } from '../src/points.js';
import { PRESETS } from '../src/presets.js';
import { resolveProject } from '../src/resolve.js';
import { simulate } from '../src/simulate.js';

const solo = () => PRESETS.find((p) => p.id === 'solo').make();
const near = (a, b, eps = 0.002) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);

test('waypoints: start, every joint and end, with the heading the robot really has there', () => {
  const { rows } = pointArray(solo(), DEFAULT_SETTINGS);
  assert.deepEqual(rows.map((r) => r.label), ['start', 'intakeFromGarden', 'underpassFromGarden joint 1', 'flippedShoot']);
  near(rows[0].x, 72 + 15.875 / 2);
  near(rows[0].h, -90);
  assert.deepEqual([rows[3].x, rows[3].y, rows[3].h], [82, 24, 90]);
});

test('control points are included on request, with no heading', () => {
  const { rows, text } = pointArray(solo(), DEFAULT_SETTINGS, { content: 'controls' });
  const controls = rows.filter((r) => /control/.test(r.label));
  assert.deepEqual(controls.map((r) => [r.x, r.y, r.h]), [[82, 137, null], [82, 107, null]]);
  assert.match(text, /\{82\.0, 137\.0, Double\.NaN\},\s+\/\/ underpassFromGarden control 1\.1/);
});

test('sampled points follow the simulated drive and carry times', () => {
  const p = solo();
  const { rows } = pointArray(p, DEFAULT_SETTINGS, { content: 'sampled', spacing: 2 });
  const sim = simulate(resolveProject(p, DEFAULT_SETTINGS, 'blue'), DEFAULT_SETTINGS);
  // times are rounded to the millisecond; at ~75 in/s that is up to ~0.04 in of travel
  for (const r of rows) {
    const pose = sim.poseAt(r.t);
    near(pose.x, r.x, 0.05);
    near(pose.y, r.y, 0.05);
  }
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].t >= rows[i - 1].t, 'times only go forward');
    assert.ok(Math.hypot(rows[i].x - rows[i - 1].x, rows[i].y - rows[i - 1].y) <= 2.05, 'spacing respected');
  }
  const last = rows[rows.length - 1];
  assert.deepEqual([last.x, last.y], [82, 24]);
  const withPark = pointArray(p, DEFAULT_SETTINGS, { content: 'sampled', spacing: 2, park: true }).rows;
  assert.ok(withPark.length > rows.length);
  near(withPark[withPark.length - 1].x, 144 - 15.875 / 2, 0.01);
  near(withPark[withPark.length - 1].y, 24, 0.01);
});

test('red coordinates are the mirror of blue; Pose[] stays in the blue frame', () => {
  const blue = pointArray(solo(), DEFAULT_SETTINGS).rows;
  const red = pointArray(solo(), DEFAULT_SETTINGS, { alliance: 'red' }).rows;
  blue.forEach((b, i) => {
    near(red[i].x, 144 - b.x);
    near(red[i].y, 144 - b.y);
  });
  const poses = pointArray(solo(), DEFAULT_SETTINGS, { format: 'pose', alliance: 'red' });
  assert.match(poses.text, /Pose\[\] points = \{/);
  assert.match(poses.text, /f\.of\(82\.0, 24\.0, 90\.0\),\s+\/\/ flippedShoot/);
});

test('every format parses back to the same points', () => {
  const p = solo();
  const opts = { content: 'sampled', spacing: 6, park: true };
  const { rows } = pointArray(p, DEFAULT_SETTINGS, opts);
  const json = JSON.parse(pointArray(p, DEFAULT_SETTINGS, { ...opts, format: 'json' }).text);
  assert.deepEqual(json.points, rows);
  assert.equal(json.units.distance, 'in');
  const csv = pointArray(p, DEFAULT_SETTINGS, { ...opts, format: 'csv' }).text.trim().split('\n');
  assert.equal(csv[0], 'label,x,y,heading,seconds');
  assert.equal(csv.length, rows.length + 1);
  assert.deepEqual(csv[1].split(',').slice(1).map(Number), [rows[0].x, rows[0].y, rows[0].h, rows[0].t]);
  const java = pointArray(p, DEFAULT_SETTINGS, opts).text;
  const arrays = [...java.matchAll(/^\s+\{([^}]*)\},/gm)].map((m) => m[1].split(',').map(Number));
  assert.equal(arrays.length, rows.length);
  assert.deepEqual(arrays[0], [rows[0].x, rows[0].y, rows[0].h, rows[0].t]);
  assert.match(java, /public static final double\[\]\[\] SOLO_VIS_ROUTINE_POINTS = \{/);
});

test('labels with commas or quotes stay intact in CSV', () => {
  const p = solo();
  p.steps[1].endName = 'garden, "far" corner';
  const csv = pointArray(p, DEFAULT_SETTINGS, { format: 'csv' }).text;
  assert.match(csv, /^"garden, ""far"" corner",136\.063,136\.063,0$/m);
});

test('an empty routine still exports its start pose', () => {
  const p = solo();
  p.steps = [];
  for (const format of ['java', 'pose', 'csv', 'json']) {
    const { rows } = pointArray(p, cloneDeep(DEFAULT_SETTINGS), { format });
    assert.equal(rows.length, 1);
  }
});
