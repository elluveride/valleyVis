import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BALLS, canSee, maxRange, pixelToRobot, robotToPixel, scanDirection, scanHeadings, toFieldFrame, toRobotFrame, viewFootprint } from '../src/camera.js';
import { checkCollisions } from '../src/collision.js';
import { generateJava } from '../src/codegen.js';
import { cloneDeep, DEFAULT_SETTINGS } from '../src/defaults.js';
import { lintProject } from '../src/lint.js';
import { pointArray } from '../src/points.js';
import { resolveProject } from '../src/resolve.js';
import { normalizeProject, normalizeSettings } from '../src/schema.js';
import { simulate } from '../src/simulate.js';
import { approachPose, planPickup } from '../src/vision.js';
import { visionSetup } from '../src/visionJava.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);
const deg = (d) => (d * Math.PI) / 180;
const cam = () => cloneDeep(DEFAULT_SETTINGS.camera);
const area = (cx, cy, half = 15) => [{ x: cx - half, y: cy - half }, { x: cx + half, y: cy - half }, { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half }];

function project(steps, start = { x: 30, y: 30, h: 0 }) {
  return normalizeProject({ name: 'vision test', className: 'VisionTestRoutine', start, steps, zones: [] });
}
const pickup = (over = {}) => ({ id: 'v1', type: 'vision', name: 'pickup1', target: 'pollen', area: area(60, 30), spots: [{ x: 60, y: 30 }], spot: 0, reach: 'L/2', maxSpeed: null, timeout: 4, scan: 60, during: [], ...over });

test('camera: a pixel and the field point it sees map back to each other', () => {
  const c = { ...cam(), x: 6, y: -1.5, height: 10, yaw: 8, pitch: 28, hfov: 62, vfov: 48 };
  for (const [px, py] of [[160, 120], [10, 230], [300, 140], [200, 200]]) {
    const r = pixelToRobot(c, px, py, BALLS.nectar.diameter);
    const back = robotToPixel(c, r.x, r.y, BALLS.nectar.diameter);
    near(back.px, px, 1e-6);
    near(back.py, py, 1e-6);
  }
  const pose = { x: 40, y: 90, h: deg(135) };
  const f = toFieldFrame(pose, { x: 12, y: -5 });
  const r = toRobotFrame(pose, f);
  near(r.x, 12);
  near(r.y, -5);
});

test('camera: the image centre looks down the tilt, and nothing above the horizon is on the floor', () => {
  const c = { ...cam(), x: 0, y: 0, height: 10, yaw: 0, pitch: 30 };
  const r = pixelToRobot(c, 160, 120, 0);
  near(r.x, 10 / Math.tan(deg(30)), 1e-9);
  near(r.y, 0, 1e-9);
  assert.ok(pixelToRobot(c, 160, 0, 2.8)); // 30° tilt, 22.5° half-view: the top edge still meets the floor
  assert.equal(pixelToRobot({ ...c, pitch: 15 }, 160, 0, 2.8), null); // 15° tilt: the top edge is above the horizon
  assert.equal(pixelToRobot({ ...c, height: 1 }, 160, 200, 2.8), null); // lens below the ball's middle
});

test('camera: canSee rounds the blob like the HuskyLens and respects the size cutoff', () => {
  const c = { ...cam(), x: 0, y: 0, yaw: 0, height: 9, pitch: 20, minArea: 100 };
  const far = maxRange(c, BALLS.pollen.diameter);
  const pose = { x: 0, y: 72, h: 0 };
  assert.ok(canSee(c, pose, { x: far * 0.8, y: 72 }, BALLS.pollen.diameter));
  assert.ok(!canSee(c, pose, { x: far * 1.25, y: 72 }, BALLS.pollen.diameter));
  assert.ok(!canSee(c, pose, { x: -20, y: 72 }, BALLS.pollen.diameter)); // behind
  assert.ok(viewFootprint(c, pose, BALLS.pollen.diameter).length > 10);
});

test('scan: one sweep toward the search area first, then the other side, each edge included', () => {
  const h = scanHeadings(0, 90, 50, -1).map((x) => Math.round((x * 180) / Math.PI));
  assert.deepEqual(h, [0, -40, -80, -90, 40, 80, 90]);
  assert.deepEqual(scanHeadings(0.3, 0, 60), [0.3]);
  assert.equal(scanDirection({ x: 0, y: 0, h: 0 }, area(30, 30)), 1);
  assert.equal(scanDirection({ x: 0, y: 0, h: 0 }, area(30, -30)), -1);
  assert.equal(scanDirection({ x: 0, y: 0, h: 0 }, []), 1);
});

test('pickup: a ball in view is driven to nose-first and the robot stops reach short of it', () => {
  const plan = planPickup({ start: { x: 30, y: 30, h: 0 }, spot: { x: 60, y: 30 }, area: area(60, 30), target: 'pollen', reach: 8, scanDeg: 60 }, cam());
  assert.equal(plan.found, true);
  assert.deepEqual(plan.phases.map((p) => p.kind), ['look', 'approach']);
  near(plan.end.x, 52);
  near(plan.end.y, 30);
  near(plan.end.h, 0);
  assert.equal(approachPose({ x: 0, y: 0, h: 0 }, { x: 8.2, y: 0 }, 8), null); // already there
});

