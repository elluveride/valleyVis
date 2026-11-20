package com.qualcomm.robotcore.eventloop.opmode;
public abstract class LinearOpMode extends OpMode {
  public int loopsLeft = 3;
  public abstract void runOpMode() throws InterruptedException;
  public void waitForStart() {}
  public final boolean opModeIsActive() { return loopsLeft-- > 0; }
}
