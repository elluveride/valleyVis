// Keep-out checks: the robot footprint (rotated L x W rectangle) must stay at least
// `clearance` inches away from every enabled zone, measured from the robot's edge.

export function robotCorners(pose, L, W) {
  const c = Math.cos(pose.h);
  const s = Math.sin(pose.h);
  const hl = L / 2;
  const hw = W / 2;
  const local = [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]];
  return local.map(([fx, fy]) => ({ x: pose.x + fx * c - fy * s, y: pose.y + fx * s + fy * c }));
}

function pointSegDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(a, b, c, d) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function segSegDist(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function edges(poly) {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
}

/** 0 when the polygons touch or overlap, otherwise the gap between them. */
export function polyPolyDistance(A, B) {
  if (A.length < 2 || B.length < 2) return Infinity;
  if (pointInPoly(A[0], B) || pointInPoly(B[0], A)) return 0;
  let best = Infinity;
  for (const [a, b] of edges(A)) {
    for (const [c, d] of edges(B)) {
      best = Math.min(best, segSegDist(a, b, c, d));
      if (best === 0) return 0;
    }
  }
  return best;
}

export function zoneDistance(robotPoly, zone) {
  if (zone.kind === 'circle') {
    const c = { x: zone.cx, y: zone.cy };
    if (pointInPoly(c, robotPoly)) return 0;
    let d = Infinity;
    for (const [a, b] of edges(robotPoly)) d = Math.min(d, pointSegDist(c, a, b));
    return Math.max(0, d - zone.r);
  }
  return polyPolyDistance(robotPoly, zone.pts);
}

/** How far the footprint pokes outside the 144 x 144 field (0 if fully inside). */
export function wallOverrun(robotPoly) {
  let worst = 0;
  for (const p of robotPoly) {
    worst = Math.max(worst, -p.x, -p.y, p.x - 144, p.y - 144);
  }
  return worst;
}

function pathPoses(m, stepIn = 1) {
  const n = Math.max(12, Math.ceil(m.geom.length / stepIn));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const p = m.geom.pointAt(s);
    out.push({ x: p.x, y: p.y, h: m.interp(m.geom.paramOfCompletion(s)), s });
  }
  return out;
}

function turnPoses(m) {
  const n = Math.max(2, Math.ceil(Math.abs(m.delta) / (Math.PI / 36)));
  const out = [];
  for (let i = 0; i <= n; i++) out.push({ x: m.from.x, y: m.from.y, h: m.from.h + (m.delta * i) / n });
  return out;
}

export function itemPoses(item) {
  if (item.motion.kind === 'seq') return item.motion.parts.flatMap((part) => itemPoses(part));
  if (item.motion.kind === 'path') return pathPoses(item.motion);
  if (item.motion.kind === 'turn') return turnPoses(item.motion);
  return [item.motion.pose];
}

function checkPoses(poses, zones, settings, sink, stepId) {
  const { length: L, width: W } = settings.robot;
  const tol = settings.match.wallTolerance ?? 0.5;
  for (const pose of poses) {
    const poly = robotCorners(pose, L, W);
    for (const z of zones) {
      if (!z.enabled) continue;
      const d = zoneDistance(poly, z);
      const key = `${stepId}|${z.id}`;
      const rec = sink.get(key) || { stepId, zoneId: z.id, zoneName: z.name, clearance: z.clearance, minDist: Infinity, hits: [] };
      rec.minDist = Math.min(rec.minDist, d);
      if (d < z.clearance - 1e-6) rec.hits.push(pose);
      sink.set(key, rec);
    }
    const over = wallOverrun(poly);
    if (over > tol) {
      const key = `${stepId}|wall`;
      const rec = sink.get(key) || { stepId, zoneId: 'wall', zoneName: 'Field wall', clearance: 0, minDist: 0, overrun: 0, hits: [] };
      rec.overrun = Math.max(rec.overrun, over);
      rec.hits.push(pose);
      sink.set(key, rec);
    }
  }
}

function thin(hits, minGap = 3) {
  const out = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(h.x - last.x, h.y - last.y) >= minGap || Math.abs(h.h - last.h) > 0.3) out.push(h);
  }
  return out;
}

export function checkCollisions(sim, resolved, settings) {
  const sink = new Map();
  checkPoses([resolved.start], resolved.zones, settings, sink, 'start');
  for (const item of sim.items) {
    if (item.motion.kind === 'hold') continue;
    checkPoses(itemPoses(item), resolved.zones, settings, sink, item.stepId);
  }
  if (sim.park) {
    for (const leg of sim.park.legs) checkPoses(pathPoses(leg), resolved.zones, settings, sink, 'park');
  }
  const violations = [...sink.values()].filter((r) => r.hits.length).map((r) => ({ ...r, hits: thin(r.hits) }));
  // the pickup drives straight at whatever ball it sees, so a ball near a zone pulls the robot in
  const areaIssues = [];
  for (const step of resolved.steps) {
    if (step.type !== 'vision' || step.area.length < 3) continue;
    for (const z of resolved.zones) {
      if (!z.enabled) continue;
      const d = zoneDistance(step.area, z);
      if (d < z.clearance - 1e-6) areaIssues.push({ level: 'warn', stepId: step.id, zoneId: z.id, msg: `The search area ${d === 0 ? 'overlaps' : `comes within ${d.toFixed(1)} in of`} "${z.name}". The pickup drives straight at the ball, so a ball there would pull the robot into it. Pull the area's corners in.` });
    }
  }
  // closest the robot ever gets to each zone, and on which step
  const closest = {};
  for (const r of sink.values()) {
    if (r.zoneId === 'wall') continue;
    if (!closest[r.zoneId] || r.minDist < closest[r.zoneId].dist) closest[r.zoneId] = { dist: r.minDist, stepId: r.stepId };
  }
  const issues = violations.map((v) => ({
    level: v.stepId === 'park' ? 'warn' : 'error',
    stepId: v.stepId === 'park' ? '__park' : v.stepId === 'start' ? null : v.stepId,
    zoneId: v.zoneId,
    msg: v.zoneId === 'wall'
      ? `${v.stepId === 'park' ? 'Park route' : v.stepId === 'start' ? 'Start pose' : 'Robot'} goes ${v.overrun.toFixed(1)} in past the field wall.`
      : `${v.stepId === 'park' ? 'Park route' : v.stepId === 'start' ? 'Start pose' : 'Robot'} comes within ${v.minDist.toFixed(1)} in of "${v.zoneName}" (needs ${v.clearance} in).`,
  }));
  issues.push(...areaIssues);
  return { violations, issues, closest };
}
