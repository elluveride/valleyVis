import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateJava, javaIdent } from '../src/codegen.js';
import { DEFAULT_SETTINGS, emptyProject } from '../src/defaults.js';
import { PRESETS } from '../src/presets.js';
import { resolveProject } from '../src/resolve.js';

function gen(project) {
  return generateJava(project, DEFAULT_SETTINGS, resolveProject(project, DEFAULT_SETTINGS, 'blue'));
}

function balanced(src) {
  const pairs = { ')': '(', '}': '{', ']': '[' };
  const stack = [];
  for (const ch of src.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/\/\/.*$/gm, '')) {
    if ('({['.includes(ch)) stack.push(ch);
    else if (pairs[ch]) {
      if (stack.pop() !== pairs[ch]) return false;
    }
  }
  return stack.length === 0;
}

test('java identifiers are sanitised', () => {
  assert.equal(javaIdent('to garden'), 'toGarden');
  assert.equal(javaIdent('2nd pass'), '_2ndPass');
  assert.equal(javaIdent('class'), 'class_');
  assert.equal(javaIdent(''), 'value');
});

test('Up preset exports the same shape as UpRoutine/UpGeometry', () => {
  const out = gen(PRESETS.find((p) => p.id === 'up').make());
  assert.match(out.methods, /return field\(\)\.of\(72\.0 \+ Constants\.ROBOT_LENGTH \/ 2\.0, 144\.0 - Constants\.ROBOT_WIDTH \/ 2\.0, -90\.0\);/);
  // UpGeometry at team commit 3ce19d4: middleGarden and laterGarden are the control points
  assert.match(out.methods, /Path toGarden = Paths\.curve\(start, f\.of\(90\.0, 110\.0, 0\.0\), f\.of\(120\.0, 144\.0 - Constants\.ROBOT_WIDTH \/ 2\.0, 0\.0\), intakeFromGarden\)/);
  assert.match(out.methods, /Pose intakeFromGarden = f\.of\(140\.0 - Constants\.ROBOT_LENGTH \/ 2\.0, 144\.0 - Constants\.ROBOT_WIDTH \/ 2\.0, 0\.0\);/);
  assert.match(out.methods, /Pose readyToShoot = f\.of\(90\.0, 126\.0, -90\.0\);/);
  assert.match(out.methods, /\.until\(0\.2, Interpolator\.constant\(start\)\)/);
  assert.match(out.methods, /b\.command\(subsystems\.drive\.follow\(toGarden\)\s+\.withTimeout\(6\.0\)\s+\.deadlineWith\(\s+CommandFactory\.intakeAndTransfer\(subsystems\.intake, subsystems\.transfer\)\)\);/);
  assert.match(out.methods, /b\.follow\(readyShoot1\);/);
  assert.match(out.methods, /b\.doInstant\(\(\) -> \{\n\s+subsystems\.pollen\.shoot\(\);\n\s+\}\);/);
  assert.match(out.methods, /new ShootCmd\(subsystems\.intake, subsystems\.pollen, subsystems\.transfer, 4000\)/);
  assert.ok(balanced(out.routineClass), 'routine class brackets balance');
  assert.match(out.routineClass, /^package org\.firstinspires\.ftc\.team2844simple\.autos\.routines;/);
  assert.match(out.routineClass, /import org\.firstinspires\.ftc\.team2844simple\.autos\.AutoBase;/);
  assert.match(out.blueOpMode, /return Constants\.BLUE_ALLIANCE;/);
  assert.match(out.redOpMode, /return Constants\.AUDIENCE_SIDE;/);
});

test('markers, turns, timeouts, parallel actions and raw java all export', () => {
  const p = emptyProject();
  p.steps = [
    {
      id: 'a', type: 'path', name: 'sweep', endName: 'sweepEnd',
      segments: [
        { type: 'line', controls: [], end: { x: 100, y: 120 } },
        { type: 'curve', controls: [{ x: 110, y: 100 }], end: { x: 120, y: 80 } },
      ],
      endH: 45, heading: { mode: 'facing', x: 84, y: 78 },
      maxSpeed: 0.6, timeout: 3, during: [{ lib: 'intakeTransfer', params: {} }],
      markers: [{ id: 'm', at: 0.75, cmd: { lib: 'spinUp', params: {} } }],
    },
    { id: 'b', type: 'turn', h: 90 },
    { id: 'c', type: 'action', label: 'shoot + hold', cmds: [{ lib: 'shoot', params: { timeoutMs: 2500 } }, { lib: 'holdPosition', params: {} }], timeout: 3 },
    { id: 'd', type: 'path', name: 'back', endName: 'home', segments: [{ type: 'line', controls: [], end: { x: 96, y: 108 } }], endH: -90, heading: { mode: 'linear', endT: 0.6, long: true }, during: [], markers: [] },
    { id: 'e', type: 'wait', seconds: 0.5 },
    { id: 'f', type: 'java', code: 'b.waitUntilDriveIdle();', duration: 0 },
  ];
  const out = gen(p);
  const m = out.methods;
  assert.match(m, /Paths\.path\(\s+Paths\.line\(start, sweepJoint1\),\s+Paths\.curve\(sweepJoint1, f\.of\(110\.0, 100\.0, 0\.0\), sweepEnd\)\)/);
  assert.match(m, /\.facingPoint\(f\.of\(84\.0, 78\.0, 0\.0\)\)/);
  assert.match(m, /subsystems\.drive\.follow\(sweep, 0\.6\)\s+\.withTimeout\(3\.0\)\s+\.deadlineWith\(/);
  assert.match(m, /Commands\.waitUntil\(\(\) -> reached\(1, \d+(\.\d+)?\)\)/);
  assert.match(m, /private boolean reached\(int segment, double inchesLeft\)/);
  assert.match(m, /follower\.remainingDistance\(\) <= inchesLeft/);
  assert.match(m, /new TurnToCmd\(subsystems\.drive, f\.of\(120\.0, 80\.0, 90\.0\)\.heading\(\)\)/);
  assert.match(m, /Pose backStart = f\.of\(120\.0, 80\.0, 90\.0\);/);
  assert.match(m, /Commands\.parallel\(\s+new ShootCmd\([^)]*2500\),\s+new HoldPosition\(subsystems\.drive\)\)\s+\.withTimeout\(3\.0\)/);
  assert.match(m, /Interpolator\.longLinear\(backStart, home\)/);
  assert.match(m, /b\.waitFor\(0\.5\);/);
  assert.match(m, /b\.waitUntilDriveIdle\(\);/);
  for (const imp of ['com.pedropathing.follower.Follower', 'com.vcs.valleylib.core.command.Commands', 'org.firstinspires.ftc.team2844simple.commands.drive.TurnToCmd', 'org.firstinspires.ftc.team2844simple.commands.drive.HoldPosition']) {
    assert.ok(out.imports.includes(imp), `missing import ${imp}`);
  }
  assert.ok(balanced(out.routineClass));
});

