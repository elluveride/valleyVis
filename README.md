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

**Live site:** <https://vcs-robotics.com> (custom domain set by the `CNAME` file; <https://elluveride.github.io/valleyVis/> redirects there). It is served from the `gh-pages` branch. Every push to `main` runs the tests and, if they pass, copies the commit to `gh-pages` (`.github/workflows/pages.yml`). You can also push a branch there directly with `git push origin HEAD:gh-pages`.

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
| Get code | Click **Export Java**. |
| Keep several autos | **Routines ▾** lists every routine saved in this browser. Edits save as you go, and each routine has its own undo history. Examples and opened files are added to the list; nothing is overwritten. |
| Send a routine to a teammate | **Share** copies a link that holds the routine (optionally with your robot settings). Nothing is uploaded: the link itself is the data. Or use *Routines → Save this routine as a file* and commit the `.vvis.json`. |
| End a path on a shared spot | Pick a **Named pose** in the path editor, or drag the path end near one and it snaps. Poses with Java (like `AutoPaths.xFlower(f)`) export as that expression. Edit the list in *Settings → Named points*. |
| See what the robot is doing | While playing or scrubbing, the bottom-right of the field shows the current step and the commands running at that moment. |
| Use it at a competition | After one visit the site works **offline**, and browsers offer to install it as an app. |
| See all shortcuts | Press **?**. |

### Exports

- **Paste-in methods:** `startingPose()` + `routine()`, plus a `reached()` helper if you used markers. Paste them into any class that `extends AutoBase`. This is the fastest way to test.
- **Routine class:** an abstract `XxxRoutine extends AutoBase` with its package and imports.
- **Blue / Red OpModes:** `@Autonomous` subclasses that set `alliance()` and `target()`.

Markers export as `drive.follow(path).deadlineWith(Commands.sequence(Commands.waitUntil(() -> reached(segment, inchesLeft)), cmd))`. `reached` reads `follower.pathIndex()` and `follower.remainingDistance()`, and does not use `completion()`, because in Pedro 3.0.1 `completion()` mixes the current segment's t with the whole path on multi-segment paths. ValleyLib's scheduler runs subsystem `periodic()` (and so `follower.update()`) before commands, so the check always sees the current path.

### Field frame

The bundled image is drawn with Pedro **+x up** and **+y left**, with the origin at the bottom-right. That matches the team's coordinates: blue garden at (144,144), flowers at (96,0)/(144,96)/(48,144)/(0,48), blue park on the x=144 wall at y=24. You can rotate the view or upload your own image under *Settings → Field view*.

## How faithful is the preview?

- **Geometry and headings match Pedro 3.0.1 exactly.** That includes Pedro's adaptive arc-length table, how `CompoundCurve` splits `t` by segment length, how `PiecewiseInterpolator` re-scales `t` per piece, and which way `longLinear` turns at the tie cases. Two test files compare against output from the real library: the team's own paths (`tests/pedro-parity.test.js`) and 255 random paths with random headings (`tests/pedro-fuzz.test.js`). Positions, completions and headings agree to 1e-6.
- **Timing is an estimate.** It uses a trapezoid profile with a curvature speed cap, and it is not Foresight's controller. Top speed does follow Pedro's mecanum model (fast nose-first, slower strafing, slowest on diagonals). Tune *Settings → Motion* against a stopwatch.
- **Command timing follows ValleyLib's rules.** A timeout ends a step at whichever comes first, a parallel group waits for its slowest command, and commands running during a path are cut when the path ends.
- **Timeouts are simulated** like `AutoBase`: the routine is cut at 20 s, then `AutoPaths.routeToPark` runs for up to 9.75 s.

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
3. builds every routine for both alliances the way the follower would, and compares what happened with what the Problems tab predicted.

The last full run covered 1,000 routines (2,000 builds): every "this will throw" and "this is fine" prediction matched. It needs a JDK, Node, Python 3, git, curl and unzip:

```bash
tests/backtest/run.sh
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
- `store.js`: routine library, undo/redo, settings, saving to the browser
- `render.js` / `interact.js`: canvas
- `ui/`: panels and dialogs
- `presets.js`: the team's existing Up / Solo / Down routines, rebuilt for comparison

`sw.js` (repo root) is the offline cache. It lists every app file; `tests/offline.test.js` fails if a new file is missing from the list.
