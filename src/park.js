// The route AutoBase drives after the routine: AutoPaths.routeToPark.
//
// Until you change something it is simulated exactly as the team code has it, red-alliance
// bug included. Once edited, it is simulated the way the exported replacement drives it
// (decided in the blue frame, first leg from where the robot really is, tiny legs skipped).

import { evalValue, fmtNum, javaValue } from './expr.js';
import { makeFrame, symbolTable } from './resolve.js';

/** Legs shorter than this are skipped; Pedro cannot follow a zero-length line. */
export const MIN_LEG = 0.5;

function number(v, scope, fallback, label, errors) {
  try {
    return evalValue(v, scope);
  } catch (e) {
    errors.push(`Park ${label}: ${e.message}`);
    return fallback;
  }
}

/** Park settings with every value worked out to a number (blue frame, degrees). */
export function parkParams(settings) {
  const p = settings.park;
  const scope = symbolTable(settings).values;
  const errors = [];
  return {
    edited: !!p.edited,
    middleMaxX: p.middleMaxX,
    middleX: p.middleX,
    outerX: p.outerX,
    approachY: p.approachY,
    corridorH: p.corridorH,
    approachH: p.approachH,
    pose: {
      x: number(p.pose.x, scope, 144 - settings.robot.length / 2, 'x', errors),
      y: number(p.pose.y, scope, 24, 'y', errors),
      h: number(p.pose.h, scope, 180, 'heading', errors),
    },
    errors,
  };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The legs of the park route from the robot's pose `from` (field frame, radians).
 * Returns { pairs: [[fromPose, toPose], ...], corridor, corners, threshold, jump }.
 */
export function planPark(from, alliance, settings) {
  const P = parkParams(settings);
  const frame = makeFrame(settings, alliance);
  const f = (x, y, hDeg) => frame.pose(x, y, hDeg);
  // AutoPaths.normalized(): the robot's pose expressed in the blue frame
  const blue = alliance === 'red' ? frame.pose(from.x, from.y, (from.h * 180) / Math.PI) : { ...from };
  const park = f(P.pose.x, P.pose.y, P.pose.h);
  const corners = {
    middle: frame.point(P.middleX, P.approachY),
    outer: frame.point(P.outerX, P.approachY),
  };
  const threshold = [frame.point(P.middleMaxX, 0), frame.point(P.middleMaxX, 144)];

  if (!P.edited) {
    // AutoPaths.routeToPark exactly as it is today. On red it starts from the re-mirrored pose
    // and compares the real x against 96, so the first leg begins away from the robot.
    const start = blue;
    const inMiddle = alliance === 'red' ? from.x > P.middleMaxX : from.x < P.middleMaxX;
    const cx = inMiddle ? P.middleX : P.outerX;
    const correctX = f(cx, from.y, P.corridorH);
    const correctY = f(cx, P.approachY, P.approachH);
    const pairs = [[start, correctX], [correctX, correctY], [correctY, park]];
    return { pairs, corridor: inMiddle ? 'middle' : 'outer', corners, threshold, jump: dist(start, from), params: P };
  }

  const corridor = blue.x < P.middleMaxX ? 'middle' : 'outer';
  const cx = corridor === 'middle' ? P.middleX : P.outerX;
  const stops = [f(cx, blue.y, P.corridorH), f(cx, P.approachY, P.approachH), park];
  const pairs = [];
  let last = { ...from };
  for (const stop of stops) {
    if (dist(last, stop) < MIN_LEG) continue;
    pairs.push([last, stop]);
    last = stop;
  }
  // already parked: Pedro still needs a path, so the export nudges a hair onto the park pose
  if (!pairs.length) pairs.push([{ ...from }, { ...park, x: park.x + 0.01 }]);
  return { pairs, corridor, corners, threshold, jump: 0, params: P };
}

/** Java to paste into AutoPaths.java in place of park(f) and routeToPark(f, from, alliance). */
export function parkJava(settings) {
  const P = settings.park;
  const java = symbolTable(settings).java;
  const n = (v) => fmtNum(Number(v));
  const pose = `f.of(${javaValue(P.pose.x, java)}, ${javaValue(P.pose.y, java)}, ${javaValue(P.pose.h, java)})`;
  return [
    '// ----- ValleyVis: park route -----',
    '// Paste into AutoPaths.java in place of park(PoseFactory) and',
    '// routeToPark(PoseFactory, Supplier<Pose>, int). AutoBase already calls this one,',
    '// so nothing else changes. No new imports are needed.',
    '',
    '    public static Pose park(PoseFactory f) {',
    `        return ${pose};`,
    '    }',
    '',
    '    /**',
    '     * Drives from wherever the routine ended to park(f): straight along y to a corridor,',
    `     * along the corridor to y = ${n(P.approachY)}, then in. The corridor is picked in the blue frame,`,
    '     * so red is an exact mirror of blue. Legs shorter than half an inch are skipped because',
    '     * Pedro cannot follow a zero-length line.',
    '     */',
    '    public static Path routeToPark(PoseFactory f, Supplier<Pose> from, int alliance) {',
    '        Pose here = from.get();',
    '        Pose blue = normalized(here, alliance);',
    `        double corridorX = blue.x() < ${n(P.middleMaxX)} ? ${n(P.middleX)} : ${n(P.outerX)};`,
    '        Pose[] stops = {',
    `                f.of(corridorX, blue.y(), ${n(P.corridorH)}),`,
    `                f.of(corridorX, ${n(P.approachY)}, ${n(P.approachH)}),`,
    '                park(f),',
    '        };',
    '        Path[] legs = new Path[stops.length];',
    '        int count = 0;',
    '        Pose last = here;',
    '        for (Pose stop : stops) {',
    `            if (last.distance(stop) < ${n(MIN_LEG)}) continue;`,
    '            legs[count++] = lineLinearHeading(last, stop);',
    '            last = stop;',
    '        }',
    '        if (count == 0) {',
    '            // already parked: Pedro still needs a path, so nudge a hair onto the park pose',
    '            Pose target = park(f);',
    '            legs[count++] = lineLinearHeading(here, target.withX(target.x() + 0.01));',
    '        }',
    '        return Paths.path(java.util.Arrays.copyOf(legs, count));',
    '    }',
    '',
  ].join('\n');
}
