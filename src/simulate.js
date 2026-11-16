// Turns a resolved routine into a timeline: when each step runs, where the robot is,
// and when markers / parallel commands fire. Speeds come from Settings → Motion; they are
// estimates (trapezoid profile + curvature cap), not a model of Pedro's Foresight controller.

import { buildPath, deg2rad, normAngle, normSigned } from './geometry.js';
import { makeInterpolator } from './heading.js';
import { makeFrame } from './resolve.js';

const DS = 0.25; // in between profile samples

function headingVariation(geom, interp, n) {
  let total = 0;
  let prev = interp(geom.paramOfCompletion(0));
  for (let i = 1; i <= n; i++) {
    const h = interp(geom.paramOfCompletion(i / n));
    total += Math.abs(normSigned(h - prev));
    prev = h;
  }
  return total;
}

/** Speed factor (0..1) where consecutive segments meet at an angle: sharp corners ~ stop. */
function jointFactors(geom) {
  const out = [];
  for (let i = 1; i < geom.segs.length; i++) {
    const s = geom.segs[i].startLen / (geom.length || 1);
    const ta = geom.tangentAt(Math.max(0, s - 1e-4));
    const tb = geom.tangentAt(Math.min(1, s + 1e-4));
    out.push({ s, k: Math.max(0, Math.cos(Math.abs(normSigned(tb - ta)))) });
  }
  return out;
}

/**
 * Pedro's mecanum top speed for a drive direction `theta` away from the robot's nose
 * (Mecanum.interpolateVelocity): full forward speed straight ahead, strafe speed sideways,
 * and slower than either on a diagonal.
 */
export function maxAchievableVelocity(motion, theta) {
  const forward = Math.max(1, motion.maxVelForward ?? motion.maxVel ?? 60);
  const strafe = Math.max(1, motion.maxVelStrafe ?? motion.maxVel ?? forward);
  return 1 / (Math.abs(Math.cos(theta)) / forward + Math.abs(Math.sin(theta)) / strafe);
}

/** Trapezoid-ish velocity profile along the path. Returns times[i] at completion s[i]. */
export function profilePath(geom, interp, motion, speedScale = 1) {
  // follow(path, maxSpeed) caps at maxSpeed * max achievable velocity; above 1 it changes nothing
  const scale = Math.min(1, Math.max(0.01, speedScale || 1));
  const accel = Math.max(1, motion.accel);
  const decel = Math.max(1, motion.decel);
  const lateral = Math.max(1, motion.lateralAccel);
  const L = geom.length;
  const turnRate = deg2rad(Math.max(1, motion.turnRate));
  if (L < 1e-6) {
    const dh = headingVariation(geom, interp, 16);
    const dur = dh / turnRate;
    return { duration: dur, s: Float64Array.from([0, 1]), times: Float64Array.from([0, dur]) };
  }
  const n = Math.min(4000, Math.max(3, Math.ceil(L / DS) + 1));
  const ds = L / (n - 1);
  const s = new Float64Array(n);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = i / (n - 1);
    const theta = geom.tangentAt(s[i]) - interp(geom.paramOfCompletion(s[i]));
    const top = maxAchievableVelocity(motion, theta) * scale;
    const k = geom.curvatureAt(s[i]);
    v[i] = k > 1e-6 ? Math.min(top, Math.sqrt(lateral / k)) : top;
  }
  for (const joint of jointFactors(geom)) {
    const i = Math.round(joint.s * (n - 1));
    v[i] = Math.min(v[i], v[i] * joint.k);
  }
  v[0] = 0;
  v[n - 1] = 0;
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * accel * ds));
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * decel * ds));
  const times = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const avg = (v[i] + v[i - 1]) / 2;
    times[i] = times[i - 1] + (avg > 1e-6 ? ds / avg : 0);
  }
  // the robot can't finish before it has turned through the commanded heading change
  const minTurn = headingVariation(geom, interp, 64) / turnRate;
  if (times[n - 1] < minTurn && times[n - 1] > 0) {
    const k = minTurn / times[n - 1];
    for (let i = 0; i < n; i++) times[i] *= k;
  }
  return { duration: times[n - 1], s, times, v };
}