test('pickup: a ball off to the side is found by turning toward the search area', () => {
  const plan = planPickup({ start: { x: 30, y: 30, h: 0 }, spot: { x: 30, y: 60 }, area: area(30, 60), target: 'pollen', reach: 8, scanDeg: 120 }, cam());
  assert.equal(plan.found, true);
  const turns = plan.phases.filter((p) => p.kind === 'turn');
  assert.ok(turns.length >= 1 && turns.every((t) => t.delta > 0), JSON.stringify(turns.map((t) => t.delta)));
  near(plan.end.x, 30, 1e-6);
  near(plan.end.y, 52, 1e-6);
});

test('pickup: nothing found after the scan, or a ball outside the area, leaves the robot where it started', () => {
  const behind = planPickup({ start: { x: 72, y: 72, h: 0 }, spot: { x: 40, y: 72 }, area: area(40, 72), target: 'pollen', reach: 8, scanDeg: 30 }, cam());
  assert.equal(behind.found, false);
  near(behind.end.x, 72);
  const outside = planPickup({ start: { x: 30, y: 30, h: 0 }, spot: { x: 60, y: 30 }, area: area(100, 100), target: 'pollen', reach: 8, scanDeg: 60 }, cam());
  assert.equal(outside.found, false);
  assert.equal(outside.inArea, false);
});

test('simulate: the pickup takes time, can be cut by its timeout, and the next step starts where it ends', () => {
  const p = project([pickup(), { id: 'w', type: 'wait', seconds: 1 }]);
  const r = resolveProject(p, DEFAULT_SETTINGS, 'blue');
  const sim = simulate(r, DEFAULT_SETTINGS);
  const [v, w] = sim.items;
  assert.equal(v.motion.kind, 'seq');
  assert.ok(v.t1 > v.t0 && v.t1 <= v.t0 + 4 + 1e-9);
  near(w.t0, v.t1);
  near(v.worstT1, v.t0 + 4);
  const end = sim.poseAt(v.t1);
  near(end.x, r.steps[0].end.x, 1e-6);
  assert.ok(sim.worstTotal > sim.routineTotal);
  const cut = simulate(resolveProject(project([pickup({ timeout: 0.2 })]), DEFAULT_SETTINGS, 'blue'), DEFAULT_SETTINGS);
  assert.equal(cut.items[0].cut, true);
  near(cut.items[0].t1 - cut.items[0].t0, 0.2);
});

test('problems: unchecked camera, a spot outside the area, and a search area next to a keep-out zone', () => {
  const p = project([pickup({ spots: [{ x: 60, y: 30 }, { x: 130, y: 130 }] })]);
  p.zones = [{ id: 'z', name: 'Wall thing', enabled: true, shape: 'rect', x: 70, y: 20, w: 10, h: 20, clearance: 2, mirror: true }];
  const norm = normalizeProject(p);
  const r = resolveProject(norm, DEFAULT_SETTINGS, 'blue');
  const sim = simulate(r, DEFAULT_SETTINGS);
  const msgs = [...r.issues, ...sim.issues, ...checkCollisions(sim, r, DEFAULT_SETTINGS).issues].map((i) => i.msg).join('\n');
  assert.match(msgs, /have not been checked yet/);
  assert.match(msgs, /Practice spot 2 is outside the search area/);
  assert.match(msgs, /search area overlaps "Wall thing"/);
  const s = normalizeSettings({ ...cloneDeep(DEFAULT_SETTINGS), camera: { ...DEFAULT_SETTINGS.camera, height: 1 } });
  const low = resolveProject(project([pickup()]), s, 'blue');
  assert.ok(low.issues.some((i) => i.level === 'error' && /can never see one/.test(i.msg)));
});

test('lint: a command run during a pickup must not need the drive', () => {
  const p = project([pickup({ during: [{ lib: 'intakeTransfer', params: {} }] })]);
  const r = resolveProject(p, DEFAULT_SETTINGS, 'blue');
  assert.ok(!lintProject(p, r).some((i) => /fight over/.test(i.msg)));
  const settings = cloneDeep(DEFAULT_SETTINGS);
  settings.commands.push({ id: 'drv', name: 'Drive thing', type: 'command', java: 'x', requires: ['drive'], params: [], duration: 1, color: '#fff', imports: '' });
  const p2 = project([pickup({ during: [{ lib: 'drv', params: {} }] })]);
  const r2 = resolveProject(p2, settings, 'blue');
  assert.ok(lintProject(p2, r2).some((i) => /fight over a subsystem/.test(i.msg)));
});

test('schema: a bare pickup step gets safe defaults', () => {
  const p = normalizeProject({ steps: [{ type: 'vision' }] });
  const v = p.steps[0];
  assert.equal(v.type, 'vision');
  assert.equal(v.target, 'pollen');
  assert.ok(v.area.length >= 3 && v.spots.length >= 1);
  assert.equal(v.timeout, 4);
});

