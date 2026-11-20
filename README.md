# ValleyVis

An auto path visualizer for **ValleyLib 2.0.0 + Pedro Pathing 3.0.1** on the FTC **BIOBUZZ** field. It works like the Pedro Pathing Visualizer, and it exports Java you can paste straight into a `team2844simple`-style auto (`AutoBase` + `PedroAutoDsl`).

Everything is editable:
- **Paths:** lines, Bézier curves with any number of control points, and multi-segment paths.
- **Headings:** linear (short or long way, with `endT`), constant, tangent, reverse tangent, facing a point, and piecewise.
- **Speed:** max speed and timeout per path.
- **Actions between moves:** subsystem commands and instant code, run alone or in parallel, with optional timeouts.
- **Actions during a move:** commands that run for the whole path (`deadlineWith`), and **markers** that fire at a % of the path.
- **Other steps:** wait times, turns in place (`TurnToCmd`), and raw Java.
- **Keep-out zones:** rectangles, circles and polygons. Each has a "stay at least *x* in away" clearance measured from the robot's **edge** (rotated L × W footprint).
- **Settings page:** robot size, motion estimates, match timing, named constants, field points, the command library and every Java name and package.

## Run it

It's a static site with no build step:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static host works, because ES modules need `http://`, not `file://`.

**Live site:** <https://vis.vcs-robotics.com> (custom domain set by the `CNAME` file; <https://elluveride.github.io/valleyVis/> redirects there). It is served from the `gh-pages` branch. Every push to `main` runs the tests and, if they pass, copies the commit to `gh-pages` (`.github/workflows/pages.yml`). You can also push a branch there directly with `git push origin HEAD:gh-pages`.

## Using it

| Do this | How |
| --- | --- |
| Move a point | Drag ● (segment ends) or ■ (control points). Hold **Shift** to turn off snapping. |
| Aim a heading | Drag the round knob in front of the ghost robot. |
| Add or remove a control point | **Double-click** the selected path to add one. **Right-click** a control point to remove it. |
| Use robot constants | Type expressions like `144-L/2` in any coordinate field. They export as `144.0 - Constants.ROBOT_LENGTH / 2.0`. |
| Run something while driving | In the path step, use *While driving* (whole path) or *Markers* (at a %). |
| Mark a no-go area | Open the *Zones* tab, pick Rectangle/Circle/Polygon, draw it, then set the clearance. |
| Check red | Use the Blue/Red toggle. You design in the blue frame, and red is previewed through `AutoPaths.RED` (`mirrorX(72).mirrorY(72)`). |
| Get code | Click **Export**. The tabs you will want are first: *Routine class*, *Blue/Red OpMode*, *Park route* and *Point array*; the rest sit under *Other formats*. |
| Keep several autos | **Routines ▾** lists every routine saved in this browser. Edits save as you go, and each routine has its own undo history. Examples and opened files are added to the list; nothing is overwritten. |
| Send a routine to a teammate | **Share** copies a link that holds the routine (optionally with your robot settings). Nothing is uploaded: the link itself is the data. Or use *Routines → Save this routine as a file* and commit the `.vvis.json`. |
| End a path on a shared spot | Pick a **Named pose** in the path editor, or drag the path end near one and it snaps. Poses with Java (like `AutoPaths.xFlower(f)`) export as that expression. Edit the list in *Settings → Named points*. |
| See what the robot is doing | While playing or scrubbing, the bottom-right of the field shows the current step and the commands running at that moment. |
| Use it at a competition | After one visit the site works **offline**, and browsers offer to install it as an app. |
| Pick up a ball it finds itself | Add a **+ Pickup** step. The robot looks with a HuskyLens, turns toward the search area if nothing is in view, then drives at the nearest ball of that color and stops with it at the intake. Drag the ● practice spot to see how it behaves with the ball in different places (the robot goes wherever the real ball is), and the ■ corners to set where balls count. Paths after a pickup are built from wherever the robot ended up. See *HuskyLens pickups* below. |
| Change where the robot parks | Click the **Park** card (or the dashed park route, or the *park* block on the timeline). Drag the park pose, its heading knob, or a corridor corner, or type values. Then use *Export → Park route (AutoPaths)* and paste it into `AutoPaths.java`, because the park is shared by every auto. *Reset to team code* puts it back. |
| Measure a distance | Turn on **Ruler** (top-right of the field) and drag between two spots. Esc puts it away. |
| See all shortcuts | Press **?**. |

### Exports

