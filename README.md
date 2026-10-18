# Push Studio

Counts push-ups with the phone's front camera and keeps a daily log. It runs in mobile Safari or Chrome, and you can add it to the home screen.

## Architecture

The app is front-end only. It is a static website with no backend, no accounts and no build step.

```
index.html             the whole app: markup, CSS, JS
manifest.webmanifest   home-screen install (name, colors, icons)
icon-*.png             app icons
test/logic.test.js     tests for the counting logic, run with Node
```

### Runtime pipeline (all on-device)

```
front camera (getUserMedia, facingMode: user)
  → <video> frame
  → MediaPipe PoseLandmarker.detectForVideo   (WASM + WebGL, CPU fallback)
  → 33 body landmarks
  → signal extraction (one number per frame)
  → smoothing + rep state machine
  → UI (count, depth tube, skeleton overlay) + voice/beep
  → localStorage (daily log)
```

Video never leaves the device. The only network requests are for static assets: the MediaPipe JS and WASM from jsDelivr, the pose model from Google's MediaPipe model bucket, and the Anybody font from Google Fonts. After the first load the browser caches them.

### Counting logic

The logic sits in a pure block in `index.html` between `LOGIC-START` and `LOGIC-END`. It doesn't touch the DOM, so Node can test it.

- **Signals.** Each frame the app computes six candidate signals from the landmarks:
  - elbow angle
  - shoulder-to-wrist drop
  - nose-to-wrist drop
  - shoulder height
  - head height
  - shoulder width (how far the body is from the phone)

  Each signal has a type that controls how it adapts when the phone moves:
  - *absolute* (elbow angle): doesn't depend on where the phone sits
  - *shift* (the drop and height signals): moves when the phone moves
  - *ratio* (shoulder width): scales with distance from the phone
- **`Calibrator`.** The user holds the top position for 1.5 s, and that hold sets the top value and noise level for every signal. The user then does 3 slow reps, and each signal is tracked in parallel. The signal with the best separation-to-noise ratio wins, scored as median rep depth divided by resting noise. The result is saved as a *setup*: the signal plus its top and bottom values. Each phone placement gets its own setup, so different people and different spots each get their own calibration.
- **`RepCounter`.** Each frame's value is turned into progress, 0 at the top and 1 at the calibrated bottom. A rep counts when progress goes past the depth threshold (default 0.7, set in Settings) and back below 0.3. Shallow reps fire a `partial` cue and don't count.
  - **Arming.** A set starts after the user holds still near the top for about 1 s. For *shift* and *ratio* signals, the top value is reset at that point, so a phone placed slightly differently from last time still counts correctly.
  - **Dropouts.** If tracking drops out for 0.3 to 3 s mid-rep and the user comes back at the top, the rep is counted.

### UI

There are three screens:
- **Home:** today's total, goal, streak, a 14-day chart and today's sets.
- **Setup:** the placement picker, then the camera view, calibration and the result.
- **Session:** the live camera, rep count, depth tube and finish button.

Settings, setups, adding a set by hand, and reviewing a finished set happen in bottom sheets.

The visual style is a dark studio. Liquid Glass is used only on controls, following Apple's guidance:
- **Every browser:** backdrop blur and saturation, a gradient rim highlight, and a highlight that follows your touch.
- **Chromium only:** the glass edges also bend what's behind them. This uses an SVG displacement map built per element and applied with `backdrop-filter: url()`, which Safari doesn't support.

### Storage

Everything is stored under one `localStorage` key, `pushStudio.v1`:

```js
{ setups: [{ id, name, place, signal, up, down, noise, score, quality }],
  active, goal, depth, sound, model,
  log: { "YYYY-MM-DD": { sets: [{ t, reps, setup, manual }] } } }
```

Data is tied to the device and to the site address, so changing the address starts a fresh log. On iOS, add the app to the home screen so Safari doesn't clear site storage after a week of not opening it. Use Settings → Export CSV for backups.

## Run

The camera needs HTTPS, except on `localhost`.

```sh
python3 -m http.server 8000                       # desktop: http://localhost:8000
cloudflared tunnel --url http://localhost:8000    # phone: open the printed https URL
```

To deploy, put the folder on any HTTPS static host, such as GitHub Pages, Cloudflare Pages or Netlify.

## Test

```sh
node test/logic.test.js
```

The tests run calibration and counting against simulated side and front views. They check that the right signal is chosen, that partial reps are caught, that tracking dropouts are handled, that a moved phone still counts correctly, that fast reps are all counted, and that holding still produces no reps.
