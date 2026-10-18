# Anyfield

Prop your phone up anywhere: a living-room floor, a park, a hotel room. The front camera counts your push-ups and keeps a daily log. It runs in mobile Safari or Chrome, and you can add it to the home screen.

## Architecture

The app is front-end only. It is a static website with no backend, no accounts and no build step.

```
public/                     the website (deployed as-is)
  index.html                the whole app: markup, CSS, JS
  firebase-config.js        Firebase web config for hosts other than Firebase Hosting
  manifest.webmanifest      home-screen install (name, colors, icons)
  icon-*.png                app icons
test/logic.test.js          tests for the counting logic, run with Node
.github/workflows/test.yml  runs the tests on every push
firebase.json, .firebaserc  Firebase project config (Firestore rules; Hosting optional)
firestore.rules             Firestore security rules (private logs, group leaderboards)
```

### Run

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
