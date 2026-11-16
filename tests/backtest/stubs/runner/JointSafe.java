package runner;
import com.pedropathing.api.Paths;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import com.pedropathing.paths.PathSegment;
import com.pedropathing.paths.interpolator.Interpolator;
import com.pedropathing.paths.interpolator.PiecewiseInterpolator;
import java.util.List;
import java.util.Random;

public class JointSafe {
  static Interpolator jointSafe(Interpolator heading) {
    return (curve, t) -> heading.interpolate(curve, Math.max(0.0, t - 1e-9));
  }
  static String tryFollow(Path p) {
    try {
      List<PathSegment> segs = p.getSegments();
      for (PathSegment s : segs) for (int i = 0; i <= 400; i++) s.heading(i / 400.0);
      p.endPose();
      for (int i = 0; i <= 400; i++) p.heading(i / 400.0);
      return "ok";
    } catch (Exception e) { return e.getClass().getSimpleName(); }
  }
  static Interpolator leaf(Random rnd) {
    switch (rnd.nextInt(6)) {
      case 0: return Interpolator.constant(rnd.nextDouble() * 6);
      case 1: return Interpolator.linear(rnd.nextDouble() * 6, rnd.nextDouble() * 6);
      case 2: return Interpolator.longLinear(rnd.nextDouble() * 6, rnd.nextDouble() * 6);
      case 3: return Interpolator.tangent;
      case 4: return Interpolator.tangent.reverse();
      default: return Interpolator.facingPoint(new Pose(rnd.nextDouble() * 144, rnd.nextDouble() * 144, 0));
    }
  }
  public static void main(String[] a) {
    Random rnd = new Random(11);
    int n = 100000, bad = 0, badSafe = 0; double worst = 0; int compared = 0;
    for (int c = 0; c < n; c++) {
      int nseg = 2 + rnd.nextInt(3);
      Path[] parts = new Path[nseg];
      Pose from = new Pose(5 + rnd.nextDouble() * 134, 5 + rnd.nextDouble() * 134, 0);
      for (int s = 0; s < nseg; s++) {
        Pose end = new Pose(5 + rnd.nextDouble() * 134, 5 + rnd.nextDouble() * 134, 0);
        int k = rnd.nextInt(3);
        if (k == 0) parts[s] = Paths.line(from, end);
        else if (k == 1) parts[s] = Paths.curve(from, new Pose(rnd.nextDouble() * 144, rnd.nextDouble() * 144, 0), end);
        else parts[s] = Paths.curve(from, new Pose(rnd.nextDouble() * 144, rnd.nextDouble() * 144, 0), new Pose(rnd.nextDouble() * 144, rnd.nextDouble() * 144, 0), end);
        from = end;
      }
      int pieces = 2 + rnd.nextInt(3);
      long seed = rnd.nextLong();
      Path[] built = new Path[2];
      for (int v = 0; v < 2; v++) {
        Random r2 = new Random(seed);
        PiecewiseInterpolator pw = Interpolator.piecewise();
        double last = 0;
        for (int i = 0; i < pieces; i++) { last = i == pieces - 1 ? 1.0 : last + (1 - last) * (0.15 + r2.nextDouble() * 0.5); pw.until(i == pieces - 1 ? 1.0 : last, leaf(r2)); }
        built[v] = Paths.path(parts).heading(v == 0 ? pw : jointSafe(pw));
      }
      boolean rawOk = tryFollow(built[0]).equals("ok");
      if (!rawOk) bad++;
      if (!tryFollow(built[1]).equals("ok")) badSafe++;
      if (rawOk) { // where the raw form works, the wrapped form must give the same headings away from joints
        for (int i = 1; i < 40; i++) {
          double t = i / 40.0 + 0.0031;
          double d = Math.abs(Math.atan2(Math.sin(built[0].heading(t) - built[1].heading(t)), Math.cos(built[0].heading(t) - built[1].heading(t))));
          if (d < 0.5) worst = Math.max(worst, d); // ignore samples that straddle a piece boundary
          compared++;
        }
      }
    }
    System.out.println("raw piecewise on multi-segment paths: " + bad + " of " + n + " throw (" + String.format("%.1f", 100.0 * bad / n) + "%)");
    System.out.println("with jointSafe wrapper:               " + badSafe + " of " + n + " throw");
    System.out.println("largest heading difference (rad) over " + compared + " samples: " + worst);
  }
}
