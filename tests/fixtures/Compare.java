package cmp;
import com.pedropathing.api.Paths;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.math.Pose;
import com.pedropathing.math.Vector2D;
import com.pedropathing.paths.Path;
import com.pedropathing.paths.interpolator.Interpolator;
public class Compare {
  static void dump(String name, Path p) {
    StringBuilder sb = new StringBuilder(name);
    for (int i = 0; i <= 20; i++) {
      double t = i / 20.0;
      Vector2D v = p.curve.get(t);
      sb.append(String.format(" %.4f,%.4f,%.4f", v.x(), v.y(), p.heading(t)));
    }
    System.out.println(sb);
  }
  public static void main(String[] a) {
    PoseFactory f = PoseFactory.degrees();
    Pose s = f.of(75, 70, 0), e = f.of(40, 100, 180);
    dump("pw", Paths.curve(s, f.of(60, 120, 0), e).heading(Interpolator.piecewise()
      .until(0.1, Interpolator.tangent).until(0.3, Interpolator.tangent.reverse())
      .until(0.5, Interpolator.facingPoint(f.of(72, 72, 0)))
      .until(0.7, Interpolator.longLinear(f.of(40, 100, 10), e))
      .until(1.0, Interpolator.constant(f.of(40, 100, 33)))));
    Pose g = f.of(136.0625, 136.0625, 0), j = f.of(82, 112, 0), fs = f.of(82, 24, 90);
    dump("underpass", Paths.path(Paths.curve(g, f.of(82, 137, 0), j), Paths.curve(j, f.of(82, 107, 0), fs))
      .heading(Interpolator.piecewise().until(0.2, Interpolator.constant(g)).until(0.8, Interpolator.linear(g, fs)).until(1.0, Interpolator.constant(fs))));
    Pose st = f.of(79.9375, 136.0625, -90);
    dump("up", Paths.curve(st, f.of(108, 120, 0), g).heading(Interpolator.piecewise().until(0.2, Interpolator.constant(st)).until(0.8, Interpolator.linear(st, g)).until(1.0, Interpolator.constant(g))));
    dump("lin", Paths.line(f.of(10, 10, 170), f.of(50, 30, -170)).linear(f.of(10, 10, 170), f.of(50, 30, -170), 0.6));
    PoseFactory red = PoseFactory.degrees().mirrorX(72).mirrorY(72);
    Pose rs = red.of(79.9375, 136.0625, -90), rg = red.of(136.0625, 136.0625, 0);
    dump("upRed", Paths.curve(rs, red.of(108, 120, 0), rg).heading(Interpolator.piecewise().until(0.2, Interpolator.constant(rs)).until(0.8, Interpolator.linear(rs, rg)).until(1.0, Interpolator.constant(rg))));
  }
}
