// HuskyLens camera model: a pinhole camera on the robot looking at balls lying on the tiles.
// The generated Java (HuskyCamera.java) uses exactly the same maths, operation for operation.
//
// Robot frame: x forward, y left, z up, inches; headings in radians, counter-clockwise.
// Image: 320 x 240 pixels, centre (160, 120), x to the right, y down (FTC HuskyLens docs).

export const IMG_W = 320;
export const IMG_H = 240;
export const BALLS = {
  pollen: { name: 'pollen', diameter: 2.8 }, // BIOBUZZ manual 9.8: about 2.8 in, yellow
  nectar: { name: 'nectar', diameter: 3.6 }, // about 3.6 in, red or blue
};

const rad = (d) => (d * Math.PI) / 180;

export function focal(cam) {
  return {
    fx: IMG_W / 2 / Math.tan(rad(cam.hfov) / 2),
    fy: IMG_H / 2 / Math.tan(rad(cam.vfov) / 2),
  };
}

/** Pixel (blob centre) -> ball centre relative to the robot, or null if that ray never comes down to the ball. */
export function pixelToRobot(cam, px, py, diameter) {
  const { fx, fy } = focal(cam);
  const a = (IMG_W / 2 - px) / fx; // left of the optical axis
  const b = (py - IMG_H / 2) / fy; // below the optical axis
  const th = rad(cam.pitch);
  const ps = rad(cam.yaw);
  const cx = Math.cos(th) - b * Math.sin(th);
  const cz = -Math.sin(th) - b * Math.cos(th);
  const rx = cx * Math.cos(ps) - a * Math.sin(ps);
  const ry = cx * Math.sin(ps) + a * Math.cos(ps);
  const ballZ = diameter / 2;
  if (!(cz < -1e-9) || !(cam.height > ballZ)) return null;
  const t = (ballZ - cam.height) / cz;
  return { x: cam.x + t * rx, y: cam.y + t * ry, range: t * Math.sqrt(rx * rx + ry * ry + cz * cz) };
}

/** Ball centre relative to the robot -> where the HuskyLens sees it: pixel, blob width, distance. */
export function robotToPixel(cam, x, y, diameter) {
  const { fx, fy } = focal(cam);
  const th = rad(cam.pitch);
  const ps = rad(cam.yaw);
  const vx0 = x - cam.x;
  const vy0 = y - cam.y;
  const vz = diameter / 2 - cam.height;
  const vx = vx0 * Math.cos(ps) + vy0 * Math.sin(ps);
  const vy = -vx0 * Math.sin(ps) + vy0 * Math.cos(ps);
  const fwd = vx * Math.cos(th) - vz * Math.sin(th);
  const up = vx * Math.sin(th) + vz * Math.cos(th);
  if (!(fwd > 1e-6)) return { inFront: false };
  return {
    inFront: true,
    px: IMG_W / 2 - (fx * vy) / fwd,
    py: IMG_H / 2 - (fy * up) / fwd,
    width: (diameter * fx) / fwd,
    range: Math.sqrt(vx0 * vx0 + vy0 * vy0 + vz * vz),
  };
}

/** Field <-> robot-relative, for a robot at pose {x, y, h}. */
export function toRobotFrame(pose, p) {
  const dx = p.x - pose.x;
  const dy = p.y - pose.y;
  const c = Math.cos(pose.h);
  const s = Math.sin(pose.h);
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

export function toFieldFrame(pose, r) {
  const c = Math.cos(pose.h);
  const s = Math.sin(pose.h);
  return { x: pose.x + r.x * c - r.y * s, y: pose.y + r.x * s + r.y * c };
}

/** Can the HuskyLens on a robot at `pose` see a ball at field point `p` as a big-enough blob? */
export function canSee(cam, pose, p, diameter) {
  const r = toRobotFrame(pose, p);
  const pix = robotToPixel(cam, r.x, r.y, diameter);
  if (!pix.inFront) return false;
  if (pix.px < 0 || pix.px > IMG_W || pix.py < 0 || pix.py > IMG_H) return false;
  // the HuskyLens reports whole pixels, so size the blob the same way
  const w = Math.round(pix.width);
  return w * w >= cam.minArea;
}

/** Furthest a ball can be (straight ahead) and still make a big-enough blob. */
export function maxRange(cam, diameter) {
  const { fx } = focal(cam);
  return (diameter * fx) / Math.sqrt(Math.max(1, cam.minArea));
}

/**
 * What the camera can see on the floor, as a polygon in field coordinates (cut off at the
 * distance where a ball gets too small to detect).
 */
export function viewFootprint(cam, pose, diameter) {
  const far = maxRange(cam, diameter);
  const ballZ = diameter / 2;
  const { fx, fy } = focal(cam);
  const th = rad(cam.pitch);
  const ps = rad(cam.yaw);
  const pts = [];
  const border = [];
  const n = 10;
  for (let i = 0; i <= n; i++) border.push([(IMG_W * i) / n, IMG_H]); // bottom, left to right
  for (let i = n; i >= 0; i--) border.push([IMG_W, (IMG_H * i) / n]); // right, bottom to top
  for (let i = n; i >= 0; i--) border.push([(IMG_W * i) / n, 0]); // top, right to left
  for (let i = 0; i <= n; i++) border.push([0, (IMG_H * i) / n]); // left, top to bottom
  for (const [px, py] of border) {
    let r = pixelToRobot(cam, px, py, diameter);
    const a = (IMG_W / 2 - px) / fx;
    const b = (py - IMG_H / 2) / fy;
    const cx = Math.cos(th) - b * Math.sin(th);
    const dir = { x: cx * Math.cos(ps) - a * Math.sin(ps), y: cx * Math.sin(ps) + a * Math.cos(ps) };
    const len = Math.hypot(dir.x, dir.y) || 1;
    const flat = r ? Math.hypot(r.x - cam.x, r.y - cam.y) : Infinity;
    const limit = Math.sqrt(Math.max(0, far * far - (cam.height - ballZ) ** 2));
    if (!r || flat > limit) r = { x: cam.x + (dir.x / len) * limit, y: cam.y + (dir.y / len) * limit };
    pts.push(toFieldFrame(pose, r));
  }
  return pts;
}

/**
 * Headings to look along when scanning: the current one, then out to one side in steps of 80% of
 * the field of view as far as halfRangeDeg, then the same on the other side. It looks while it
 * turns, so one sweep covers everything; `firstDir` (+1 left, -1 right) picks the side to try
 * first (toward the search area). (HuskyCamera.scanHeadings in Java.)
 */
export function scanHeadings(start, halfRangeDeg, hfovDeg, firstDir = 1) {
  const out = [start];
  const half = Math.min(180, Math.max(0, halfRangeDeg));
  const step = Math.max(5, 0.8 * hfovDeg);
  const dir = firstDir < 0 ? -1 : 1;
  for (const side of [dir, -dir]) {
    for (let k = 1; k * step < half - 1; k++) out.push(start + side * rad(k * step));
    if (half > 1e-9) out.push(start + side * rad(half));
  }
  return out;
}

/** Which way to scan first: toward the middle of the search area (+1 = left), left if it is dead ahead. */
export function scanDirection(pose, area) {
  if (!area || area.length < 3) return 1;
  const cx = area.reduce((a, p) => a + p.x, 0) / area.length;
  const cy = area.reduce((a, p) => a + p.y, 0) / area.length;
  const off = Math.atan2(cy - pose.y, cx - pose.x) - pose.h;
  return Math.sin(off) < 0 ? -1 : 1;
}