test('duplicate names get unique Java identifiers', () => {
  const p = emptyProject();
  const path = (id, x) => ({ id, type: 'path', name: 'go', endName: 'spot', segments: [{ type: 'line', controls: [], end: { x, y: 72 } }], endH: 0, heading: { mode: 'tangent' }, during: [], markers: [] });
  p.steps = [path('a', 60), path('b', 90)];
  const m = gen(p).methods;
  assert.match(m, /Path go = /);
  assert.match(m, /Path go2 = Paths\.line\(spot, spot2\)/);
});

test('team layout: a Geometry class of static poses and paths, and a routine that follows them', () => {
  const up = gen(PRESETS.find((p) => p.id === 'up').make());
  assert.equal(up.geometryName, 'UpVisGeometry');
  const g = up.geometryClass;
  assert.match(g, /^package org\.firstinspires\.ftc\.team2844simple\.autos\.geometries;/);
  assert.match(g, /public final class UpVisGeometry \{\n    private UpVisGeometry\(\) \{\}/);
  assert.match(g, /public static Pose startingPose\(PoseFactory f\) \{\n        return f\.of\(72\.0 \+ Constants\.ROBOT_LENGTH \/ 2\.0, 144\.0 - Constants\.ROBOT_WIDTH \/ 2\.0, -90\.0\);/);
  assert.match(g, /public static Path toGarden\(PoseFactory f\) \{\n        Pose start = startingPose\(f\);\n        Pose intakeFromGarden = intakeFromGarden\(f\);\n        return Paths\.curve\(start, f\.of\(90\.0, 110\.0, 0\.0\), f\.of\(120\.0, 144\.0 - Constants\.ROBOT_WIDTH \/ 2\.0, 0\.0\), intakeFromGarden\)/);
  assert.doesNotMatch(g, /Command|PedroAutoDsl|ShootCmd/, 'no routine code or imports leak into the geometry file');
  const r = up.teamRoutineClass;
  assert.match(r, /import org\.firstinspires\.ftc\.team2844simple\.autos\.geometries\.UpVisGeometry;/);
  assert.match(r, /return UpVisGeometry\.startingPose\(field\(\)\);/);
  assert.match(r, /subsystems\.drive\.follow\(UpVisGeometry\.toGarden\(f\)\)\s+\.withTimeout\(6\.0\)\s+\.deadlineWith\(/);
  assert.match(r, /b\.follow\(UpVisGeometry\.readyShoot1\(f\)\);/);
  assert.doesNotMatch(r, /Paths\.|Interpolator/, 'no path building in the routine file');
  assert.ok(balanced(g) && balanced(r));
  // helpers land in the file that uses them
  const solo = gen(PRESETS.find((p) => p.id === 'solo').make());
  assert.match(solo.geometryClass, /private static Interpolator jointSafe/);
  assert.doesNotMatch(solo.teamRoutineClass, /jointSafe/);
});

test('team layout: markers keep reached() in the routine, same package needs no import', () => {
  const p = emptyProject();
  p.className = 'Sweep';
  p.steps = [{ id: 'a', type: 'path', name: 'sweep', endName: 'far', segments: [{ type: 'line', controls: [], end: { x: 100, y: 100 } }], endH: 0, heading: { mode: 'tangent' }, during: [], markers: [{ id: 'm', at: 0.5, cmd: { lib: 'spinUp', params: {} } }] }];
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.code.geometryPackage = settings.code.routinePackage;
  const out = generateJava(p, settings, resolveProject(p, settings, 'blue'));
  assert.equal(out.geometryName, 'SweepGeometry');
  assert.match(out.teamRoutineClass, /private boolean reached\(int segment, double inchesLeft\)/);
  assert.doesNotMatch(out.geometryClass, /reached/);
  assert.doesNotMatch(out.teamRoutineClass, /import .*SweepGeometry;/);
});

test('names that would clash with AutoBase or the Geometry methods are renamed', () => {
  const p = emptyProject();
  p.steps = [{ id: 'a', type: 'path', name: 'routine', endName: 'startingPose', segments: [{ type: 'line', controls: [], end: { x: 100, y: 100 } }], endH: 0, heading: { mode: 'tangent' }, during: [], markers: [] }];
  const out = gen(p);
  assert.match(out.geometryClass, /public static Pose startingPose2\(PoseFactory f\)/);
  assert.match(out.geometryClass, /public static Path routine2\(PoseFactory f\)/);
});
