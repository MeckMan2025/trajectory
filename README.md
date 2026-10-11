# Trajectory

Launcher tuning from slow-motion video. A Meckman Lab experiment, live at **trajectory.meckman.org**.

Film a shot, click the ball once, and get exit speed, launch angle, drag, a predicted arc, shot-to-shot consistency, and a distance to setpoint table you can paste into FRC or FTC robot code. Videos never leave the browser.

This is one of three entries in our launcher tuning shootout: the student hand-coded tool, Vernier Video Analysis as the industry benchmark, and this app. The Compare page reads all three tools' CSV exports for the same clip.

## Using it

1. **Load Video.** Drop in an MP4 or MOV. Slow motion (120 or 240 fps) gives the best speeds.
2. **Set Scale.** Click both ends of a meter stick in the frame, or use the ball diameter. Optionally place the launch point and a level line. If your phone re-timed the slow motion to 30 fps, pick the real capture rate here (the Fit step will also catch it).
3. **Track Motion.** Go to a frame mid-flight and click the ball, or press Find Ball. The tracker follows it both ways and flags frames worth a look. Click to move a point, `Del` to delete, `X` to exclude.
4. **Fit Arc.** Read exit speed, angle, fitted gravity (the built-in accuracy check) and drag. Enter the setpoint and Save Shot.
5. **Shot Log / Tune / Compare.** Check consistency per setpoint, fit speed against setpoint, build the shot table, and export it.

The next clip from the same camera setup keeps the scale and timing, so it goes straight to tracking.

### Filming tips

- Tripod, level, square to the flight path. The ball should cross the frame, not fly toward the camera.
- A meter stick or taped 1 m mark in the same plane as the shot.
- Bright light and a plain background. Keep same-color objects away from the flight path.
- Share the original slow-motion file when you can.

## How it works

| Piece | File |
| --- | --- |
| Frame-accurate decoding: mp4box.js demux + WebCodecs, `<video>` fallback | `public/js/video/decoder.js` |
| HSV color mask, hole-filling close, connected components | `public/js/tracking/color.js`, `blobs.js` |
| Predictive tracker with motion (three-frame difference) fallback | `public/js/tracking/tracker.js` |
| Free-flight detection (drops launcher wait and bounces) | `public/js/tracking/segment.js` |
| No-drag least squares fit with uncertainty, re-timing detector | `public/js/physics/fit.js` |
| Quadratic drag model, RK4 + Levenberg-Marquardt fit | `public/js/physics/drag.js` |
| Required launch speed for a target | `public/js/physics/solve.js` |
| Consistency stats, speed model, shot table, exporters, CSV import | `public/js/tuning/` |

Plain HTML, CSS and ES modules with no build step. The two libraries (mp4box.js 2.3.0, uPlot 1.6.32) are pinned in `public/vendor/` and loaded through an import map. Styling follows Meckman Design System V4.

## Development

```sh
npm install                 # Playwright, for tests and icons only
npm run serve               # http://localhost:8787
npm test                    # unit tests: physics, tracking, tuning, exporters, house rules
npm run e2e                 # browser tests (needs Google Chrome for the H.264/HEVC files)
node tools/make-fixtures.mjs   # regenerate test videos (needs ffmpeg)
node tools/make-icons.mjs      # regenerate PNG icons
npm run deploy              # npx wrangler deploy to trajectory.meckman.org
```

The test suite checks the answers against synthetic footage with a known trajectory: tracking error under 1 px and exit speed within 2% at 30 to 240 fps, an FTC export that compiles and interpolates with `javac`, and real H.264 and HEVC files decoded in Chrome.

## Privacy

Videos are decoded in the browser and never uploaded. No accounts, no analytics, no cookies. Shots are stored in this browser's IndexedDB until you export or delete them. Policy: https://meckman2025.github.io/Meckman_Privacy/apps/trajectory.html
