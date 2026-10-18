# Anyfield

Prop your phone up anywhere: a living-room floor, a park, a hotel room. The front camera counts your push-ups and keeps a daily log. It runs in mobile Safari or Chrome, and you can add it to the home screen.

## Architecture

The app is a static website with no build step and no server code of its own. Google sign-in and the synced log run on Firebase, and everything else runs on the phone.

```
public/                     the website (deployed as-is)
  index.html                the whole app: markup, CSS, JS
  firebase-config.js        Firebase web config for hosts other than Firebase Hosting
  manifest.webmanifest      home-screen install (name, colors, icons)
  icon-*.png                app icons
test/logic.test.js          tests for the counting logic, run with Node
.github/workflows/test.yml  runs the tests on every push
firebase.json, .firebaserc  Firebase config: Hosting (site anyfield) and Firestore rules
firestore.rules             Firestore security rules (private logs, group leaderboards)
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
  → daily log: localStorage, or Firestore when signed in
```

Video never leaves the device. Apart from Firebase sign-in and sync, the only network requests are for static assets: the MediaPipe JS and WASM from jsDelivr, the pose model from Google's MediaPipe model bucket, and the Archivo font from Google Fonts. After the first load the browser caches them.

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
- **`Calibrator`.** The user holds the top position for 1.5 s, and that hold sets the top value and noise level for every signal. The user then does 3 slow reps, and each signal is tracked in parallel.
  - **What counts as a calibration rep:** it lasts at least 0.6 s, finishes at least 0.9 s after the previous one, and is at least 60% as deep as the deepest rep on that signal. This drops nods, glances at the screen and shuffling into position.
  - **When it finishes:** once two signals agree on 3 reps, and no sooner than 3 s after the start. One signal that dips twice per push-up (elbow angle seen from the front does this) can't end calibration early.
  - **Which signal wins:** the best separation-to-noise ratio (median rep depth divided by resting noise) among signals whose count matches the agreed one. Head signals are weighted down because glancing at the phone moves them.
  - **Result:** saved as a *setup*: the signal plus its top and bottom values. Each phone placement gets its own setup, so different people and different spots each get their own calibration.