test('export: the pickup line, its search area, and a path that starts wherever the robot ended up', () => {
  const p = project([
    pickup({ target: 'nectar', maxSpeed: 0.6, during: [{ lib: 'intakeTransfer', params: {} }] }),
    { id: 't', type: 'turn', h: 90 },
    { id: 'p', type: 'path', name: 'back', endName: 'home', segments: [{ type: 'line', controls: [], end: { x: 20, y: 20 } }], endH: 0, heading: { mode: 'linear' }, during: [], markers: [] },
    { id: 'q', type: 'path', name: 'out', endName: 'outPose', segments: [{ type: 'line', controls: [], end: { x: 60, y: 20 } }], endH: 0, heading: { mode: 'linear' }, during: [], markers: [] },
  ]);
  const j = generateJava(p, DEFAULT_SETTINGS, resolveProject(p, DEFAULT_SETTINGS, 'blue'));
  assert.equal(j.usesVision, true);
  assert.match(j.routineClass, /new VisionPickupCmd\(subsystems\.drive, subsystems\.husky, HuskyCamera\.Ball\.NECTAR, alliance\(\),\s+pickup1Area, Constants\.ROBOT_LENGTH \/ 2\.0, 0\.6, 60\.0\)\s+\.withTimeout\(4\.0\)\s+\.deadlineWith\(/);
  assert.match(j.routineClass, /Pose\[\] pickup1Area = \{\s+f\.of\(45\.0, 15\.0, 0\.0\),/);
  // the turn keeps "unknown position", so the next path is built when it starts
  assert.match(j.routineClass, /Supplier<Path> back = \(\) -> \{\s+Pose here = subsystems\.drive\.getPose\(\);\s+return Paths\.line\(here, home\)/);
  assert.match(j.routineClass, /b\.command\(new GoToCmd\(subsystems\.drive, back\)\);/);
  assert.match(j.routineClass, /b\.follow\(out\);/);
  assert.match(j.routineClass, /import org\.firstinspires\.ftc\.team2844simple\.vision\.VisionPickupCmd;/);
  assert.match(j.routineClass, /import org\.firstinspires\.ftc\.team2844simple\.commands\.drive\.GoToCmd;/);
  assert.match(j.geometryClass, /public static Path back\(PoseFactory f, Pose here\)/);
  assert.match(j.geometryClass, /public static Pose\[\] pickup1Area\(PoseFactory f\)/);
  assert.match(j.teamRoutineClass, /new GoToCmd\(subsystems\.drive, \(\) -> VisionTestGeometry\.back\(f, subsystems\.drive\.getPose\(\)\)\)/);
  assert.ok(j.warnings.some((w) => /Vision setup/.test(w)));
});

test('export: a ball-in check is passed to the pickup when one is set', () => {
  const settings = cloneDeep(DEFAULT_SETTINGS);
  settings.camera.ballInJava = 'subsystems.intake.hasBall()';
  const p = project([pickup()]);
  const j = generateJava(p, settings, resolveProject(p, settings, 'blue'));
  assert.match(j.routineClass, /PedroSubsystem\.NO_SPEED_LIMIT, 60\.0, \(\) -> \(subsystems\.intake\.hasBall\(\)\)\)/);
  assert.match(j.routineClass, /import com\.vcs\.valleylib\.ftc\.pedro\.PedroSubsystem;/);
});

test('vision setup: every file uses the settings, and the Constants lines carry the camera numbers', () => {
  const settings = cloneDeep(DEFAULT_SETTINGS);
  settings.camera.pitch = 31.5;
  settings.code.visionPackage = 'org.example.vision';
  const files = visionSetup(settings);
  assert.match(files.constants, /public static double HUSKY_PITCH_DEG = 31\.5;/);
  assert.match(files.constants, /public static String HUSKY_NAME = "huskylens";/);
  for (const k of ['camera', 'subsystem', 'command', 'check']) assert.match(files[k], /^package org\.example\.vision;/);
  assert.match(files.subsystem, /hardwareMap\.get\(HuskyLens\.class, Constants\.HUSKY_NAME\)/);
  assert.match(files.subsystem, /HuskyLens\.Algorithm\.COLOR_RECOGNITION/);
  assert.match(files.command, /HuskyCamera\.scanHeadings\(origin\.heading\(\), scanDeg, HuskyCamera\.scanDirection\(origin, area\)\)/);
  assert.match(files.subsystems, /import org\.example\.vision\.HuskyLensSubsystem;/);
});

test('point array: pickups list their practice spots and where the preview stops', () => {
  const p = project([pickup()]);
  const { rows } = pointArray(p, DEFAULT_SETTINGS);
  assert.ok(rows.some((r) => /pickup1 practice spot 1/.test(r.label) && r.h === null));
  assert.ok(rows.some((r) => /pickup1 \(stops here in the preview/.test(r.label)));
  const sampled = pointArray(p, DEFAULT_SETTINGS, { content: 'sampled', spacing: 3 }).rows;
  assert.ok(sampled.filter((r) => /pickup1 \(preview\)/.test(r.label)).length > 3);
});