- **Paste-in methods:** `startingPose()` + `routine()`, plus a `reached()` helper if you used markers. Paste them into any class that `extends AutoBase`. This is the fastest way to test.
- **Routine class:** an abstract `XxxRoutine extends AutoBase` with its package and imports.
- **Geometry class + Routine (uses Geometry):** the team's two-file layout. The Geometry class holds static poses and paths (like `UpGeometry`), and the routine follows them (like `UpRoutine`). Use these two instead of "Routine class" if you want that layout.
- **Blue / Red OpModes:** `@Autonomous` subclasses that set `alliance()` and `target()`.
- **Point array:** the routine as plain `(x, y, heading)` points: the poses you placed (optionally with curve control points) or points sampled every few inches along the drive with the time each is reached. Java `double[][]`, Java `Pose[]` built with `f.of` (so it mirrors for red by itself), CSV or JSON, in the blue frame or as red field coordinates, with or without the park route.
- **Park route (AutoPaths):** a replacement for `park(f)` and `routeToPark(f, from, alliance)`. It drives the route as you edited it and skips legs too short for Pedro to follow. Until you edit it, the park card shows the team's own `routeToPark` (commit 3ce19d4, Nov 17): across to the corridor at 75% speed, down it holding the heading, then in.
- **Vision setup:** the files a pickup step needs, added once: `HuskyCamera` (pixel → field maths, the same as the preview), `HuskyLensSubsystem`, `VisionPickupCmd`, a `HuskyLensCheck` TeleOp, plus lines for `Constants.java` and `Subsystems.java`. It moves up next to the main exports once the routine has a pickup.

Markers export as `drive.follow(path).deadlineWith(Commands.sequence(Commands.waitUntil(() -> reached(segment, inchesLeft)), cmd))`. `reached` reads `follower.pathIndex()` and `follower.remainingDistance()`, and does not use `completion()`, because in Pedro 3.0.1 `completion()` mixes the current segment's t with the whole path on multi-segment paths. ValleyLib's scheduler runs subsystem `periodic()` (and so `follower.update()`) before commands, so the check always sees the current path.

### HuskyLens pickups