- **`RepCounter`.** Each frame's value is turned into progress, 0 at the top and 1 at the calibrated bottom. A rep counts when progress goes past the depth threshold (default 0.7, set in Settings) and back below 0.3, at least 0.6 s after the previous rep.
  - **Shallow reps:** once a dip passes halfway and lasts 0.35 s, turning back up by 0.1 before reaching the depth line fires `shallow` ("Lower", said while you're still down). If you then go deeper, the rep counts. If you come back up instead, `nocount` fires at the top. Quick nods never trigger either.
  - **Arming.** A set starts after the user holds still near the top for about 1 s. For *shift* and *ratio* signals, the top value is reset at that point, so a phone placed slightly differently from last time still counts correctly.
  - **Dropouts.** If tracking drops out for 0.3 to 3 s mid-rep and the user comes back at the top, the rep is counted.

### UI

There are three screens:
- **Home:** today's total, goal, streak, a 14-day chart and today's sets.
- **Setup:** the placement picker, then the camera view, calibration and the result.
- **Session:** the live camera, rep count, depth tube and finish button.

Settings, setups, adding a set by hand, and reviewing a finished set happen in bottom sheets.

The visual style is a dark matcha studio: deep green-black room, whisked-matcha accent, foam-white type set in Archivo. Liquid Glass is used only on controls, following Apple's guidance:
- **Every browser:** backdrop blur and saturation, a gradient rim highlight, and a highlight that follows your touch.
- **Chromium only:** the glass edges also bend what's behind them. This uses an SVG displacement map built per element and applied with `backdrop-filter: url()`, which Safari doesn't support.

### Accounts, sync and groups (Firebase)

Firebase project `home24-studio`, hosting site `anyfield`: Google sign-in, plus Firestore in us-west1, locked down by `firestore.rules`.

- **Signed out:** everything stays in `localStorage`, exactly as before.
- **Signing in:** the first time you sign in on a device, its local log and setups are copied into your account, and the local copy is cleared.
- **Signed in:** the app reads and writes Firestore. Its offline cache means a set logged without signal syncs later.
- **Daily totals:** stored as atomic increments in `users/{uid}/days/{date}`, so two devices logging at once can't overwrite each other.
- **Groups:** a group's id is its invite link (`?join=<id>`). Members see each other's daily totals, but never individual sets.
  - Each set you add or remove also bumps your score in every group you belong to.
  - That happens in a separate write, so a group problem never blocks your own log.
  - Joining a group copies in your totals for the current week.

| Path | Who can read | Who can write |
|---|---|---|
| `users/{uid}/…` (profile, sets, days, setups) | you | you |
| `boards/{bid}` | any signed-in user, by id only | owner |
| `boards/{bid}/members/{uid}` | members | yourself (join or leave); the owner can remove you |
| `boards/{bid}/scores/{day}_{uid}` | members | yourself; checked for allowed fields, a whole-number total from 0 to 5000, and a valid date |

On Firebase Hosting the app reads its config from `/__/firebase/init.json` and signs in through its own domain. That is what makes Google sign-in work in an iOS home-screen app. It needs two settings, both already in place:
- `anyfield.web.app` in Firebase Authentication → Authorized domains.
- In the project's Google OAuth web client: `https://anyfield.web.app` as a JavaScript origin and `https://anyfield.web.app/__/auth/handler` as a redirect URI.

`public/firebase-config.js` is the fallback for other hosts.

### Set videos

Recording is off by default. In Settings → Save set videos, pick a limit of 250 MB, 500 MB or 1 GB.
- **Recording:** each set is recorded with `MediaRecorder` from the moment tracking starts until Finish. Safari records MP4/H.264 and Chromium records MP4 or WebM, at about 1 Mbps (roughly 7 MB a minute).
- **Saving:** a clip is kept only if you save the set; discarding the set drops it. Clips go in IndexedDB (`anyfield-video`, keyed by the set's timestamp) and are never uploaded.
- **Limit:** when the total passes the limit, the oldest clips are deleted first. A recording stops on its own at 90% of the limit.
- **Playback:** a play chip on the set row opens a player with Save to Photos (Web Share with a file) or Download, and Delete. Deleting a set also deletes its video.

### Storage

Everything is stored under one `localStorage` key, `pushStudio.v1`:

```js
{ setups: [{ id, name, place, signal, up, down, noise, score, quality }],
  active, goal, depth, sound, model, videoCap,          // videoCap in MB, 0 = off
  videos: { "<set t>": { size, dur, reps, type, day } }, // index of clips in IndexedDB
  log: { "YYYY-MM-DD": { sets: [{ t, reps, setup, manual }] } } }
```

Data is tied to the device and to the site address, so changing the address starts a fresh log. On iOS, add the app to the home screen so Safari doesn't clear site storage after a week of not opening it. Use Settings → Export CSV for backups.

## Run

The camera needs HTTPS, except on `localhost`.

- **Live:** https://anyfield.web.app, on Firebase Hosting (project `home24-studio`, site `anyfield`). On iPhone or iPad, open it in Safari, tap Share → Add to Home Screen.
- **Deploy:** `firebase deploy --only hosting --project home24-studio`. The `site` key in `firebase.json` targets `anyfield`. Google Cloud Shell has the CLI already signed in.
- **Local:**

```sh
python3 -m http.server 8000 --directory public    # desktop: http://localhost:8000
```

## Test

```sh
node test/logic.test.js
```

The tests run calibration and counting against simulated side and front views. They check that the right signal is chosen, that partial reps are caught, that tracking dropouts are handled, that a moved phone still counts correctly, that fast reps are all counted, and that holding still produces no reps.