function searchSorted(arr, x) {
  let lo = 0;
  let hi = arr.length - 1;
  if (x <= arr[0]) return 0;
  if (x >= arr[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid; else hi = mid;
  }
  return lo;
}

export function completionAtTime(prof, tau) {
  const { times, s } = prof;
  const i = searchSorted(times, tau);
  if (i >= times.length - 1) return s[s.length - 1];
  const span = times[i + 1] - times[i];
  const f = span > 0 ? (tau - times[i]) / span : 0;
  return s[i] + f * (s[i + 1] - s[i]);
}

export function timeAtCompletion(prof, c) {
  const { times, s } = prof;
  const i = searchSorted(s, c);
  if (i >= s.length - 1) return times[times.length - 1];
  const span = s[i + 1] - s[i];
  const f = span > 0 ? (c - s[i]) / span : 0;
  return times[i] + f * (times[i + 1] - times[i]);
}

function pathItem(step, pose, t0, settings) {
  // the previous step may have left the robot with a different heading than declared;
  // the follower starts from where the robot really is
  const motion = settings.motion;
  const prof = profilePath(step.geom, step.interp, motion, step.maxSpeed ?? 1);
  let dur = prof.duration + motion.settle;
  let cut = false;
  if (step.timeout !== null && step.timeout !== undefined && dur > step.timeout) {
    dur = step.timeout;
    cut = true;
  }
  const t1 = t0 + dur;
  const endS = cut ? completionAtTime(prof, step.timeout) : 1;
  const endPt = step.geom.pointAt(endS);
  const endPose = { x: endPt.x, y: endPt.y, h: step.interp(step.geom.paramOfCompletion(endS)) };
  const spans = [];
  for (const c of step.during) {
    // DeadlineCommand: a command that finishes early just ends; the rest are cut when the follow ends
    spans.push({ name: c.name, color: c.color, t0, t1: Number.isFinite(c.duration) ? Math.min(t1, t0 + c.duration) : t1, kind: 'during' });
  }
  for (const m of step.markers) {
    const tm = t0 + timeAtCompletion(prof, m.at);
    if (tm >= t1) continue;
    const end = Math.min(t1, tm + (Number.isFinite(m.cmd.duration) ? m.cmd.duration : Infinity));
    spans.push({ name: m.cmd.name, color: m.cmd.color, t0: tm, t1: end, kind: 'marker', markerId: m.id, at: m.at });
  }
  return {
    item: { stepId: step.id, index: step.index, type: 'path', t0, t1, motion: { kind: 'path', geom: step.geom, interp: step.interp, prof, startPose: pose }, spans, cut },
    pose: endPose,
  };
}

function turnItem(step, pose, t0, settings) {
  const delta = normSigned(step.end.h - pose.h);
  const moveDur = Math.abs(delta) / deg2rad(Math.max(1, settings.motion.turnRate));
  const t1 = t0 + moveDur + settings.motion.settle;
  return {
    item: { stepId: step.id, index: step.index, type: 'turn', t0, t1, motion: { kind: 'turn', from: { ...pose }, delta, moveDur }, spans: [] },
    pose: { x: pose.x, y: pose.y, h: normAngle(pose.h + delta) },
  };
}

function actionItem(step, pose, t0) {
  // Commands.parallel ends when every command has ended; withTimeout ends at whichever comes first
  const durations = step.cmds.map((c) => c.duration);
  const natural = durations.length ? Math.max(...durations) : 0;
  let dur = step.timeout === null || step.timeout === undefined ? natural : Math.min(natural, Math.max(0, step.timeout));
  const forever = !Number.isFinite(dur);
  if (forever) dur = 0;
  const t1 = t0 + dur;
  const spans = step.cmds.map((c) => ({ name: c.name, color: c.color, t0, t1: Number.isFinite(c.duration) ? Math.min(t1, t0 + c.duration) : t1, kind: 'action' }));
  return { item: { stepId: step.id, index: step.index, type: 'action', t0, t1, forever, motion: { kind: 'hold', pose: { ...pose } }, spans }, pose };
}

function holdItem(step, pose, t0, dur) {
  return { item: { stepId: step.id, index: step.index, type: step.type, t0, t1: t0 + dur, motion: { kind: 'hold', pose: { ...pose } }, spans: [] }, pose };
}

/** AutoPaths.routeToPark, reproduced line for line (including its alliance handling). */
export function parkLegs(from, alliance, settings) {
  const frame = makeFrame(settings, alliance);
  const f = (x, y, hDeg) => frame.pose(x, y, hDeg);
  const L = settings.robot.length;
  const p = alliance === 'red' ? frame.pose(from.x, from.y, (from.h * 180) / Math.PI) : { ...from };
  const inMiddle = alliance === 'red' ? from.x > 96 : from.x < 96;
  const cx = inMiddle ? 84 : 120;
  const correctX = f(cx, from.y, -90);
  const correctY = f(cx, 24, 0);
  const park = f(144 - L / 2, 24, 180);
  return [[p, correctX], [correctX, correctY], [correctY, park]];
}

function parkPlan(fromPose, t0, settings, alliance) {
  const legs = parkLegs(fromPose, alliance, settings).map(([a, b]) => {
    const geom = buildPath([[{ x: a.x, y: a.y }, { x: b.x, y: b.y }]]);
    const interp = makeInterpolator({ k: 'linear', a: a.h, b: b.h }, geom);
    const prof = profilePath(geom, interp, settings.motion, 1);
    return { geom, interp, prof, from: a, to: b };
  });
  let t = t0;
  for (const leg of legs) {
    leg.t0 = t;
    t += leg.prof.duration;
    leg.t1 = t;
  }
  const end = Math.min(t + settings.motion.settle, t0 + settings.match.parkTimeout);
  return { t0, t1: end, legs, jump: Math.hypot(legs[0].from.x - fromPose.x, legs[0].from.y - fromPose.y) };
}

function motionPose(item, t) {
  const m = item.motion;
  const tau = t - item.t0;
  if (m.kind === 'path') {
    const s = completionAtTime(m.prof, Math.min(tau, m.prof.duration));
    const p = m.geom.pointAt(s);
    return { x: p.x, y: p.y, h: m.interp(m.geom.paramOfCompletion(s)), s };
  }
  if (m.kind === 'turn') {
    const f = m.moveDur > 0 ? Math.min(1, tau / m.moveDur) : 1;
    const e = f * f * (3 - 2 * f);
    return { x: m.from.x, y: m.from.y, h: normAngle(m.from.h + m.delta * e) };
  }
  return { ...m.pose };
}

function parkPose(park, t) {
  const leg = park.legs.find((l) => t < l.t1) || park.legs[park.legs.length - 1];
  const tau = Math.max(0, Math.min(t - leg.t0, leg.prof.duration));
  const s = completionAtTime(leg.prof, tau);
  const p = leg.geom.pointAt(s);
  return { x: p.x, y: p.y, h: leg.interp(leg.geom.paramOfCompletion(s)) };
}

export function simulate(resolved, settings) {
  const items = [];
  const issues = [];
  let pose = { ...resolved.start };
  let t = 0;
  for (const step of resolved.steps) {
    let r;
    if (step.type === 'path') r = pathItem(step, pose, t, settings);
    else if (step.type === 'turn') r = turnItem(step, pose, t, settings);
    else if (step.type === 'action') r = actionItem(step, pose, t);
    else if (step.type === 'wait') r = holdItem(step, pose, t, step.seconds);
    else r = holdItem(step, pose, t, step.duration);
    items.push(r.item);
    if (r.item.forever) {
      issues.push({ level: 'error', stepId: step.id, msg: 'This action never finishes on its own (a command that runs forever and no timeout). The routine would stall here until the AutoBase timeout — give it a timeout or run it "during" a path.' });
    }
    if (step.type === 'path' && step.geom.length > 0) {
      const jump = Math.hypot(step.start.x - pose.x, step.start.y - pose.y);
      if (jump > 0.5) issues.push({ level: 'warn', stepId: step.id, msg: `Path starts ${jump.toFixed(1)} in from where the robot is.` });
    }
    pose = r.pose;
    t = r.item.t1;
  }
  const routineTotal = t;
  const timeout = settings.match.routineTimeout;
  const enforce = settings.match.enforceTimeout !== false;
  const cutAt = enforce ? Math.min(routineTotal, timeout) : routineTotal;
  if (routineTotal > timeout + 1e-9) {
    issues.push({ level: 'warn', stepId: null, msg: `Routine runs ${routineTotal.toFixed(2)} s but AutoBase cuts routine() at ${timeout} s.` });
  }
  const routinePoseAt = (tt) => {
    if (!items.length) return { ...resolved.start, itemIndex: -1 };
    const idx = items.findIndex((it) => tt < it.t1);
    const item = idx < 0 ? items[items.length - 1] : items[idx];
    const tc = Math.max(item.t0, Math.min(tt, item.t1));
    return { ...motionPose(item, tc), itemIndex: idx < 0 ? items.length - 1 : idx };
  };
  let park = null;
  if (settings.match.showPark) {
    const from = routinePoseAt(cutAt);
    park = parkPlan(from, cutAt, settings, resolved.alliance);
    if (park.jump > 1) {
      issues.push({ level: 'warn', stepId: null, msg: `AutoBase park route starts ${park.jump.toFixed(1)} in away from the robot (AutoPaths.routeToPark builds its first leg from a re-mirrored pose on ${resolved.alliance}).` });
    }
  }
  const end = park ? park.t1 : cutAt;
  if (park && end > settings.match.autoLength) {
    issues.push({ level: 'warn', stepId: null, msg: `Routine + park ends at ${end.toFixed(2)} s, past the ${settings.match.autoLength} s autonomous period.` });
  }
  const poseAt = (tt) => {
    if (park && tt >= cutAt) return { ...parkPose(park, tt), itemIndex: -2 };
    return routinePoseAt(Math.min(tt, cutAt));
  };
  /** What is happening at time tt: the step on screen and the commands running right then. */
  const activeAt = (tt) => {
    if (tt >= cutAt - 1e-9) {
      if (park && tt < park.t1) return { phase: 'park', item: null, spans: [] };
      return { phase: 'done', item: null, spans: [] };
    }
    const item = items.find((it) => tt < it.t1) || null;
    if (!item) return { phase: 'done', item: null, spans: [] };
    return { phase: 'routine', item, spans: (item.spans || []).filter((sp) => tt >= sp.t0 && tt < sp.t1) };
  };
  return { items, routineTotal, cutAt, park, end, poseAt, activeAt, issues };
}