- **Which camera:** the original DFRobot HuskyLens (SEN0305). The BIOBUZZ manual allows it by name (R702, Example 5) and the FTC SDK has a driver for it (`com.qualcomm.hardware.dfrobot.HuskyLens`). It plugs into an I2C port and is set up as a "HuskyLens" device in the robot configuration. The HuskyLens 2 is not covered by that rule or the SDK.
- **Setting it up:** teach each ball color in *Color Recognition* (pollen is yellow; nectar is your alliance color) and enter the IDs in *Settings → Camera*, along with where the lens is on the robot. DFRobot does not publish the field of view, so run **HuskyLensCheck**: put a ball at known spots and use the dpad to adjust tilt and field of view until the numbers on the Driver Station match. Copy them back into Settings and tick *checked*.
- **What the robot does:** it looks along its heading; if nothing is there it turns toward the search area in steps (looking the whole time), then sweeps the other way. Once it sees a ball of the right color inside the search area, it drives at it nose-first and stops `reach` short of it (half the robot length by default, so the ball is at the bumper). It re-aims if the ball turns out to be somewhere else until the last few inches, where the ball drops out of view. It ignores the other alliance's nectar and anything outside the area.
- **Timing:** the timeline shows how long the preview took and, hatched, how long it could take if it has to give up (the step's timeout). The Problems tab warns if that worst case would run past AutoBase's 20 s.
- **No ball sensor yet:** the pickup ends when the robot reaches the ball. If you add a sensor later, type its check (for example `subsystems.intake.hasBall()`) in *Settings → Camera → Ball-in check* and the pickup also ends as soon as it is true.

### Field frame

The bundled image is drawn with Pedro **+x up** and **+y left**, with the origin at the bottom-right. That matches the team's coordinates: blue garden at (144,144), flowers at (96,0)/(144,96)/(48,144)/(0,48), blue park on the x=144 wall at y=24. You can rotate the view or upload your own image under *Settings → Field view*.

## How faithful is the preview?

- **Geometry and headings match Pedro 3.0.1 exactly.** That includes Pedro's adaptive arc-length table, how `CompoundCurve` splits `t` by segment length, how `PiecewiseInterpolator` re-scales `t` per piece, and which way `longLinear` turns at the tie cases. Two test files compare against output from the real library: the team's own paths (`tests/pedro-parity.test.js`) and 255 random paths with random headings (`tests/pedro-fuzz.test.js`). Positions, completions and headings agree to 1e-6.
- **Timing is an estimate.** It uses a trapezoid profile with a curvature speed cap, and it is not Foresight's controller. Top speed does follow Pedro's mecanum model (fast nose-first, slower strafing, slowest on diagonals). Tune *Settings → Motion* against a stopwatch.
- **Command timing follows ValleyLib's rules.** A timeout ends a step at whichever comes first, a parallel group waits for its slowest command, and commands running during a path are cut when the path ends.
- **Timeouts are simulated** like `AutoBase`: the routine is cut at 20 s, then `AutoPaths.routeToPark` runs for up to 9.75 s.
- **Pickups use the same camera maths as the robot.** The preview and `HuskyCamera` share one projection, and the vision backtest below runs the exported `VisionPickupCmd` against a simulated robot and camera to check it ends where the preview said. The preview still only knows where you *expect* the ball to be, and its accuracy depends on the camera numbers you measured.

## Things Pedro 3.0.1 does that the tool handles for you

These were found by running exported code against the real library (see *Backtest* below).

| Pedro behaviour | What ValleyVis does |
| --- | --- |
| A piecewise heading on a multi-segment path throws (`NullPointerException` or `IllegalArgumentException`) on about 1 path in 9, because of rounding at the segment joints. | The export wraps those headings in a small `jointSafe(...)` helper. 0 of 100,000 random paths throw with it. |
| A control point exactly on the start of its curve makes the follower throw `Cannot normalize 0 vector`. The same happens on the end with a tangent heading. | Reported as an error in the Problems tab. |
| A zero-length line, a piecewise heading whose pieces are out of order or stop short of 1.0, or a speed cap of 0 all throw. | Reported as errors. |
| `follower.completion()` mixes up segment and whole-path progress on multi-segment paths. | Markers use `pathIndex()` and `remainingDistance()` instead. |
| A `tangent` or `facingPoint` piece inside a piecewise heading is evaluated at a re-scaled `t`. | The preview shows what the robot will really do, with a warning. |

## Backtest

`tests/backtest/run.sh` checks the exporter against the real libraries. It:

1. generates random routines that use every feature, plus shapes Pedro rejects;
2. exports them and compiles the Java against the Pedro Pathing 3.0.1 and ValleyLib 2.0.0 sources (with small stand-ins for the FTC SDK and the team classes);
3. builds every routine for both alliances the way the follower would, and compares what happened with what the Problems tab predicted;
4. compiles the exported park route and runs it from hundreds of end poses on both alliances, comparing every leg with the preview.

The last full run covered 1,000 routines (2,000 builds): every "this will throw" and "this is fine" prediction matched. The park check also compiles the team's own `routeToPark` (3ce19d4) and confirms the unedited park card matches it leg for leg. It needs a JDK, Node, Python 3, git, curl and unzip:

```bash
tests/backtest/run.sh
```

`tests/backtest/vision/run.sh` does the same for pickups. It compiles the Vision setup files and routines with pickups against Pedro 3.0.1 and ValleyLib 2.0.0, with stand-ins for the FTC SDK 12.0.0 classes they use (same signatures, checked with `javap`). Then it runs `VisionPickupCmd` closed-loop on a simulated robot whose camera renders the ball into whole pixels, and compares each run with the preview. On 1,000 random scenarios (random camera mounts, ball spots, scans, the other alliance's nectar in view), the found/not-found verdict matched every time, the end pose was within 0.93 in, and the time within 0.16 s.

```bash
tests/backtest/vision/run.sh
```

## Development

```bash
npm test
```

This runs the node:test suites in `tests/` and needs no dependencies.

```bash
npm run e2e
```

This drives the real app in headless Chromium (every drag, tool, dialog and shortcut). It needs Playwright (`npm i -D playwright`, then `npx playwright install chromium`).

Code map (`src/`):
- `expr.js`: coordinate expressions → numbers / Java
- `geometry.js`: Bézier/line maths that mirror Pedro's `Curve`s
- `heading.js`: Pedro `Interpolator` semantics
- `resolve.js`: project → numeric model for an alliance, plus the "Pedro will throw" checks
- `schema.js`: repairs anything loaded from storage or files
- `simulate.js`: timeline, velocity profile, park route
- `collision.js`: footprint vs zones / walls
- `codegen.js`: Java export
- `lint.js`: subsystem conflicts, naming, heading hand-offs between paths
- `share.js`: share-link encoding
- `poses.js`: named poses (snapping, tying a path end to a pose)
- `points.js`: point-array export
- `park.js`: the park route after the routine (team-code version, edited version, and its Java)
- `camera.js`: HuskyLens projection (pixel ↔ field), what it can see, scan headings
- `vision.js`: plans a pickup the way `VisionPickupCmd` runs it
- `visionJava.js`: the Vision setup Java files
- `store.js`: routine library, undo/redo, settings, saving to the browser
- `render.js` / `interact.js`: canvas
- `ui/`: panels and dialogs
- `presets.js`: the team's existing Up / Solo / Down routines, rebuilt for comparison

`sw.js` (repo root) is the offline cache. It lists every app file; `tests/offline.test.js` fails if a new file is missing from the list.
