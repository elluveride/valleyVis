// A vision pickup planned the way VisionPickupCmd runs it on the robot:
//   1. look along the current heading;
//   2. if nothing is there, turn and scan (camera.scanHeadings: toward the search area first, then
//      the other side), looking as it turns;
//   3. once the ball is seen, drive at it nose-first (a Pedro line facing the ball) and stop
//      when the ball is `reach` inches from the robot's centre.
// The preview only knows where you *expect* a ball (practice spots); the robot uses what it sees.

import { BALLS, canSee, scanDirection, scanHeadings } from './camera.js';
import { pointInPoly } from './collision.js';
import { deg2rad, normSigned } from './geometry.js';

/** Smallest approach the robot bothers driving (Pedro cannot follow a zero-length line). */
export const MIN_MOVE = 0.5;
/** While turning, the preview checks every this many radians whether the ball has come into view. */
const TURN_STEP = deg2rad(1);

/** Where the robot stops: `reach` short of the ball, facing it. Null if it is already there. */
export function approachPose(from, target, reach) {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d - reach < MIN_MOVE) return null;
  const ux = dx / d;
  const uy = dy / d;
  return { x: target.x - ux * reach, y: target.y - uy * reach, h: Math.atan2(dy, dx) };
}

/**
 * Plan a pickup from pose `start` toward the practice spot `spot` (field frame).
 * Returns { found, phases, end }. phases are { kind: 'look', pose, timed } | { kind: 'turn', from, delta,
 * settle } | { kind: 'approach', from, to, target }.
 */
export function planPickup({ start, spot, area, target, reach, scanDeg }, cam) {
  const diameter = (BALLS[target] || BALLS.pollen).diameter;
  const inArea = !!spot && area.length >= 3 && pointInPoly(spot, area);
  const visible = (pose) => inArea && canSee(cam, pose, spot, diameter);
  const phases = [];
  const headings = scanHeadings(start.h, scanDeg, cam.hfov, scanDirection(start, area));
  let seenAt = null;
  if (visible(start)) {
    seenAt = { ...start };
    phases.push({ kind: 'look', pose: { ...start }, timed: false });
  } else {
    phases.push({ kind: 'look', pose: { ...start }, timed: true });
    let cur = start.h;
    for (let k = 1; k < headings.length && !seenAt; k++) {
      const delta = normSigned(headings[k] - cur);
      const n = Math.max(1, Math.ceil(Math.abs(delta) / TURN_STEP));
      for (let i = 1; i <= n; i++) {
        const h = cur + (delta * i) / n;
        if (visible({ x: start.x, y: start.y, h })) {
          phases.push({ kind: 'turn', from: { x: start.x, y: start.y, h: cur }, delta: (delta * i) / n, settle: false });
          seenAt = { x: start.x, y: start.y, h };
          break;
        }
      }
      if (!seenAt) {
        phases.push({ kind: 'turn', from: { x: start.x, y: start.y, h: cur }, delta, settle: true });
        cur += delta;
        phases.push({ kind: 'look', pose: { x: start.x, y: start.y, h: cur }, timed: true });
      }
    }
    if (!seenAt) return { found: false, inArea, phases, end: { x: start.x, y: start.y, h: cur } };
  }
  const to = approachPose(seenAt, spot, reach);
  if (!to) return { found: true, inArea, phases, end: seenAt };
  phases.push({ kind: 'approach', from: seenAt, to, target: { ...spot } });
  return { found: true, inArea, phases, end: to };
}
