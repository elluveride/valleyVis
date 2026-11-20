package com.qualcomm.robotcore.eventloop.opmode;
import com.qualcomm.robotcore.hardware.Gamepad;
import com.qualcomm.robotcore.hardware.HardwareMap;
import org.firstinspires.ftc.robotcore.external.Telemetry;
public abstract class OpMode {
  public volatile Gamepad gamepad1 = new Gamepad();
  public Telemetry telemetry;
  public volatile HardwareMap hardwareMap;
}
