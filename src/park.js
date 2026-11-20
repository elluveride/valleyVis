// The route AutoBase drives after the routine: AutoPaths.routeToPark.
//
// Until you change something it is simulated exactly as the team code has it (commit 3ce19d4):
// straight along y to the corridor at 75% speed, down the corridor holding the heading, then in
// to park(f). Once edited, it is simulated the way the exported replacement drives it (the same
// route from your numbers, with legs too short to follow skipped).

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
    middleX: number(p.middleX, scope, 72 + settings.robot.width / 2, 'middle corridor x', errors),
    middleEndX: p.middleEndX,
    outerX: p.outerX,
    firstLegSpeed: p.firstLegSpeed > 0 ? p.firstLegSpeed : null,
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
 * Returns { pairs: [[fromPose, toPose], ...], speeds: [cap or null per leg], corridor, corners, threshold, jump }.
 */
export function planPark(from, alliance, settings) {
  const P = parkParams(settings);
  const frame = makeFrame(settings, alliance);
  const f = (x, y, hDeg) => frame.pose(x, y, hDeg);
  // AutoPaths.normalized(): the robot's pose expressed in the blue frame
  const blue = alliance === 'red' ? frame.pose(from.x, from.y, (from.h * 180) / Math.PI) : { ...from };
  const park = f(P.pose.x, P.pose.y, P.pose.h);
  const corners = {
    middle: frame.point(P.middleEndX, P.approachY),
    outer: frame.point(P.outerX, P.approachY),
  };
  const threshold = [frame.point(P.middleMaxX, 0), frame.point(P.middleMaxX, 144)];
  // inMiddle(): blue x below 96 (red: field x above 48), so red mirrors blue
  const corridor = blue.x < P.middleMaxX ? 'middle' : 'outer';
  const cx = corridor === 'middle' ? P.middleX : P.outerX;
  const ex = corridor === 'middle' ? P.middleEndX : P.outerX;
  // correctX keeps the robot's y (f.of(...).withY(from.y())); correctY is on the approach line
  const stops = [f(cx, blue.y, P.corridorH), f(ex, P.approachY, P.approachH), park];
  const caps = [P.firstLegSpeed, null, null];

  if (!P.edited) {
    // AutoPaths.routeToPark exactly as it is: three legs, always
    return { pairs: [[{ ...from }, stops[0]], [stops[0], stops[1]], [stops[1], park]], speeds: caps, corridor, corners, threshold, jump: 0, params: P };
  }

  const pairs = [];
  const speeds = [];
  let last = { ...from };
  stops.forEach((stop, i) => {
    if (dist(last, stop) < MIN_LEG) return;
    pairs.push([last, stop]);
    speeds.push(caps[i]);
    last = stop;
  });
  // already parked: Pedro still needs a path, so the export nudges a hair onto the park pose
  if (!pairs.length) {
    pairs.push([{ ...from }, { ...park, x: park.x + 0.01 }]);
    speeds.push(null);
  }
  return { pairs, speeds, corridor, corners, threshold, jump: 0, params: P };
}

/** Java to paste into AutoPaths.java in place of park(f) and routeToPark(f, from, alliance). */
export function parkJava(settings) {
  const P = settings.park;
  const java = symbolTable(settings).java;
  const n = (v) => fmtNum(Number(v));
  const pose = `f.of(${javaValue(P.pose.x, java)}, ${javaValue(P.pose.y, java)}, ${javaValue(P.pose.h, java)})`;
  const cap = P.firstLegSpeed > 0 ? n(P.firstLegSpeed) : null;
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
    `        boolean middle = blue.x() < ${n(P.middleMaxX)};`,
    `        double corridorX = middle ? ${javaValue(P.middleX, java)} : ${n(P.outerX)};`,
    `        double corridorEndX = middle ? ${n(P.middleEndX)} : ${n(P.outerX)};`,
    '        Pose[] stops = {',
    `                f.of(corridorX, blue.y(), ${n(P.corridorH)}),`,
    `                f.of(corridorEndX, ${n(P.approachY)}, ${n(P.approachH)}),`,
    '                park(f),',
    '        };',
    '        Path[] legs = new Path[stops.length];',
    '        int count = 0;',
    '        Pose last = here;',
    '        for (int i = 0; i < stops.length; i++) {',
    `            if (last.distance(stops[i]) < ${n(MIN_LEG)}) continue;`,
    ...(cap
      ? [
        '            Path leg = lineLinearHeading(last, stops[i]);',
        `            // the drive to the corridor runs at ${Math.round(Number(P.firstLegSpeed) * 100)}% speed`,
        `            legs[count++] = i == 0 ? leg.with(PedroConstants.foresightConfig.maxPathSpeed.at(${cap})) : leg;`,
      ]
      : ['            legs[count++] = lineLinearHeading(last, stops[i]);']),
    '            last = stops[i];',
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
