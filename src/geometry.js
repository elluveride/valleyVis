// Path geometry mirroring Pedro Pathing 3.0.1:
//  - a path is 1+ segments (Line or BezierCurve), joined like CompoundCurve
//  - "completion" s in [0,1] is arc-length fraction (Curve.pathCompletion)
//  - "parameter" t is Pedro's curve parameter; CompoundCurve splits t by segment length
//    and maps it linearly onto each segment's own parameter.

export const TAU = Math.PI * 2;

/** Pedro Angle.normalize: [0, 2PI). */
export function normAngle(a) {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** Pedro Angle.normalizeSigned: [-PI, PI). */
export function normSigned(a) {
  const n = normAngle(a);
  return n >= Math.PI ? n - TAU : n;
}

export const deg2rad = (d) => (d * Math.PI) / 180;
export const rad2deg = (r) => (r * 180) / Math.PI;

/** Degrees in (-180, 180] for display. */
export function displayDeg(rad) {
  let d = rad2deg(normSigned(rad));
  if (d <= -180) d += 360;
  return Math.round(d * 100) / 100;
}

export function bezierPoint(pts, t) {
  const n = pts.length;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  for (let k = 1; k < n; k++) {
    for (let i = 0; i < n - k; i++) {
      xs[i] = xs[i] * (1 - t) + xs[i + 1] * t;
      ys[i] = ys[i] * (1 - t) + ys[i + 1] * t;
    }
  }
  return { x: xs[0], y: ys[0] };
}

function hodograph(pts) {
  const n = pts.length - 1;
  const out = [];
  for (let i = 0; i < n; i++) out.push({ x: n * (pts[i + 1].x - pts[i].x), y: n * (pts[i + 1].y - pts[i].y) });
  return out;
}

export function bezierDerivative(pts, t) {
  if (pts.length < 2) return { x: 0, y: 0 };
  return bezierPoint(hodograph(pts), t);
}

export function bezierSecond(pts, t) {
  if (pts.length < 3) return { x: 0, y: 0 };
  return bezierPoint(hodograph(hodograph(pts)), t);
}

const SUBDIVISION_TOLERANCE = 1e-5;
const MAX_SUBDIVISION_DEPTH = 15;

/**
 * Pedro's BezierCurve.approximateLength(): adaptive subdivision into a t -> length map.
 * Reproduced exactly (including stopping early on straight-but-unevenly-spaced curves),
 * because headings and markers are driven by this map on the robot.
 */
function pedroCompletionMap(pts) {
  const ts = [0];
  const lens = [0];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const subdivide = (t0, t1, p0, p1, depth) => {
    const tm = (t0 + t1) / 2;
    const pm = bezierPoint(pts, tm);
    const chord = dist(p0, p1);
    const split = dist(p0, pm) + dist(pm, p1);
    if (Math.abs(split - chord) < SUBDIVISION_TOLERANCE || depth >= MAX_SUBDIVISION_DEPTH) {
      const base = lens[lens.length - 1];
      ts.push(tm, t1);
      lens.push(base + dist(p0, pm), base + split);
      return;
    }
    subdivide(t0, tm, p0, pm, depth + 1);
    subdivide(tm, t1, pm, p1, depth + 1);
  };
  subdivide(0, 1, bezierPoint(pts, 0), bezierPoint(pts, 1), 0);
  return { u: Float64Array.from(ts), len: Float64Array.from(lens) };
}

function buildSegment(pts) {
  if (pts.length <= 2) {
    // Pedro Line: completion == parameter, length == chord
    const length = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
    return { pts, u: Float64Array.from([0, 1]), len: Float64Array.from([0, length]), length };
  }
  const { u, len } = pedroCompletionMap(pts);
  return { pts, u, len, length: len[len.length - 1] };
}

/** Linear lookup in a monotone table: find y at x. */
function lookup(xs, ys, x) {
  const n = xs.length - 1;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n]) return ys[n];
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  const f = span > 0 ? (x - xs[lo]) / span : 0;
  return ys[lo] + f * (ys[hi] - ys[lo]);
}

function curvatureOf(d1, d2) {
  const speed = Math.hypot(d1.x, d1.y);
  if (speed < 1e-9) return 0;
  return Math.abs(d1.x * d2.y - d1.y * d2.x) / speed ** 3;
}

/**
 * segments: array of control-point arrays, each [P0, ...controls, Pn].
 * Returns a geometry object with completion/parameter based queries.
 */
