// Compares the visualizer's geometry + heading maths with real Pedro Pathing 3.0.1 output.
// Fixture produced by tests/fixtures/Compare.java compiled against com.pedropathing:core:3.0.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildPath, deg2rad } from '../src/geometry.js';
import { makeInterpolator } from '../src/heading.js';
import { makeFrame } from '../src/resolve.js';
import { DEFAULT_SETTINGS } from '../src/defaults.js';

const P = (x, y, h = 0) => ({ x, y, h: deg2rad(h) });
const red = makeFrame(DEFAULT_SETTINGS, 'red');
const hold = (a, b, s, e) => ({ k: 'piecewise', pieces: [{ until: a, i: { k: 'constant', h: s.h } }, { until: b, i: { k: 'linear', a: s.h, b: e.h } }, { until: 1, i: { k: 'constant', h: e.h } }] });

const CASES = {
  pw: () => {
    const s = P(75, 70, 0);
    const e = P(40, 100, 180);
    return [[[s, P(60, 120), e]], { k: 'piecewise', pieces: [
      { until: 0.1, i: { k: 'tangent' } },
      { until: 0.3, i: { k: 'tangent', rev: true } },
      { until: 0.5, i: { k: 'facing', p: { x: 72, y: 72 } } },
      { until: 0.7, i: { k: 'linear', a: deg2rad(10), b: e.h, long: true } },
      { until: 1, i: { k: 'constant', h: deg2rad(33) } },
    ] }];
  },
  underpass: () => {
    const g = P(136.0625, 136.0625, 0);
    const j = P(82, 112);
    const fs2 = P(82, 24, 90);
    return [[[g, P(82, 137), j], [j, P(82, 107), fs2]], hold(0.2, 0.8, g, fs2)];
  },
  up: () => {
    const st = P(79.9375, 136.0625, -90);
    const g = P(136.0625, 136.0625, 0);
    return [[[st, P(108, 120), g]], hold(0.2, 0.8, st, g)];
  },
  lin: () => [[[P(10, 10), P(50, 30)]], { k: 'piecewise', pieces: [{ until: 0.6, i: { k: 'linear', a: deg2rad(170), b: deg2rad(-170) } }, { until: 1, i: { k: 'constant', h: deg2rad(-170) } }] }],
  upRed: () => {
    const st = red.pose(79.9375, 136.0625, -90);
    const g = red.pose(136.0625, 136.0625, 0);
    return [[[st, red.point(108, 120), g]], hold(0.2, 0.8, st, g)];
  },
};

const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const lines = fs.readFileSync(new URL('./fixtures/pedro-3.0.1-paths.txt', import.meta.url), 'utf8').trim().split('\n');

for (const line of lines) {
  const [name, ...vals] = line.trim().split(' ');
  test(`matches Pedro 3.0.1: ${name}`, () => {
    const [segs, desc] = CASES[name]();
    const geom = buildPath(segs);
    const interp = makeInterpolator(desc, geom);
    vals.forEach((v, i) => {
      const [x, y, h] = v.split(',').map(Number);
      const t = i / (vals.length - 1);
      const q = geom.pointAtParam(t);
      assert.ok(Math.hypot(q.x - x, q.y - y) < 1e-3, `${name} position at t=${t}`);
      assert.ok(angDiff(interp(t), h) < deg2rad(0.05), `${name} heading at t=${t}: ${interp(t)} vs ${h}`);
    });
  });
}
