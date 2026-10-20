// Builds app-www/, the web bundle inside the iOS app: public/ plus local copies of everything the
// website loads from CDNs (MediaPipe, the pose models, Firebase, the font), so the app starts fast
// and counts with no connection. index.html picks the local paths at runtime when it runs in the app.
//   node scripts/build-app-www.js [--skip-models]   (then: npx cap sync ios)
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'app-www');
const NM = path.join(ROOT, 'node_modules');
const CACHE = path.join(ROOT, '.cache');
const MODELS = {
  'pose_landmarker_lite.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  'pose_landmarker_full.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};

function copy(src, dst) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
function copyDir(src, dst) { for (const f of fs.readdirSync(src)) { const s = path.join(src, f); fs.statSync(s).isDirectory() ? copyDir(s, path.join(dst, f)) : copy(s, path.join(dst, f)); } }
function get(url, dst, hops = 0) {
  return new Promise((res, rej) => {
    https.get(url, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hops < 5) { r.resume(); return get(new URL(r.headers.location, url).href, dst, hops + 1).then(res, rej); }
      if (r.statusCode !== 200) { r.resume(); return rej(new Error(url + ' → HTTP ' + r.statusCode)); }
      const tmp = dst + '.part', f = fs.createWriteStream(tmp);
      r.pipe(f); f.on('finish', () => f.close(() => { fs.renameSync(tmp, dst); res(); })); f.on('error', rej);
    }).on('error', rej);
  });
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  copyDir(path.join(ROOT, 'public'), OUT);

  // index.html: the font from a local file instead of Google Fonts
  const font = path.join(NM, '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2');
  copy(font, path.join(OUT, 'vendor/fonts/archivo-wdth.woff2'));
  let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const before = html;
  html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>\s*/g, '')
    .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2[^>]*>/,
      '<style>@font-face{font-family:"Archivo";font-style:normal;font-weight:100 900;font-stretch:62% 125%;font-display:swap;src:url(vendor/fonts/archivo-wdth.woff2) format("woff2")}</style>');
  if (html === before) throw new Error('index.html: Google Fonts link not found, update build-app-www.js');
  fs.writeFileSync(path.join(OUT, 'index.html'), html);

  // MediaPipe Tasks Vision: the bundle and its wasm
  const mp = path.join(NM, '@mediapipe/tasks-vision');
  copy(path.join(mp, 'vision_bundle.mjs'), path.join(OUT, 'vendor/mediapipe/vision_bundle.mjs'));
  copyDir(path.join(mp, 'wasm'), path.join(OUT, 'vendor/mediapipe/wasm'));

  // Pose models, downloaded once into .cache/
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [name, url] of Object.entries(MODELS)) {
    const c = path.join(CACHE, name);
    if (process.argv.includes('--skip-models') && !fs.existsSync(c)) { console.warn('skipping ' + name + ' (--skip-models)'); continue; }
    if (!fs.existsSync(c)) { process.stdout.write('downloading ' + name + '\n'); await get(url, c); }
    copy(c, path.join(OUT, 'vendor/models', name));
  }

  // Firebase browser builds; they import each other from gstatic, point those at the local copies
  const ver = require(path.join(NM, 'firebase/package.json')).version;
  const want = (html.match(/firebasejs\/([\d.]+)\//) || [])[1];
  if (want && want !== ver) throw new Error(`index.html uses Firebase ${want} but node_modules has ${ver}; keep them the same`);
  for (const n of ['app', 'auth', 'firestore']) {
    let js = fs.readFileSync(path.join(NM, 'firebase', 'firebase-' + n + '.js'), 'utf8');
    js = js.replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+\.js)/g, './$1');
    fs.mkdirSync(path.join(OUT, 'vendor/firebase'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'vendor/firebase/firebase-' + n + '.js'), js);
  }

  const size = (d) => fs.readdirSync(d).reduce((a, f) => { const p = path.join(d, f), s = fs.statSync(p); return a + (s.isDirectory() ? size(p) : s.size); }, 0);
  console.log(`app-www ready: ${(size(OUT) / 1e6).toFixed(1)} MB`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
