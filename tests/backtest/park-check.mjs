// Checks the exported park route against the real Pedro Pathing 3.0.1.
//   node park-check.mjs gen <outDir>        writes Java (park variants + a runner)
//   node park-check.mjs compare <outDir>    compares the runner's output with the visualizer
import fs from 'node:fs';
import path from 'node:path';
import { cloneDeep, DEFAULT_SETTINGS } from '../../src/defaults.js';
import { MIN_LEG, parkJava, planPark } from '../../src/park.js';

const [mode, out] = process.argv.slice(2);
let seed = 2844;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

function variants() {
  const list = [];
  const base = cloneDeep(DEFAULT_SETTINGS);
  base.park.edited = true;
  list.push(base);
  for (let i = 0; i < 5; i++) {
    const s = cloneDeep(base);
    s.park.middleMaxX = 40 + Math.round(rnd() * 70);
    s.park.middleX = 20 + Math.round(rnd() * 100);
    s.park.outerX = 20 + Math.round(rnd() * 100);
    s.park.approachY = 10 + Math.round(rnd() * 120);
    s.park.corridorH = Math.round(rnd() * 360 - 180);
    s.park.approachH = Math.round(rnd() * 360 - 180);
    s.park.pose = i === 0 ? { x: s.park.outerX, y: s.park.approachY, h: 90 } : { x: Math.round(10 + rnd() * 124), y: Math.round(10 + rnd() * 124), h: Math.round(rnd() * 360 - 180) };
    list.push(s);
  }
  return list;
}

function cases(settings) {
  const P = settings.park;
  const out = [];
  for (let i = 0; i < 60; i++) out.push([10 + rnd() * 124, 10 + rnd() * 124, rnd() * 360 - 180]);
  // awkward ones: on a corridor, on the approach line, at or near the park pose
  out.push([P.middleX, 100, 0], [P.outerX, 30, 45], [70, P.approachY, 10], [Number(P.pose.x) || 136.0625, P.pose.y, 0], [(Number(P.pose.x) || 136.0625) + 0.2, P.pose.y - 0.2, 0]);
  // on a corner that is also the park pose: nothing left to drive, so the export nudges
  if (P.pose.x === P.outerX && P.pose.y === P.approachY) out.push([P.outerX + 0.1, P.approachY, 0]);
  return out;
}

const red = (x, y, hDeg) => [144 - x, 144 - y, hDeg + 180];

if (mode === 'gen') {
  const dir = path.join(out, 'parkcheck');
  fs.mkdirSync(dir, { recursive: true });
  const all = [];
  variants().forEach((settings, k) => {
    const body = parkJava(settings).split('\n').filter((l) => !l.startsWith('//')).join('\n');
    fs.writeFileSync(path.join(dir, `Park${k}.java`), `package parkcheck;
import com.pedropathing.api.Paths;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import java.util.function.Supplier;
import org.firstinspires.ftc.team2844simple.helpers.Constants;
/** park code exactly as exported, inside the AutoPaths helpers it relies on */
public final class Park${k} {
    public static final PoseFactory RED = PoseFactory.degrees().mirrorX(72.0).mirrorY(72.0);
    public static Pose normalized(Pose p, int alliance) {
        return (alliance == Constants.BLUE_ALLIANCE) ? p : RED.of(p.x(), p.y(), Math.toDegrees(p.heading()));
    }
    public static Path lineLinearHeading(Pose start, Pose end) { return Paths.line(start, end).linear(start, end); }
${body}
}
`);
    for (const [x, y, h] of cases(settings)) {
      all.push([k, 0, x, y, h]);
      all.push([k, 2, ...red(x, y, h)]); // the same spot on red
    }
  });
  const calls = variants().map((_, k) => `      case ${k}: path = Park${k}.routeToPark(f, () -> here, alliance); break;`).join('\n');
  fs.writeFileSync(path.join(dir, 'Run.java'), `package parkcheck;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import com.pedropathing.paths.PathSegment;
public class Run {
  static final double[][] CASES = {${all.map((c) => `{${c.join(',')}}`).join(',')}};
  public static void main(String[] a) {
    for (double[] c : CASES) {
      int k = (int) c[0];
      int alliance = (int) c[1];
      PoseFactory f = alliance == 0 ? PoseFactory.degrees() : PoseFactory.degrees().mirrorX(72.0).mirrorY(72.0);
      Pose here = new Pose(c[2], c[3], Math.toRadians(c[4]));
      StringBuilder sb = new StringBuilder();
      try {
        Path path = null;
        switch (k) {
${calls}
        }
        for (PathSegment s : path.getSegments()) {
          sb.append(String.format(java.util.Locale.US, "%.6f,%.6f,%.6f,%.6f,%.6f;", s.curve.get(0).x(), s.curve.get(0).y(), s.curve.get(1).x(), s.curve.get(1).y(), s.heading(1.0)));
        }
        path.endPose();
      } catch (Exception e) {
        sb.setLength(0);
        sb.append("THROWS ").append(e.getClass().getSimpleName()).append(": ").append(e.getMessage());
      }
      System.out.println(sb);
    }
  }
}
`);
  fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(all));
  console.log(`wrote ${variants().length} park variants, ${all.length} cases`);
} else {
  const dir = path.join(out, 'parkcheck');
  const all = JSON.parse(fs.readFileSync(path.join(dir, 'cases.json'), 'utf8'));
  const lines = fs.readFileSync(path.join(out, 'park.txt'), 'utf8').trim().split('\n');
  const settingsList = variants();
  const ang = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  let ok = 0;
  const bad = [];
  all.forEach(([k, al, x, y, h], i) => {
    const line = lines[i];
    if (line.startsWith('THROWS')) { bad.push(`case ${i}: Pedro ${line}`); return; }
    const java = line.split(';').filter(Boolean).map((seg) => seg.split(',').map(Number));
    const plan = planPark({ x, y, h: (h * Math.PI) / 180 }, al === 0 ? 'blue' : 'red', settingsList[k]);
    const same = plan.pairs.length === java.length && plan.pairs.every(([a, b], j) => {
      const [ax, ay, bx, by, bh] = java[j];
      return Math.hypot(a.x - ax, a.y - ay) < 1e-4 && Math.hypot(b.x - bx, b.y - by) < 1e-4 && ang(b.h, bh) < 1e-4;
    });
    const legsOk = java.every(([ax, ay, bx, by]) => Math.hypot(bx - ax, by - ay) > 0);
    if (same && legsOk) ok += 1;
    else bad.push(`case ${i} (variant ${k}, ${al === 0 ? 'blue' : 'red'}): visualizer ${plan.pairs.length} legs, Pedro ${java.length}`);
  });
  console.log(`park route: ${ok} of ${all.length} cases match real Pedro (legs, end points, headings); min leg ${MIN_LEG} in`);
  for (const b of bad.slice(0, 8)) console.log('  ', b);
  process.exit(bad.length ? 1 : 0);
}
