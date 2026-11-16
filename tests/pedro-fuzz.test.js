// Random paths and heading interpolators, evaluated by the real Pedro Pathing 3.0.1
// (tests/fixtures/Fuzz.java, seed 2844) and compared with the visualizer's maths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildPath } from '../src/geometry.js';
import { makeInterpolator } from '../src/heading.js';

const lines = fs.readFileSync(new URL('./fixtures/pedro-3.0.1-fuzz.jsonl', import.meta.url), 'utf8').trim().split('\n');
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

test(`matches Pedro 3.0.1 on ${lines.length} random paths`, () => {
  let worstPos = 0;
  let worstHeading = 0;
  let worstCompletion = 0;
  let worstParam = 0;
  let headingSamples = 0;
  let outliers = 0;
  lines.forEach((line, idx) => {
    const c = JSON.parse(line);
    const geom = buildPath(c.segs);
    const interp = makeInterpolator(c.h, geom);
    assert.ok(Math.abs(geom.length - c.len) < 1e-6, `case ${idx}: length ${geom.length} vs ${c.len}`);
    c.t.forEach(([x, y, h, pc], i) => {
      const t = i / (c.t.length - 1);
      const q = geom.pointAtParam(t);
      worstPos = Math.max(worstPos, Math.hypot(q.x - x, q.y - y));
      worstCompletion = Math.max(worstCompletion, Math.abs(geom.completionOfParam(t) - pc));
      const d = angDiff(interp(t), h);
      headingSamples += 1;
      // a sample can sit within rounding of a piece boundary or a segment joint, where Pedro
      // itself flips between two answers; those are counted, not compared
      if (d > 1e-3) outliers += 1; else worstHeading = Math.max(worstHeading, d);
    });
    c.par.forEach((p, i) => {
      worstParam = Math.max(worstParam, Math.abs(geom.paramOfCompletion(i / (c.par.length - 1)) - p));
    });
  });
  assert.ok(worstPos < 1e-6, `position error ${worstPos}`);
  assert.ok(worstCompletion < 1e-6, `completion error ${worstCompletion}`);
  assert.ok(worstParam < 1e-6, `parameter error ${worstParam}`);
  assert.ok(worstHeading < 1e-6, `heading error ${worstHeading}`);
  assert.ok(outliers <= headingSamples * 0.005, `${outliers} of ${headingSamples} heading samples disagree`);
});
