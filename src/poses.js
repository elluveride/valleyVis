// Named poses: shared spots like AutoPaths.xFlower(f) that paths can end on and that
// export as their Java expression instead of raw coordinates.

import { evalValue } from './expr.js';
import { symbolTable } from './resolve.js';

function num(v, scope) {
  try {
    return evalValue(v, scope);
  } catch {
    return NaN;
  }
}

const sameAngle = (a, b) => Math.abs(((a - b + 540) % 360) - 180) < 1e-6;

/** Named points with numbers worked out: [{ ...point, px, py, ph (degrees or null) }]. */
export function evaluatedPoints(settings) {
  const scope = symbolTable(settings).values;
  return (settings.points || []).map((p) => ({
    ...p,
    px: num(p.x, scope),
    py: num(p.y, scope),
    ph: p.h === null || p.h === undefined || p.h === '' ? null : num(p.h, scope),
  })).filter((p) => Number.isFinite(p.px) && Number.isFinite(p.py));
}

/**
 * The named pose a path ends on, or null. A path is tied to a named pose by `endRef`,
 * and only while its end still sits exactly on it (drag it away and the tie is ignored).
 */
export function namedEndPose(step, settings) {
  if (!step || !step.endRef) return null;
  const scope = symbolTable(settings).values;
  const pt = evaluatedPoints(settings).find((p) => p.name === step.endRef);
  const last = step.segments?.[step.segments.length - 1];
  if (!pt || !last) return null;
  if (Math.abs(num(last.end.x, scope) - pt.px) > 1e-6 || Math.abs(num(last.end.y, scope) - pt.py) > 1e-6) return null;
  if (pt.ph !== null && !sameAngle(num(step.endH ?? 0, scope), pt.ph)) return null;
  return pt;
}

/** Closest named pose (a point that has a heading) within `radius` inches of a blue-frame position, or null. */
export function nearestPoint(settings, x, y, radius) {
  let best = null;
  let bestD = radius;
  for (const p of evaluatedPoints(settings)) {
    if (p.ph === null) continue; // plain points (aim targets) are not places to drive to
    const d = Math.hypot(p.px - x, p.py - y);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}
