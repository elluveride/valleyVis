package com.qualcomm.hardware.dfrobot;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

/**
 * Stand-in for the FTC SDK 12.0.0 HuskyLens driver (Hardware-12.0.0.aar): the same public API
 * (checked with javap), with what the camera "sees" supplied by the test through {@link #scene}.
 */
public class HuskyLens {
  public enum Algorithm { FACE_RECOGNITION, OBJECT_TRACKING, OBJECT_RECOGNITION, LINE_TRACKING, COLOR_RECOGNITION, TAG_RECOGNITION, OBJECT_CLASSIFICATION, NONE }

  public static class Block {
    public final int x, y, width, height, top, left, id;
    /** Like the SDK: little-endian 16-bit x, y, width, height, id from the reply frame. */
    public Block(HuskyLens huskyLens, byte[] data) {
      x = u16(data, 0); y = u16(data, 2); width = u16(data, 4); height = u16(data, 6); id = u16(data, 8);
      top = y - height / 2; left = x - width / 2;
    }
    private static int u16(byte[] d, int i) { return (d[i] & 0xff) | ((d[i + 1] & 0xff) << 8); }
    @Override public String toString() { return "id=" + id + " x=" + x + " y=" + y + " w=" + width + " h=" + height; }
  }

  public static class Arrow {}

  /** Test hook (not in the SDK): what blocks() returns. */
  public static Supplier<Block[]> scene = () -> new Block[0];
  public static int reads = 0;

  public String getDeviceName() { return "HuskyLens"; }
  public boolean knock() { return true; }
  public void selectAlgorithm(Algorithm algorithm) {}
  public Block[] blocks() { reads++; return scene.get(); }
  public Block[] blocks(int id) {
    List<Block> out = new ArrayList<>();
    for (Block b : blocks()) if (b.id == id) out.add(b);
    return out.toArray(new Block[0]);
  }
  public Arrow[] arrows() { return new Arrow[0]; }
  public Arrow[] arrows(int id) { return new Arrow[0]; }
}
