package cmp;
import com.pedropathing.api.Paths;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import com.pedropathing.paths.interpolator.Interpolator;
import com.pedropathing.paths.interpolator.PiecewiseInterpolator;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Random;

/** Random paths + heading interpolators evaluated by the real Pedro Pathing 3.0.1, one JSON object per line. */
public class Fuzz {
  static Random rnd;
  static final double[] SPECIAL = {0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.toRadians(180), Math.toRadians(-90), Math.toRadians(45), 2 * Math.PI, -Math.PI};
  static String f(double v) { return Double.toString(v); }
  static String o(double v) { return String.format(Locale.US, "%.9f", v); }
  static double coord() { return 5 + rnd.nextDouble() * 134; }
  static double angle() { return rnd.nextInt(3) == 0 ? SPECIAL[rnd.nextInt(SPECIAL.length)] : (rnd.nextDouble() * 4 - 2) * Math.PI; }

  static Interpolator leaf(StringBuilder sb, boolean allowGeometric) {
    int k = rnd.nextInt(allowGeometric ? 6 : 3);
    switch (k) {
      case 0: { double h = angle(); sb.append("{\"k\":\"constant\",\"h\":").append(f(h)).append("}"); return Interpolator.constant(h); }
      case 1: { double a = angle(), b = angle(); sb.append("{\"k\":\"linear\",\"a\":").append(f(a)).append(",\"b\":").append(f(b)).append("}"); return Interpolator.linear(a, b); }
      case 2: { double a = angle(), b = rnd.nextInt(4) == 0 ? a + Math.PI : (rnd.nextInt(6) == 0 ? a : angle()); sb.append("{\"k\":\"linear\",\"long\":true,\"a\":").append(f(a)).append(",\"b\":").append(f(b)).append("}"); return Interpolator.longLinear(a, b); }
      case 3: sb.append("{\"k\":\"tangent\"}"); return Interpolator.tangent;
      case 4: sb.append("{\"k\":\"tangent\",\"rev\":true}"); return Interpolator.tangent.reverse();
      default: { double x = coord(), y = coord(); sb.append("{\"k\":\"facing\",\"p\":{\"x\":").append(f(x)).append(",\"y\":").append(f(y)).append("}}"); return Interpolator.facingPoint(new Pose(x, y, 0)); }
    }
  }

  public static void main(String[] args) {
    int n = Integer.parseInt(args[0]);
    rnd = new Random(Long.parseLong(args[1]));
    for (int c = 0; c < n; c++) {
      StringBuilder sb = new StringBuilder("{\"segs\":[");
      int nseg = 1 + rnd.nextInt(3);
      List<Path> parts = new ArrayList<>();
      Pose from = new Pose(coord(), coord(), 0);
      for (int s = 0; s < nseg; s++) {
        int ctrl = rnd.nextInt(4); // 0 = line
        List<Pose> pts = new ArrayList<>();
        pts.add(from);
        for (int i = 0; i < ctrl; i++) pts.add(new Pose(coord(), coord(), 0));
        Pose end = new Pose(coord(), coord(), 0);
        // sometimes a nearly straight curve (uneven control spacing), the case that trips naive arc-length tables
        if (ctrl == 1 && rnd.nextInt(3) == 0) {
          double u = 0.05 + rnd.nextDouble() * 0.2;
          pts.set(1, new Pose(from.x() + (end.x() - from.x()) * u, from.y() + (end.y() - from.y()) * u, 0));
        }
        pts.add(end);
        if (s > 0) sb.append(",");
        sb.append("[");
        for (int i = 0; i < pts.size(); i++) { if (i > 0) sb.append(","); sb.append("{\"x\":").append(f(pts.get(i).x())).append(",\"y\":").append(f(pts.get(i).y())).append("}"); }
        sb.append("]");
        parts.add(ctrl == 0 ? Paths.line(from, end) : Paths.curve(pts.toArray(new Pose[0])));
        from = end;
      }
      sb.append("],\"h\":");
      Path path = parts.size() == 1 ? parts.get(0) : Paths.path(parts.toArray(new Path[0]));
      Interpolator interp;
      if (rnd.nextInt(2) == 0) {
        interp = leaf(sb, true);
      } else {
        int pieces = 2 + rnd.nextInt(3);
        double[] untils = new double[pieces];
        double last = 0;
        for (int i = 0; i < pieces; i++) { last = i == pieces - 1 ? 1.0 : last + (1 - last) * (0.15 + rnd.nextDouble() * 0.5); untils[i] = Math.round(last * 1000) / 1000.0; if (i == pieces - 1) untils[i] = 1.0; }
        PiecewiseInterpolator pw = Interpolator.piecewise();
        sb.append("{\"k\":\"piecewise\",\"pieces\":[");
        for (int i = 0; i < pieces; i++) {
          if (i > 0) sb.append(",");
          sb.append("{\"until\":").append(f(untils[i])).append(",\"i\":");
          Interpolator child = leaf(sb, true);
          sb.append("}");
          pw.until(untils[i], child);
        }
        sb.append("]}");
        interp = pw;
      }
      path = path.heading(interp);
      try {
      path.getSegments();
      sb.append(",\"len\":").append(o(path.curve.length())).append(",\"t\":[");
      for (int i = 0; i <= 20; i++) {
        double t = i / 20.0;
        if (i > 0) sb.append(",");
        sb.append("[").append(o(path.curve.get(t).x())).append(",").append(o(path.curve.get(t).y())).append(",").append(o(path.heading(t))).append(",").append(o(path.curve.pathCompletion(t))).append("]");
      }
      sb.append("],\"par\":[");
      for (int i = 0; i <= 10; i++) { if (i > 0) sb.append(","); sb.append(o(path.curve.parameter(i / 10.0))); }
      sb.append("]}");
      System.out.println(sb);
      } catch (Exception e) { skipped++; }
    }
    System.err.println("skipped " + skipped + " cases that Pedro itself throws on");
  }
  static int skipped = 0;
}
