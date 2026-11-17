package org.firstinspires.ftc.team2844simple.autos;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.math.Pose;
import org.firstinspires.ftc.team2844simple.helpers.Constants;
/** The shared poses from the team's AutoPaths (same numbers as the real file). */
public final class AutoPaths {
  private AutoPaths() {}
  public static Pose park(PoseFactory f) { return f.of(144 - (Constants.ROBOT_LENGTH / 2.0), 24.0, 180.0); }
  public static Pose xFlower(PoseFactory f) { return f.of(96.0, (Constants.ROBOT_LENGTH / 2.0), -90.0); }
  public static Pose yFlower(PoseFactory f) { return f.of(144 - (Constants.ROBOT_LENGTH / 2.0), 96.0, 0.0); }
}
