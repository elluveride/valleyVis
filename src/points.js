// Point arrays: the routine as plain (x, y, heading) data, for anything outside ValleyLib
// (drawing on Panels, a custom follower, a spreadsheet).

import { javaIdent } from './codegen.js';
import { bezierPoint, displayDeg } from './geometry.js';
import { resolveProject } from './resolve.js';
import { simulate, timeAtCompletion } from './simulate.js';

export const POINT_DEFAULTS = { content: 'waypoints', format: 'java', alliance: 'blue', spacing: 3, park: false };

const round = (v, d = 3) => {
  const r = Math.round(v * 10 ** d) / 10 ** d;
  return Object.is(r, -0) ? 0 : r;
};

function row(label, x, y, h, t) {
  return { label, x: round(x), y: round(y), h: h === null || h === undefined ? null : round(displayDeg(h), 2), ...(t === undefined ? {} : { t: round(t, 3) }) };
}

/** The poses you placed: start, path joints and ends (optionally control points), turns. */
export function waypointRows(resolved, sim, { controls = false, park = false } = {}) {
  const rows = [row('start', resolved.start.x, resolved.start.y, resolved.start.h)];
  for (const step of resolved.steps) {
    if (step.type === 'turn') rows.push(row(`turn (step ${step.index + 1})`, step.end.x, step.end.y, step.end.h));
    if (step.type !== 'path' || !step.raw.segments?.length) continue;
    const name = step.raw.name || `path ${step.index + 1}`;
    step.segPts.forEach((pts, i) => {
      if (controls) pts.slice(1, -1).forEach((c, k) => rows.push(row(`${name} control ${i + 1}.${k + 1}`, c.x, c.y, null)));
      const last = i === step.segPts.length - 1;
      const end = pts[pts.length - 1];
      // the heading the robot really has there (what Pedro holds at the end of the path)
      const s = (step.geom.segs[i].startLen + step.geom.segs[i].length) / (step.geom.length || 1);
      const h = step.interp(step.geom.paramOfCompletion(last ? 1 : Math.min(1, s)));
      rows.push(row(last ? step.raw.endName || `${name} end` : `${name} joint ${i + 1}`, end.x, end.y, h));
    });
  }
  if (park && sim.park) {
    const labels = sim.park.legs.length === 3 ? ['park corridor', 'park approach', 'park'] : sim.park.legs.map((_, i, a) => (i === a.length - 1 ? 'park' : `park leg ${i + 1}`));
    sim.park.legs.forEach((leg, i) => rows.push(row(labels[i], leg.to.x, leg.to.y, leg.to.h)));
  }
  return rows;
}

/**
 * Points every `spacing` inches of real distance along a path (Pedro's own completion table can be
 * coarse, so it is not used for the spacing). Heading and time come from the same spot on the path.
 */
function samplePath(rows, label, geom, interp, prof, t0, spacing) {
  const emit = (seg, u) => {
    const t = seg.t0 + u * (seg.t1 - seg.t0); // Pedro's parameter for this spot on the whole path
    const p = bezierPoint(seg.pts, u);
    rows.push(row(label, p.x, p.y, interp(t), t0 + timeAtCompletion(prof, geom.completionOfParam(t))));
  };
  let travelled = 0;
  let next = spacing;
  geom.segs.forEach((seg, si) => {
    const n = Math.min(4000, Math.max(64, Math.ceil(seg.length / 0.05)));
    let prev = bezierPoint(seg.pts, 0);
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      const p = bezierPoint(seg.pts, u);
      const step = Math.hypot(p.x - prev.x, p.y - prev.y);
      while (step > 0 && travelled + step >= next - 1e-9) {
        emit(seg, (i - 1 + (next - travelled) / step) / n);
        next += spacing;
      }
      travelled += step;
      prev = p;
    }
    if (si === geom.segs.length - 1) {
      // always end exactly on the end of the path
      const last = rows[rows.length - 1];
      const end = bezierPoint(seg.pts, 1);
      if (!last || Math.hypot(last.x - end.x, last.y - end.y) > 1e-3) emit(seg, 1);
    }
  });
}

