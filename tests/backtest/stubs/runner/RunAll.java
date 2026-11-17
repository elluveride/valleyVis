package runner;
import org.firstinspires.ftc.team2844simple.autos.AutoBase;
/** Builds every generated routine (both alliances) against the real Pedro + ValleyLib classes. */
public class RunAll {
  public static void main(String[] a) throws Exception {
    int n = Integer.parseInt(a[0]);
    for (int c = 0; c < n; c++) {
      for (String layout : new String[]{"", "T"}) // "" = everything in the routine class, "T" = team layout with a Geometry class
      for (String al : new String[]{"Blue", "Red"}) {
        String cls = "org.firstinspires.ftc.team2844simple.autos." + al.toLowerCase() + "." + al + "Fuzz" + c + layout;
        String result;
        try {
          AutoBase auto = (AutoBase) Class.forName(cls).getDeclaredConstructor().newInstance();
          auto.startingPose();
          auto.build();
          result = "ok";
        } catch (Throwable e) {
          String m = String.valueOf(e.getMessage());
          result = e.getClass().getSimpleName() + ": " + m.substring(0, Math.min(90, m.length()));
        }
        System.out.println(c + layout + " " + al + " " + result);
      }
    }
  }
}
