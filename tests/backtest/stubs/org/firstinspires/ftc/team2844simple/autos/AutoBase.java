package org.firstinspires.ftc.team2844simple.autos;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.math.Pose;
import com.vcs.valleylib.core.command.Command;
import org.firstinspires.ftc.team2844simple.helpers.Constants;
import org.firstinspires.ftc.team2844simple.helpers.Subsystems;
public abstract class AutoBase {
  protected Subsystems subsystems = new Subsystems();
  public abstract Pose startingPose();
  public abstract int alliance();
  public abstract int target();
  protected abstract Command routine();
  public Command build() { return routine(); }
  protected PoseFactory field() {
    return alliance() == Constants.BLUE_ALLIANCE ? PoseFactory.degrees() : PoseFactory.degrees().mirrorX(72.0).mirrorY(72.0);
  }
}
