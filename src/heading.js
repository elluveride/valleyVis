// Heading interpolators with the exact semantics of Pedro Pathing 3.0.1
// (com.pedropathing.paths.interpolator.Interpolator / PiecewiseInterpolator).
// Every interpolator is a function of Pedro's curve *parameter* t, like the Java one.
//
// Descriptor shapes (radians, field frame):
//   { k: 'constant', h }
//   { k: 'linear', a, b, long }          long=true -> Interpolator.longLinear
//   { k: 'tangent', rev }                rev=true  -> Interpolator.tangent.reverse()
//   { k: 'facing', p: {x, y} }
//   { k: 'piecewise', pieces: [{ until, i: <descriptor> }] }

import { normAngle, normSigned, TAU } from './geometry.js';

/** Interpolator.linear / longLinear deltas, ported operation for operation from Pedro's Angle helpers. */
function linearDelta(a, b, long) {
  const start = normAngle(a);
  const end = normAngle(b);
  if (!long) return normSigned(end - start); // Angle.error(start, end)
  const direction = normAngle(end - start) <= Math.PI ? 1 : -1; // Angle.turnDirection
  const smallest = Math.min(normAngle(start - end), normAngle(end - start)); // Angle.smallestDifference
  return -direction * (TAU - smallest);
}

export function makeInterpolator(desc, geom) {
  switch (desc.k) {
    case 'constant': {
      const h = normAngle(desc.h);
      return () => h;
    }
    case 'linear': {
      const a = normAngle(desc.a);
      const d = linearDelta(desc.a, desc.b, desc.long);
      return (t) => normAngle(a + d * geom.completionOfParam(t));
    }
    case 'tangent': {
      const off = desc.rev ? Math.PI : 0;
      return (t) => normAngle(geom.tangentAtParam(t) + off);
    }
    case 'facing': {
      const { x, y } = desc.p;
      return (t) => {
        const q = geom.pointAtParam(t);
        return normAngle(Math.atan2(y - q.y, x - q.x));
      };
    }
    case 'piecewise':
      return makePiecewise(desc.pieces, geom);
    default:
      throw new Error(`unknown interpolator ${desc.k}`);
  }
}

function makePiecewise(pieces, geom) {
  const sorted = [...pieces].sort((p, q) => p.until - q.until);
  const fns = sorted.map((p) => ({ until: p.until, fn: makeInterpolator(p.i, geom) }));
  return (t) => {
    const completion = geom.completionOfParam(t);
    let idx = fns.findIndex((e) => e.until >= completion - 1e-12);
    if (idx < 0) idx = fns.length - 1;
    const entry = fns[idx];
    const prev = idx > 0 ? fns[idx - 1] : null;
    const t0 = prev ? geom.paramOfCompletion(prev.until) : 0;
    const t1 = geom.paramOfCompletion(entry.until);
    const span = t1 - t0;
    const nt = span > 0 ? Math.min(Math.max((t - t0) / span, 0), 1) : 0;
    // Pedro passes the re-scaled t to the child on the *whole* curve.
    return entry.fn(nt);
  };
}

/** Heading at arc-length completion s. */
export function headingAtCompletion(interp, geom, s) {
  return interp(geom.paramOfCompletion(s));
}

/** Problems a piecewise heading can have that the Java code would throw on or do oddly. */
export function validatePiecewise(pieces) {
  const issues = [];
  if (!pieces.length) {
    issues.push({ level: 'error', throws: true, msg: 'Piecewise heading needs at least one piece.' });
    return issues;
  }
  let last = 0;
  pieces.forEach((p, idx) => {
    if (!(p.until > last)) {
      issues.push({ level: 'error', throws: true, msg: `Piece ${idx + 1}: "until" ${p.until} must be greater than ${last} (Pedro throws IllegalArgumentException).` });
    }
    if (p.until > 1) issues.push({ level: 'error', throws: true, msg: `Piece ${idx + 1}: "until" must be ≤ 1.0 (Pedro throws IllegalArgumentException).` });
    last = Math.max(last, p.until);
  });
  if (Math.abs(last - 1) > 1e-9) {
    issues.push({ level: 'error', throws: true, msg: 'Last piece must end at until = 1.0 (Pedro throws IllegalStateException otherwise).' });
  }
  const quirky = pieces.some((p, idx) => {
    const covers = idx === 0 && p.until >= 1;
    return !covers && (p.i?.k === 'tangent' || p.i?.k === 'facing' || p.mode === 'tangent' || p.mode === 'reverseTangent' || p.mode === 'facing');
  });
  if (quirky) {
    issues.push({
      level: 'warn',
      msg: 'Pedro 3.0.1 evaluates a tangent/facing piece at the re-scaled t, not where the robot is on the path. The preview shows that real behaviour; it may not point where you expect.',
    });
  }
  return issues;
}
