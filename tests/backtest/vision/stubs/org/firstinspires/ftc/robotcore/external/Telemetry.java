package org.firstinspires.ftc.robotcore.external;
/** The parts of RobotCore 12.0.0's Telemetry the generated code uses, same signatures. */
public interface Telemetry {
  interface Item {}
  interface Line {}
  Item addData(String caption, String format, Object... args);
  Item addData(String caption, Object value);
  boolean update();
  Line addLine(String lineCaption);
}