export function buildPath(segmentPts) {
  const segs = segmentPts.map(buildSegment);
  const total = segs.reduce((a, s) => a + s.length, 0);
  let acc = 0;
  for (const s of segs) {
    s.startLen = acc;
    acc += s.length;
    s.t0 = total > 0 ? s.startLen / total : 0;
    s.t1 = total > 0 ? acc / total : 1;
  }
  if (segs.length) segs[segs.length - 1].t1 = 1;

  // segment index + local parameter for a completion value
  function locateByCompletion(s) {
    const d = Math.min(Math.max(s, 0), 1) * total;
    let i = 0;
    while (i < segs.length - 1 && d > segs[i].startLen + segs[i].length) i++;
    const seg = segs[i];
    const localLen = d - seg.startLen;
    const lu = seg.length > 0 ? lookup(seg.len, seg.u, localLen) : 0;
    return { i, seg, u: lu };
  }

  function locateByParam(t) {
    const tc = Math.min(Math.max(t, 0), 1);
    let i = 0;
    while (i < segs.length - 1 && tc > segs[i].t1) i++;
    const seg = segs[i];
    const span = seg.t1 - seg.t0;
    const u = span > 0 ? (tc - seg.t0) / span : 0;
    return { i, seg, u: Math.min(Math.max(u, 0), 1) };
  }

  function completionOfLocal({ seg, u }) {
    if (total <= 0) return 0;
    return (seg.startLen + lookup(seg.u, seg.len, u)) / total;
  }

  const geom = {
    segs,
    length: total,
    start: segs.length ? segs[0].pts[0] : { x: 0, y: 0 },
    end: segs.length ? segs[segs.length - 1].pts[segs[segs.length - 1].pts.length - 1] : { x: 0, y: 0 },
    pointAt: (s) => { const l = locateByCompletion(s); return bezierPoint(l.seg.pts, l.u); },
    tangentAt: (s) => { const l = locateByCompletion(s); return tangentAngle(l.seg.pts, l.u); },
    curvatureAt: (s) => {
      const l = locateByCompletion(s);
      return curvatureOf(bezierDerivative(l.seg.pts, l.u), bezierSecond(l.seg.pts, l.u));
    },
    paramOfCompletion: (s) => {
      const l = locateByCompletion(s);
      return l.seg.t0 + l.u * (l.seg.t1 - l.seg.t0);
    },
    completionOfParam: (t) => completionOfLocal(locateByParam(t)),
    pointAtParam: (t) => { const l = locateByParam(t); return bezierPoint(l.seg.pts, l.u); },
    tangentAtParam: (t) => { const l = locateByParam(t); return tangentAngle(l.seg.pts, l.u); },
    /** global completion -> { segment index, completion within that segment } */
    localCompletion: (s) => {
      const l = locateByCompletion(s);
      const local = l.seg.length > 0 ? (s * total - l.seg.startLen) / l.seg.length : 0;
      return { index: l.i, completion: Math.min(Math.max(local, 0), 1) };
    },
  };
  return geom;
}

function tangentAngle(pts, u) {
  let d = bezierDerivative(pts, u);
  if (Math.hypot(d.x, d.y) < 1e-9) {
    // degenerate (e.g. control point on an endpoint): nudge inward
    d = bezierDerivative(pts, Math.min(Math.max(u, 1e-3), 1 - 1e-3));
    if (Math.hypot(d.x, d.y) < 1e-9) {
      const a = pts[0];
      const b = pts[pts.length - 1];
      return Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  return Math.atan2(d.y, d.x);
}

/** Uniform arc-length samples for drawing / simulation. */
export function samplePath(geom, step = 0.5) {
  const n = Math.max(2, Math.ceil(geom.length / step) + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    out.push({ s, ...geom.pointAt(s) });
  }
  return out;
}

/** Closest completion on the path to a point (coarse + refine). */
export function closestCompletion(geom, p) {
  const n = 200;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const q = geom.pointAt(s);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  let lo = Math.max(0, best - 1 / n);
  let hi = Math.min(1, best + 1 / n);
  for (let k = 0; k < 30; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const a = geom.pointAt(m1);
    const b = geom.pointAt(m2);
    const da = (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
    const db = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
    if (da < db) hi = m2; else lo = m1;
  }
  const s = (lo + hi) / 2;
  const q = geom.pointAt(s);
  return { s, dist: Math.hypot(q.x - p.x, q.y - p.y) };
}
