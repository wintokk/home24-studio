// Synthetic tests for the push-up calibration + counting logic extracted from index.html
const fs = require('fs');
const html = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', 'index.html'), 'utf8');
const code = html.split('/* LOGIC-START */')[1].split('/* LOGIC-END */')[0];
new Function(code)();
const { Calibrator, RepCounter, KEYS } = globalThis.PushLogic;

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// depth profile: 0 at top, 1 at bottom. holdS seconds still, then reps of repS seconds each (with optional partials)
function profile(holdS, reps, repS, opts = {}) {
  const fps = 30, out = [];
  let t = 0;
  for (let i = 0; i < holdS * fps; i++) out.push({ t: (t += 1000 / fps), d: 0 });
  reps.forEach(depth => {
    const n = repS * fps;
    for (let i = 0; i < n; i++) out.push({ t: (t += 1000 / fps), d: depth * Math.sin(Math.PI * i / n) ** 2 });
    for (let i = 0; i < 0.4 * fps; i++) out.push({ t: (t += 1000 / fps), d: 0 });
  });
  return out;
}
// view models: map depth -> signal values with noise
const views = {
  side: d => ({ elbow: 172 - 92 * d + gauss() * 2, chest: 0.11 - 0.08 * d + gauss() * 0.003, head: 0.16 - 0.1 * d + gauss() * 0.004,
                shoulderY: 0.45 + 0.07 * d + gauss() * 0.003, headY: 0.42 + 0.09 * d + gauss() * 0.004, scale: 0.02 + gauss() * 0.004 }),
  front: d => ({ elbow: 160 - 15 * d + gauss() * 9, chest: 0.2 - 0.02 * d + gauss() * 0.006, head: null,
                 shoulderY: 0.40 + 0.11 * d + gauss() * 0.003, headY: 0.30 + 0.14 * d + gauss() * 0.004, scale: 0.26 + 0.05 * d + gauss() * 0.0025 }),
  still: d => ({ elbow: 170 + gauss() * 2, chest: 0.1 + gauss() * 0.003, head: null, shoulderY: 0.45 + gauss() * 0.003, headY: 0.4 + gauss() * 0.003, scale: 0.25 + gauss() * 0.002 })
};

function calibrate(view, prof) {
  const c = new Calibrator(); const evs = [];
  for (const f of prof) { c.push(f.t, views[view](f.d)).forEach(e => evs.push(e)); if (c.phase === 'done' || c.phase === 'failed') break; }
  // keep feeding still frames until timeout if not finished
  let t = prof[prof.length - 1].t;
  while (c.phase !== 'done' && c.phase !== 'failed') { t += 33; c.push(t, views[view](0)).forEach(e => evs.push(e)); }
  return evs;
}

let fail = 0;
const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fail++; };

// 1. side view calibration -> elbow
let ev = calibrate('side', profile(2.5, [1, 1, 1], 2.4));
let done = ev.find(e => e.type === 'done');
check('side view calibrates', !!done, done && JSON.stringify({ s: done.result.signal, q: done.result.quality, score: done.result.score, up: done.result.up.toFixed(1), down: done.result.down.toFixed(1) }));
check('side view picks elbow', done && done.result.signal === 'elbow');
check('side view announces 3 reps', ev.filter(e => e.type === 'rep').length === 3);
const sideCal = done.result;

// 2. front view calibration -> not elbow (noisy), y or scale based
ev = calibrate('front', profile(2.5, [1, 1, 1], 2.4));
done = ev.find(e => e.type === 'done');
check('front view calibrates', !!done, done && JSON.stringify({ s: done.result.signal, q: done.result.quality, score: done.result.score, alt: done.result.alternatives }));
check('front view avoids noisy elbow', done && done.result.signal !== 'elbow');
const frontCal = done.result;

// 3. no movement -> fails with motion reason
ev = calibrate('still', profile(2.5, [], 1));
check('no movement fails', ev.some(e => e.type === 'fail' && e.reason === 'motion'), JSON.stringify(ev.filter(e => e.type !== 'rep')));

// 4. never visible -> hold failure
{ const c = new Calibrator(); let out = []; for (let t = 0; t < 27000; t += 33) out = out.concat(c.push(t, Object.fromEntries(KEYS.map(k => [k, null]))));
  check('never visible fails on hold', out.some(e => e.type === 'fail' && e.reason === 'hold')); }

// 5. counting: 12 full reps + 2 partial reps + a dropout, side cal
function runCount(cal, view, reps, opts = {}) {
  const rc = new RepCounter(cal, { depth: 0.7 });
  const prof = profile(1.5, reps, opts.repS || 1.6);
  const evs = [];
  prof.forEach((f, i) => {
    let vals = views[view](f.d);
    if (opts.shift) for (const k of ['chest', 'head', 'shoulderY', 'headY']) if (vals[k] != null) vals[k] += opts.shift;
    let v = vals[cal.signal];
    if (opts.dropout && i > 120 && i < 160) v = null;
    rc.push(f.t, v).forEach(e => evs.push(e));
  });
  return { rc, evs };
}
const seq = [1, 1, 1, 0.5, 1, 1, 1, 1, 0.45, 1, 1, 1, 0.95, 1];
let r = runCount(sideCal, 'side', seq, { dropout: true });
check('side counts 12 full reps', r.rc.reps === 12, 'got ' + r.rc.reps);
check('side flags 2 partial reps', r.evs.filter(e => e === 'partial').length === 2, 'got ' + r.evs.filter(e => e === 'partial').length);
check('side arms once', r.evs.filter(e => e === 'armed').length === 1);
check('dropout reported lost/found', r.evs.includes('lost') && r.evs.includes('found'));

// 6. front cal, phone nudged a bit (shift) next day -> rebaseline keeps counting right
r = runCount(frontCal, 'front', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], { shift: 0.025 });
check('front counts 10 with phone shifted', r.rc.reps === 10, 'got ' + r.rc.reps + ' signal ' + frontCal.signal);

// 7. fast reps (0.9 s each)
r = runCount(sideCal, 'side', Array(20).fill(1), { repS: 0.9 });
check('fast reps all counted', r.rc.reps === 20, 'got ' + r.rc.reps);

// 8. holding still at top produces no reps
{ const rc = new RepCounter(sideCal, { depth: 0.7 }); for (let t = 0; t < 20000; t += 33) rc.push(t, views.side(0).elbow);
  check('noise at the top never counts', rc.reps === 0); }

process.exit(fail ? 1 : 0);
