package com.qualcomm.robotcore.hardware;

import java.util.HashMap;
import java.util.Map;

/** Stand-in: get(Class, String) as in RobotCore 12.0.0, backed by a map the test fills. */
public class HardwareMap {
  public final Map<String, Object> devices = new HashMap<>();
  public <T> T get(Class<? extends T> classOrInterface, String deviceName) {
    Object d = devices.get(deviceName);
    if (d == null) throw new IllegalArgumentException("Unable to find a hardware device with name \"" + deviceName + "\"");
    return classOrInterface.cast(d);
  }
}
