package visionsim;

import com.pedropathing.api.PoseFactory;
import com.pedropathing.follower.Follower;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import com.qualcomm.hardware.dfrobot.HuskyLens;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.vcs.valleylib.ftc.pedro.PedroSubsystem;
import org.firstinspires.ftc.robotcore.external.Telemetry;
import org.firstinspires.ftc.team2844simple.helpers.Constants;
import org.firstinspires.ftc.team2844simple.vision.HuskyCamera;
import org.firstinspires.ftc.team2844simple.vision.HuskyLensCheck;
import org.firstinspires.ftc.team2844simple.vision.HuskyLensSubsystem;
import org.firstinspires.ftc.team2844simple.vision.VisionPickupCmd;

import java.io.BufferedReader;
import java.io.FileReader;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Closed-loop run of the generated VisionPickupCmd: a follower that moves the robot along whatever
 * Pedro path it is given (constant speed, turns at a constant rate) and a HuskyLens that renders
 * the ball into pixels from the robot's pose. Prints where the robot ends up for each scenario.
 *
 * usage: VisionSim scenarios.txt [GeometryClass ...]
 */
public class VisionSim {
  static final double DT = 0.02;
  static final double SPEED = 40.0; // in/s
  static final double TURN = Math.toRadians(90.0); // rad/s

