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

### Exports

- **Paste-in methods:** `startingPose()` + `routine()`, plus a `reached()` helper if you used markers. Paste them into any class that `extends AutoBase`. This is the fastest way to test.
- **Routine class:** an abstract `XxxRoutine extends AutoBase` with its package and imports.
- **Blue / Red OpModes:** `@Autonomous` subclasses that set `alliance()` and `target()`.

Markers export as `drive.follow(path).deadlineWith(Commands.sequence(Commands.waitUntil(() -> reached(segment, inchesLeft)), cmd))`. `reached` reads `follower.pathIndex()` and `follower.remainingDistance()`, and does not use `completion()`, because in Pedro 3.0.1 `completion()` mixes the current segment's t with the whole path on multi-segment paths. ValleyLib's scheduler runs subsystem `periodic()` (and so `follower.update()`) before commands, so the check always sees the current path.

### Field frame

The bundled image is drawn with Pedro **+x up** and **+y left**, with the origin at the bottom-right. That matches the team's coordinates: blue garden at (144,144), flowers at (96,0)/(144,96)/(48,144)/(0,48), blue park on the x=144 wall at y=24. You can rotate the view or upload your own image under *Settings → Field view*.

## How faithful is the preview?

- **Geometry and headings match Pedro 3.0.1 exactly.** That includes Pedro's adaptive arc-length table, how `CompoundCurve` splits `t` by segment length, and how `PiecewiseInterpolator` re-scales `t` per piece. `tests/pedro-parity.test.js` checks against output from the real library (`tests/fixtures/Compare.java`): within 0.003° and 0.0001 in.
- **Timing is an estimate.** It uses a trapezoid profile with a curvature speed cap, and it is not Foresight's controller. Tune *Settings → Motion* against a stopwatch.
- **Timeouts are simulated** like `AutoBase`: the routine is cut at 20 s, then `AutoPaths.routeToPark` runs for up to 9.75 s.

## Development

```bash
npm test
```

This runs the node:test suites in `tests/` and needs no dependencies.

Code map (`src/`):
- `expr.js`: coordinate expressions → numbers / Java
- `geometry.js`: Bézier/line maths that mirror Pedro's `Curve`s
- `heading.js`: Pedro `Interpolator` semantics
- `resolve.js`: project → numeric model for an alliance
- `simulate.js`: timeline, velocity profile, park route
- `collision.js`: footprint vs zones / walls
- `codegen.js`: Java export
- `lint.js`: subsystem conflicts, naming
- `render.js` / `interact.js`: canvas
- `ui/`: panels and dialogs
- `presets.js`: the team's existing Up / Solo / Down routines, rebuilt for comparison