/** Points along the simulated drive, about `spacing` inches apart, with the time each is reached. */
export function sampledRows(resolved, sim, { spacing = 3, park = false } = {}) {
  const gap = Math.max(0.25, Number(spacing) || 3);
  const rows = [row('start', resolved.start.x, resolved.start.y, resolved.start.h, 0)];
  for (const item of sim.items) {
    const step = resolved.steps[item.index];
    const label = step?.raw?.name || `step ${item.index + 1}`;
    if (item.motion.kind === 'path') samplePath(rows, label, item.motion.geom, item.motion.interp, item.motion.prof, item.t0, gap);
    else if (item.motion.kind === 'turn') {
      const m = item.motion;
      rows.push(row(`turn (step ${item.index + 1})`, m.from.x, m.from.y, m.from.h + m.delta, item.t0 + m.moveDur));
    }
  }
  if (park && sim.park) {
    for (const leg of sim.park.legs) samplePath(rows, 'park', leg.geom, leg.interp, leg.prof, leg.t0, gap);
  }
  // drop repeats (a zero-length move, or a path that starts where the last one ended)
  return rows.filter((r, i) => i === 0 || r.x !== rows[i - 1].x || r.y !== rows[i - 1].y || r.h !== rows[i - 1].h);
}

const javaNum = (v) => {
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
};

function asJava(rows, { name, sampled, header }) {
  const cols = sampled ? '{x, y, heading°, seconds}' : '{x, y, heading°}';
  const nanNote = rows.some((r) => r.h === null) ? ' Control points have no heading (NaN).' : '';
  const width = Math.max(...rows.map((r) => `{${[r.x, r.y, r.h === null ? 'Double.NaN' : r.h, ...(sampled ? [r.t] : [])].map((v) => (v === 'Double.NaN' ? v : javaNum(v))).join(', ')}},`.length));
  return [
    `// ${header}`,
    `// Each row is ${cols}.${nanNote}`,
    `public static final double[][] ${name} = {`,
    ...rows.map((r) => {
      const vals = [r.x, r.y, r.h === null ? 'Double.NaN' : r.h, ...(sampled ? [r.t] : [])].map((v) => (v === 'Double.NaN' ? v : javaNum(v)));
      return `        ${`{${vals.join(', ')}},`.padEnd(width)} // ${r.label}`;
    }),
    '};',
    '',
  ].join('\n');
}

function asPoses(rows, { name, header }) {
  const calls = rows.map((r) => `f.of(${javaNum(r.x)}, ${javaNum(r.y)}, ${javaNum(r.h ?? 0)}),`);
  const width = Math.max(...calls.map((c) => c.length));
  return [
    `// ${header}`,
    '// f is field() (PoseFactory), so the same array works for blue and red.',
    `Pose[] ${name} = {`,
    ...rows.map((r, i) => `        ${calls[i].padEnd(width)} // ${r.label}${r.h === null ? ' (control point, no heading)' : ''}`),
    '};',
    '',
  ].join('\n');
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function asCsv(rows, sampled) {
  const head = sampled ? ['label', 'x', 'y', 'heading', 'seconds'] : ['label', 'x', 'y', 'heading'];
  return [head.join(','), ...rows.map((r) => [r.label, r.x, r.y, r.h, ...(sampled ? [r.t] : [])].map(csvCell).join(','))].join('\n') + '\n';
}

/**
 * The routine as a point array.
 * opts: { content: 'waypoints' | 'controls' | 'sampled', format: 'java' | 'pose' | 'csv' | 'json',
 *         alliance: 'blue' | 'red', spacing: inches between samples, park: include the park route }
 */
export function pointArray(project, settings, options = {}) {
  const o = { ...POINT_DEFAULTS, ...options };
  // f.of() mirrors for red by itself, so a Pose[] is always written in the blue frame
  const alliance = o.format === 'pose' ? 'blue' : o.alliance === 'red' ? 'red' : 'blue';
  const resolved = resolveProject(project, settings, alliance);
  const sim = simulate(resolved, settings);
  const sampled = o.content === 'sampled';
  const rows = sampled
    ? sampledRows(resolved, sim, { spacing: o.spacing, park: o.park })
    : waypointRows(resolved, sim, { controls: o.content === 'controls', park: o.park });
  const what = sampled ? `points every ${Math.max(0.25, Number(o.spacing) || 3)} in along the drive` : o.content === 'controls' ? 'waypoints and control points' : 'waypoints';
  const frame = alliance === 'red' ? 'red alliance (field coordinates)' : 'blue frame (as entered)';
  const header = `ValleyVis: ${project.name} · ${what} · ${frame} · ${rows.length} points`;
  const base = javaIdent(project.className || project.name, 'routine').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  let text;
  if (o.format === 'json') text = `${JSON.stringify({ routine: project.name, frame: alliance, content: o.content, units: { distance: 'in', heading: 'deg', time: 's' }, points: rows }, null, 2)}\n`;
  else if (o.format === 'csv') text = asCsv(rows, sampled);
  else if (o.format === 'pose') text = asPoses(rows, { name: 'points', header });
  else text = asJava(rows, { name: `${base}_POINTS`, sampled, header });
  return { rows, text, ext: o.format === 'json' ? 'json' : o.format === 'csv' ? 'csv' : 'java' };
}
