package org.firstinspires.ftc.team2844simple.subsystems;
import com.pedropathing.math.Vector2D;
import com.pedropathing.paths.Path;
import com.pedropathing.paths.PathSegment;
import com.vcs.valleylib.core.command.Command;
import com.vcs.valleylib.core.command.Commands;
import com.vcs.valleylib.ftc.pedro.PedroSubsystem;
import java.util.List;
/**
 * Test double that does what Pedro's follower does with a path, without hardware:
 * build the segments (follower.follow), then for each segment the first control loop with the
 * robot at its start (Foresight.calculatePath: closest point, heading, tangent) and a sweep along it.
 */
public class DriveSubsystem extends PedroSubsystem {
  public DriveSubsystem() { super(null, null); }
  @Override public Command follow(Path path) {
    List<PathSegment> segments = path.getSegments();
    path.endPose();
    for (PathSegment seg : segments) {
      Vector2D robot = seg.curve.get(0.0);
      double closestT = seg.curve.closestParameter(robot, 0.0);
      for (int i = 0; i <= 39; i++) {
        double t = i == 0 ? closestT : Math.max(closestT, i / 40.0 + 0.00137); // off-grid: a real robot never lands on an exact fraction
        if (t >= 1 - 0.025) break; // parametricTConstraint: the end branch takes over
        seg.heading(t);
        seg.curve.tangent(t);
        seg.curve.curvature(t);
        seg.curve.remainingDistance(t);
      }
      seg.heading(1.0);
    }
    return Commands.none();
  }
  @Override public Command follow(Path path, double maxSpeed) {
    if (!(maxSpeed > 0)) throw new IllegalArgumentException("maxSpeed must be positive, was " + maxSpeed);
    return follow(path);
  }
}