  static double norm(double a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a <= -Math.PI) a += 2 * Math.PI;
    return a;
  }

  static class FakeFollower extends Follower {
    Pose pose;
    Path path;
    double t;
    double len;
    Pose holdPose;
    boolean following;
    boolean holding;
    int follows;

    FakeFollower(Pose start) {
      super(null, null, null);
      pose = start;
    }

    static double length(Path p) {
      double l = 0;
      Pose prev = p.get(0.0);
      for (int i = 1; i <= 200; i++) {
        Pose q = p.get(i / 200.0);
        l += Math.hypot(q.x() - prev.x(), q.y() - prev.y());
        prev = q;
      }
      return l;
    }

    @Override public void follow(Path p) { path = p; t = 0; len = length(p); following = true; holding = false; follows++; }
    @Override public void hold(Pose p) { holdPose = p; holding = true; following = false; path = null; }
    @Override public void hold(Pose p, boolean useScaling) { hold(p); }
    @Override public void stop() { following = false; holding = false; path = null; }
    @Override public Pose pose() { return pose; }
    @Override public boolean following() { return following; }
    @Override public boolean holding() { return holding; }
    @Override public boolean idle() { return !following && !holding; }
    @Override public boolean isBusy() {
      if (following) return true;
      return holding && Math.abs(norm(holdPose.heading() - pose.heading())) > Math.toRadians(1.0);
    }
    @Override public void update() {
      if (following) {
        t = Math.min(1.0, t + SPEED * DT / Math.max(1e-6, len));
        pose = path.get(t);
        if (t >= 1.0) hold(path.endPose());
      } else if (holding) {
        double e = norm(holdPose.heading() - pose.heading());
        double s = Math.max(-TURN * DT, Math.min(TURN * DT, e));
        pose = new Pose(holdPose.x(), holdPose.y(), pose.heading() + s);
      }
    }
  }

  static class SimDrive extends PedroSubsystem {
    SimDrive(Follower f) { super(null, f); }
  }

  static class SimPickup extends VisionPickupCmd {
    double time = 0;
    SimPickup(PedroSubsystem d, HuskyLensSubsystem h, HuskyCamera.Ball b, int alliance, Pose[] area, double reach, double maxSpeed, double scan) {
      super(d, h, b, alliance, area, reach, maxSpeed, scan);
    }
    @Override protected double now() { return time; }
  }

  /** The camera, written from scratch here (forward model): ball centre -> pixel, or null if out of the image. */
  static int[] project(Pose robot, double bx, double by, double d) {
    double c = Math.cos(robot.heading()), s = Math.sin(robot.heading());
    double dx = bx - robot.x(), dy = by - robot.y();
    double rx = dx * c + dy * s, ry = -dx * s + dy * c;
    double vx0 = rx - Constants.HUSKY_X, vy0 = ry - Constants.HUSKY_Y, vz = d / 2 - Constants.HUSKY_HEIGHT;
    double yaw = Math.toRadians(Constants.HUSKY_YAW_DEG);
    double vx = vx0 * Math.cos(yaw) + vy0 * Math.sin(yaw);
    double vy = -vx0 * Math.sin(yaw) + vy0 * Math.cos(yaw);
    double th = Math.toRadians(Constants.HUSKY_PITCH_DEG);
    double fwd = vx * Math.cos(th) - vz * Math.sin(th);
    double up = vx * Math.sin(th) + vz * Math.cos(th);
    if (fwd <= 1e-6) return null;
    double fx = 160.0 / Math.tan(Math.toRadians(Constants.HUSKY_HFOV_DEG) / 2);
    double fy = 120.0 / Math.tan(Math.toRadians(Constants.HUSKY_VFOV_DEG) / 2);
    double px = 160 - fx * vy / fwd, py = 120 - fy * up / fwd, w = d * fx / fwd;
    if (px < 0 || px > 320 || py < 0 || py > 240) return null;
    return new int[] {(int) Math.round(px), (int) Math.round(py), (int) Math.round(w)};
  }

  static HuskyLens.Block block(HuskyLens lens, int x, int y, int w, int id) {
    int[] v = {x, y, w, w, id};
    byte[] b = new byte[10];
    for (int i = 0; i < 5; i++) { b[2 * i] = (byte) (v[i] & 0xff); b[2 * i + 1] = (byte) ((v[i] >> 8) & 0xff); }
    return new HuskyLens.Block(lens, b);
  }

  public static void main(String[] args) throws Exception {
    List<String> lines = new ArrayList<>();
    try (BufferedReader r = new BufferedReader(new FileReader(args[0]))) {
      for (String l; (l = r.readLine()) != null; ) if (!l.isBlank()) lines.add(l);
    }
    for (String line : lines) runScenario(line.trim().split("\\s+"));
    runCheckOpMode();
    for (int i = 1; i < args.length; i++) runtimePaths(args[i]);
  }

  /** id alliance(0/2) ball(P/N) sx sy sh bx by distractor(0/1) dx dy reach scan timeout lookTime commit reaim camX camY camH yaw pitch hfov vfov minArea n ax ay ... */
  static void runScenario(String[] a) {
    int k = 0;
    String id = a[k++];
    int alliance = Integer.parseInt(a[k++]);
    HuskyCamera.Ball ball = a[k++].equals("P") ? HuskyCamera.Ball.POLLEN : HuskyCamera.Ball.NECTAR;
    Pose start = new Pose(d(a[k++]), d(a[k++]), d(a[k++]));
    double bx = d(a[k++]), by = d(a[k++]);
    boolean distractor = a[k++].equals("1");
    double ox = d(a[k++]), oy = d(a[k++]);
    double reach = d(a[k++]), scan = d(a[k++]), timeout = d(a[k++]);
    Constants.HUSKY_LOOK_TIME = d(a[k++]);
    Constants.HUSKY_COMMIT_DISTANCE = d(a[k++]);
    Constants.HUSKY_REAIM_DISTANCE = d(a[k++]);
    Constants.HUSKY_X = d(a[k++]);
    Constants.HUSKY_Y = d(a[k++]);
    Constants.HUSKY_HEIGHT = d(a[k++]);
    Constants.HUSKY_YAW_DEG = d(a[k++]);
    Constants.HUSKY_PITCH_DEG = d(a[k++]);
    Constants.HUSKY_HFOV_DEG = d(a[k++]);
    Constants.HUSKY_VFOV_DEG = d(a[k++]);
    Constants.HUSKY_MIN_AREA = d(a[k++]);
    int n = Integer.parseInt(a[k++]);
    Pose[] area = new Pose[n];
    for (int i = 0; i < n; i++) area[i] = new Pose(d(a[k++]), d(a[k++]), 0);

    FakeFollower ff = new FakeFollower(start);
    SimDrive drive = new SimDrive(ff);
    HuskyLens lens = new HuskyLens();
    HardwareMap hw = new HardwareMap();
    hw.devices.put(Constants.HUSKY_NAME, lens);
    HuskyLensSubsystem husky = new HuskyLensSubsystem(hw);
    int wanted = ball.colorId(alliance);
    // the other alliance's nectar: a different color ID, which the pickup must ignore
    int other = alliance == Constants.RED_ALLIANCE ? Constants.HUSKY_NECTAR_BLUE_ID : Constants.HUSKY_NECTAR_RED_ID;
    HuskyLens.scene = () -> {
      List<HuskyLens.Block> out = new ArrayList<>();
      int[] p = project(ff.pose(), bx, by, ball.diameter);
      if (p != null) out.add(block(lens, p[0], p[1], p[2], wanted));
      if (distractor) {
        int[] q = project(ff.pose(), ox, oy, HuskyCamera.Ball.NECTAR.diameter);
        if (q != null) out.add(block(lens, q[0], q[1], q[2], other));
      }
      return out.toArray(new HuskyLens.Block[0]);
    };
    SimPickup cmd = new SimPickup(drive, husky, ball, alliance, area, reach, PedroSubsystem.NO_SPEED_LIMIT, scan);
    cmd.initialize();
    boolean done = false;
    while (cmd.time < timeout - 1e-9) {
      drive.periodic(); // the scheduler runs subsystems in the order they were made: drive first
      husky.periodic();
      cmd.execute();
      if (cmd.isFinished()) { done = true; break; }
      cmd.time += DT;
    }
    cmd.end(!done);
    Pose p = ff.pose();
    int readsAfter = HuskyLens.reads;
    husky.periodic(); // reading is off once the command ends
    boolean stillReading = HuskyLens.reads != readsAfter;
    System.out.println(String.format(Locale.ROOT, "%s %d %d %.4f %.4f %.5f %.3f %d %d", id, cmd.foundBall() ? 1 : 0, done ? 1 : 0, p.x(), p.y(), norm(p.heading()), cmd.time, ff.follows, stillReading ? 1 : 0));
  }

  static double d(String s) { return Double.parseDouble(s); }

  /** HuskyLensCheck runs a few loops against a lens that sees one ball, without throwing. */
  static void runCheckOpMode() {
    HuskyLens lens = new HuskyLens();
    HuskyLens.scene = () -> new HuskyLens.Block[] {block(lens, 160, 150, 20, Constants.HUSKY_POLLEN_ID), block(lens, 30, 10, 3, Constants.HUSKY_NECTAR_RED_ID)};
    HuskyLensCheck op = new HuskyLensCheck();
    op.hardwareMap = new HardwareMap();
    op.hardwareMap.devices.put(Constants.HUSKY_NAME, lens);
    StringBuilder log = new StringBuilder();
    op.telemetry = new Telemetry() {
      public Item addData(String c, String f, Object... v) { log.append(c).append(": ").append(String.format(Locale.ROOT, f, v)).append('\n'); return null; }
      public Item addData(String c, Object v) { log.append(c).append(": ").append(v).append('\n'); return null; }
      public boolean update() { return true; }
      public Line addLine(String l) { log.append(l).append('\n'); return null; }
    };
    double hfov = Constants.HUSKY_HFOV_DEG;
    op.gamepad1.dpad_right = true;
    op.runOpMode();
    System.out.println("CHECK hfov " + hfov + " -> " + Constants.HUSKY_HFOV_DEG + " vfov " + String.format(Locale.ROOT, "%.3f", Constants.HUSKY_VFOV_DEG));
    for (String l : log.toString().split("\n")) System.out.println("CHECK " + l);
  }

  /** Every Geometry path that starts at the robot's pose (after a pickup), built from a few poses. */
  static void runtimePaths(String className) throws Exception {
    Class<?> c = Class.forName(className);
    PoseFactory[] fs = {PoseFactory.degrees(), PoseFactory.degrees().mirrorX(72.0).mirrorY(72.0)};
    int built = 0;
    for (Method m : c.getMethods()) {
      Class<?>[] p = m.getParameterTypes();
      if (!Modifier.isStatic(m.getModifiers()) || p.length != 2 || p[0] != PoseFactory.class || p[1] != Pose.class) continue;
      for (PoseFactory f : fs) {
        for (double[] here : new double[][] {{30, 40, 0.3}, {100, 20, -2.0}, {72, 72, 3.1}}) {
          Path path = (Path) m.invoke(null, f, new Pose(here[0], here[1], here[2]));
          Pose s = path.get(0.0);
          if (Math.hypot(s.x() - here[0], s.y() - here[1]) > 1e-6) throw new AssertionError(className + "." + m.getName() + " does not start at here");
          for (int i = 0; i <= 50; i++) path.get(i / 50.0);
          built++;
        }
      }
    }
    System.out.println("RUNTIME " + className + " " + built);
  }
}
