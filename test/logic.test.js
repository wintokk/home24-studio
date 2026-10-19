// Tests for the calibration and rep-counting logic in public/index.html (the block between
// LOGIC-START and LOGIC-END). Signals are simulated for a side view and a floor-in-front view.
// Run: node test/logic.test.js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
new Function(html.split('/* LOGIC-START */')[1].split('/* LOGIC-END */')[0])();
const { Calibrator, RepCounter, KEYS } = globalThis.PushLogic;

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const FPS = 30, DT = 1000 / FPS;

// A timeline of frames. d = push-up depth (0 top, 1 bottom); nod = head-only movement; shuffle = whole-body shift.
function timeline() {
  const f = []; let t = 0;
  const api = {
    frames: f,
    hold(sec) { for (let i = 0; i < sec * FPS; i++) f.push({ t: (t += DT), d: 0, nod: 0, shuffle: 0 }); return api; },
    rep(depth = 1, sec = 2, opts = {}) {
      const n = Math.round(sec * FPS);
      for (let i = 0; i < n; i++) {
        let d = depth * Math.sin(Math.PI * i / n) ** 2;
        if (opts.pauseAt != null) { // go down to pauseAt, wait, then finish the rep
          const half = n / 2;
          if (i < half) d = Math.min(d, opts.pauseAt);
        }
        if (opts.bounce && Math.abs(i - n / 2) < n * 0.08) d = depth - opts.bounce * Math.cos(Math.PI * (i - n / 2) / (n * 0.08)) ** 2;
        const fr = { t: (t += DT), d, nod: 0, shuffle: 0 };
        // glitch: for a few frames at the bottom the tracker reports you back at the top
        if (opts.glitch && i >= Math.floor(n / 2) && i < Math.floor(n / 2) + opts.glitch) fr.glitch = opts.glitchTo != null ? opts.glitchTo : 0;
        // miss: tracking lost between these fractions of the rep
        if (opts.miss && i / n >= opts.miss[0] && i / n < opts.miss[1]) fr.miss = true;
        f.push(fr);
        if (opts.pauseAt != null && i === Math.floor(n / 2) - Math.floor(n * 0.15)) for (let k = 0; k < 0.6 * FPS; k++) f.push({ t: (t += DT), d: opts.pauseAt, nod: 0, shuffle: 0 });
      }
      return api.hold(0.4);
    },
    // goes to `turnAt`, comes back up by `back`, then either finishes the rep (deeper) or returns to the top
    dipAndFix(turnAt, back, finishDepth) {
      const seg = (a, b, sec) => { const n = Math.round(sec * FPS); for (let i = 1; i <= n; i++) f.push({ t: (t += DT), d: a + (b - a) * i / n, nod: 0, shuffle: 0 }); };
      seg(0, turnAt, 0.8); seg(turnAt, turnAt - back, 0.35); seg(turnAt - back, finishDepth, 0.6); seg(finishDepth, 0, 0.9);
      return api.hold(0.4);
    },
    // free-form movement through depth waypoints [[depth, seconds], ...], eased between points
    path(points, opts = {}) {
      let from = f.length ? f[f.length - 1].d : 0;
      for (const [to, sec] of points) {
        const n = Math.max(1, Math.round(sec * FPS));
        for (let i = 1; i <= n; i++) {
          let d = from + (to - from) * (1 - Math.cos(Math.PI * i / n)) / 2;
          if (opts.wobble && to < from) d += opts.wobble * Math.sin(2 * Math.PI * 6 * i / FPS);
          f.push({ t: (t += DT), d, nod: 0, shuffle: 0 });
        }
        from = to;
      }
      return api.hold(0.3);
    },
    nod(amount = 1, sec = 0.35) { const n = Math.round(sec * FPS); for (let i = 0; i < n; i++) f.push({ t: (t += DT), d: 0, nod: amount * Math.sin(Math.PI * i / n), shuffle: 0 }); return api; },
    shuffle(amount = 1, sec = 0.45) { const n = Math.round(sec * FPS); for (let i = 0; i < n; i++) f.push({ t: (t += DT), d: 0, nod: 0, shuffle: amount * Math.sin(Math.PI * i / n) }); return api; },
    now() { return t; },
  };
  return api;
}

// Signals as the two placements would see them, with tracking noise.
const views = {
  side: (d, nod, sh) => ({ elbow: 172 - 92 * d + gauss() * 2, chest: 0.11 - 0.08 * d + gauss() * 0.003, head: 0.16 - 0.1 * d - 0.04 * nod + gauss() * 0.004,
                           shoulderY: 0.45 + 0.07 * d + 0.02 * sh + gauss() * 0.003, headY: 0.42 + 0.09 * d + 0.06 * nod + 0.02 * sh + gauss() * 0.004, scale: 0.02 + gauss() * 0.004 }),
  front: (d, nod, sh) => ({ elbow: 160 - 15 * d + gauss() * 9, chest: 0.2 - 0.02 * d + gauss() * 0.006, head: null,
                            shoulderY: 0.40 + 0.11 * d + 0.03 * sh + gauss() * 0.003, headY: 0.30 + 0.14 * d + 0.07 * nod + 0.03 * sh + gauss() * 0.004, scale: 0.26 + 0.05 * d + gauss() * 0.0025 }),
  still: () => ({ elbow: 170 + gauss() * 2, chest: 0.1 + gauss() * 0.003, head: null, shoulderY: 0.45 + gauss() * 0.003, headY: 0.4 + gauss() * 0.003, scale: 0.25 + gauss() * 0.002 }),
};

function calibrate(view, tl) {
  const c = new Calibrator(); const evs = [];
  for (const f of tl.frames) { c.push(f.t, views[view](f.d, f.nod, f.shuffle)).forEach(e => evs.push({ ...e, t: f.t })); if (c.phase === 'done' || c.phase === 'failed') break; }
  let t = tl.now();
  while (c.phase !== 'done' && c.phase !== 'failed') { t += DT; c.push(t, views[view](0, 0, 0)).forEach(e => evs.push({ ...e, t })); }
  return evs;
}
function count(cal, view, tl, opts = {}) {
  const rc = new RepCounter(cal, { depth: 0.7 }); const evs = [];
  tl.frames.forEach((f, i) => {
    const vals = views[view](f.d, f.nod, f.shuffle);
    if (opts.shift) for (const k of ['chest', 'head', 'shoulderY', 'headY']) if (vals[k] != null) vals[k] += opts.shift;
    let v = vals[cal.signal];
    if (f.glitch != null) v = views[view](f.glitch, 0, 0)[cal.signal];
    if (f.miss) v = null;
    if (opts.dropout && i >= opts.dropout[0] && i < opts.dropout[1]) v = null;
    rc.push(f.t, v).forEach(e => evs.push({ e, t: f.t }));
  });
  const n = name => evs.filter(x => x.e === name).length;
  return { rc, evs, n };
}

let fail = 0;
const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fail++; };

// ---------- calibration ----------
let tl = timeline().hold(2.5).rep().rep().rep();
let ev = calibrate('side', tl), done = ev.find(e => e.type === 'done');
check('side view calibrates', !!done, done && JSON.stringify({ s: done.result.signal, q: done.result.quality, score: done.result.score }));
check('side view picks elbow angle', done && done.result.signal === 'elbow');
check('side view announces exactly 3 reps', ev.filter(e => e.type === 'rep').length === 3);
const sideCal = done.result;

tl = timeline().hold(2.5).rep().rep().rep();
ev = calibrate('front', tl); done = ev.find(e => e.type === 'done');
check('front view calibrates', !!done, done && JSON.stringify({ s: done.result.signal, q: done.result.quality, alt: done.result.alternatives }));
check('front view tracks shoulders, not the head', done && done.result.signal === 'shoulderY');
const frontCal = done.result;

// Glances at the screen and shuffling into position must not count as reps.
tl = timeline().hold(2.5).nod(1).hold(0.5).shuffle(1).hold(0.4).nod(1).hold(0.6);
const before3rd = () => tl.now();
tl.rep(1, 2.2); tl.nod(1).hold(0.3); tl.rep(1, 2.2); const third = before3rd(); tl.rep(1, 2.2);
ev = calibrate('front', tl); done = ev.find(e => e.type === 'done');
check('nods and shuffles: waits for the 3rd real push-up', done && done.t > third + 1000, done ? `done at ${Math.round(done.t)} ms, 3rd rep starts ${Math.round(third)} ms` : 'no done');
check('nods and shuffles: still picks shoulders', done && done.result.signal === 'shoulderY', done && done.result.signal);
check('nods and shuffles: announces 3 reps, not more', ev.filter(e => e.type === 'rep').length === 3, String(ev.filter(e => e.type === 'rep').length));

// Same in side view, where the head is visible too.
tl = timeline().hold(2.5).nod(1).shuffle(1).hold(0.5).nod(1);
tl.rep(1, 2); tl.rep(1, 2); const third2 = tl.now(); tl.rep(1, 2);
ev = calibrate('side', tl); done = ev.find(e => e.type === 'done');
check('side view with nods: waits for the 3rd push-up', done && done.t > third2 + 900, done ? `done at ${Math.round(done.t)}, 3rd starts ${Math.round(third2)}` : 'no done');

// A signal that dips twice per push-up and looks cleaner than the shoulders (elbow seen from the front
// with a shaky shoulder track) must neither finish calibration early nor become the tracked signal.
views.frontDouble = (d, nod, sh) => ({ ...views.front(d, nod, sh), elbow: 160 - 50 * Math.sin(Math.PI * d) + gauss() * 3,
  shoulderY: 0.40 + 0.11 * d + gauss() * 0.008, headY: 0.30 + 0.14 * d + gauss() * 0.01 });
tl = timeline().hold(2.5).rep(1, 2.2).rep(1, 2.2); const third3 = tl.now(); tl.rep(1, 2.2);
ev = calibrate('frontDouble', tl); done = ev.find(e => e.type === 'done');
check('double-dipping signal: waits for the 3rd push-up', done && done.t > third3 + 1000, done ? `done at ${Math.round(done.t)}, 3rd starts ${Math.round(third3)}` : 'no done');
check('double-dipping signal: not chosen for counting', done && done.result.signal !== 'elbow', done && done.result.signal);
check('double-dipping signal: announces 3 reps', ev.filter(e => e.type === 'rep').length === 3, String(ev.filter(e => e.type === 'rep').length));

tl = timeline().hold(2.5).hold(6);
ev = calibrate('still', tl);
check('no movement fails with a clear reason', ev.some(e => e.type === 'fail' && e.reason === 'motion'));
{ const c = new Calibrator(); let out = []; for (let t = 0; t < 27000; t += 33) out = out.concat(c.push(t, Object.fromEntries(KEYS.map(k => [k, null]))));
  check('never visible fails on the hold step', out.some(e => e.type === 'fail' && e.reason === 'hold')); }

// ---------- counting ----------
tl = timeline().hold(1.5); [1, 1, 1, 0.55, 1, 1, 1, 1, 0.5, 1, 1, 1, 0.95, 1].forEach(dp => tl.rep(dp, 1.6));
let r = count(sideCal, 'side', tl, { dropout: [120, 160] });
check('side: counts 12 full reps out of 14', r.rc.reps === 12, 'got ' + r.rc.reps);
check('side: "lower" cue once per shallow rep', r.n('shallow') === 2, 'got ' + r.n('shallow'));
check('side: "not counted" once per shallow rep', r.n('nocount') === 2, 'got ' + r.n('nocount'));
check('side: tracking dropout reported and recovered', r.n('lost') === 1 && r.n('found') === 1);

for (const [name, cal, view] of [['side', sideCal, 'side'], ['front', frontCal, 'front']]) {
  tl = timeline().hold(1.5); for (let i = 0; i < 15; i++) tl.rep(0.8 + 0.2 * rnd(), 1.2 + 0.8 * rnd());
  r = count(cal, view, tl);
  check(`${name}: 15 full reps of varying depth all count`, r.rc.reps === 15, 'got ' + r.rc.reps);
  check(`${name}: no "lower" cue on full reps`, r.n('shallow') === 0 && r.n('nocount') === 0, `shallow ${r.n('shallow')}, nocount ${r.n('nocount')}`);
}

// Shallow rep: the cue comes while you're still down, then "not counted" at the top.
tl = timeline().hold(1.5).rep(0.55, 1.8);
r = count(sideCal, 'side', tl);
const cueT = (r.evs.find(x => x.e === 'shallow') || {}).t, ncT = (r.evs.find(x => x.e === 'nocount') || {}).t;
check('shallow rep: not counted, one cue, cue before reaching the top', r.rc.reps === 0 && r.n('shallow') === 1 && r.n('nocount') === 1 && cueT < ncT - 300, `cue ${Math.round(cueT)} ms, not-counted ${Math.round(ncT)} ms`);

// Hear "lower", go lower: the rep counts and there's no "not counted".
tl = timeline().hold(1.5).dipAndFix(0.6, 0.15, 1);
r = count(sideCal, 'side', tl);
check('cue then deeper: counts the rep', r.rc.reps === 1 && r.n('nocount') === 0, `reps ${r.rc.reps}, shallow ${r.n('shallow')}, nocount ${r.n('nocount')}`);

// Pausing halfway down is not a shallow rep.
tl = timeline().hold(1.5).path([[0.55, 0.5], [0.55, 0.6], [1, 0.45], [0, 0.9]]).path([[0.6, 0.5], [0.6, 0.6], [1, 0.45], [0, 0.9]]);
r = count(sideCal, 'side', tl);
check('pause halfway then finish: counts, no cue', r.rc.reps === 2 && r.n('shallow') === 0 && r.n('nocount') === 0, `reps ${r.rc.reps}, shallow ${r.n('shallow')}, nocount ${r.n('nocount')}`);

// Bouncing at the bottom is one rep.
tl = timeline().hold(1.5); for (let i = 0; i < 5; i++) tl.rep(1, 1.6, { bounce: 0.3 });
r = count(sideCal, 'side', tl);
check('bounce at the bottom: no double counts', r.rc.reps === 5, 'got ' + r.rc.reps);

// Glancing at the screen between reps, even if the head signal were tracked.
const headCal = { signal: 'headY', up: 0.30, down: 0.44, noise: 0.004 };
tl = timeline().hold(1.5).rep(1, 1.6).nod(1).hold(0.3).nod(1).rep(1, 1.6).nod(1).hold(0.4).rep(1, 1.6);
r = count(headCal, 'front', tl);
check('head tracking: nods are neither reps nor "lower" cues', r.rc.reps === 3 && r.n('shallow') === 0 && r.n('nocount') === 0, `reps ${r.rc.reps}, shallow ${r.n('shallow')}, nocount ${r.n('nocount')}`);

// Tracking glitches at the bottom (face close to a floor-level phone): the tracker briefly reports you
// back at the top, then recovers. Each push-up must still count once.
for (const [name, cal, view] of [['side', sideCal, 'side'], ['front', frontCal, 'front']]) {
  for (const g of [1, 3, 6]) {
    tl = timeline().hold(1.5); for (let i = 0; i < 8; i++) tl.rep(1, 1.8, i % 2 ? { glitch: g } : {});
    r = count(cal, view, tl);
    check(`${name}: ${g}-frame glitch at the bottom of every other rep: no double counts`, r.rc.reps === 8, 'got ' + r.rc.reps);
  }
  tl = timeline().hold(1.5); for (let i = 0; i < 6; i++) tl.rep(1, 1.8, { glitch: 3, glitchTo: 0.15 });
  r = count(cal, view, tl);
  check(`${name}: glitch to almost the top on every rep: no double counts`, r.rc.reps === 6, 'got ' + r.rc.reps);
}

// Going deeper than in calibration, then a sag on the way up before reaching the top: one rep each.
for (const [name, cal, view] of [['side', sideCal, 'side'], ['front', frontCal, 'front']]) {
  tl = timeline().hold(1.5); for (let i = 0; i < 6; i++) tl.path([[1.7, 0.9], [0.22, 0.7], [0.8, 0.45], [0, 0.6]]);
  r = count(cal, view, tl);
  check(`${name}: deep reps with a sag on the way up: one count each`, r.rc.reps === 6, 'got ' + r.rc.reps);
  tl = timeline().hold(1.5); for (let i = 0; i < 6; i++) tl.path([[1.5, 0.9], [0, 1.1]], { wobble: 0.18 });
  r = count(cal, view, tl);
  check(`${name}: shaky way up: one count each`, r.rc.reps === 6, 'got ' + r.rc.reps);
  tl = timeline().hold(1.5); [1.6, 1.6, 1.6, 0.9, 0.85, 1, 1].forEach(dp => tl.rep(dp, 1.6));
  r = count(cal, view, tl);
  check(`${name}: deep reps then normal-depth reps: all count`, r.rc.reps === 7, 'got ' + r.rc.reps);
}

// Tracking lost partway down and back only once you're on the way up: still one rep, and no "lower".
tl = timeline().hold(1.5); for (let i = 0; i < 5; i++) tl.rep(1, 1.8, { miss: [0.3, 0.8] });
r = count(sideCal, 'side', tl);
check('lost partway down, back on the way up: counts every rep, no cue', r.rc.reps === 5 && r.n('shallow') === 0 && r.n('nocount') === 0, `reps ${r.rc.reps}, shallow ${r.n('shallow')}, nocount ${r.n('nocount')}`);

tl = timeline().hold(1.5); for (let i = 0; i < 10; i++) tl.rep(1, 1.6);
r = count(frontCal, 'front', tl, { shift: 0.025 });
check('front: phone moved a little since calibration, still counts 10', r.rc.reps === 10, 'got ' + r.rc.reps);

tl = timeline().hold(1.5); for (let i = 0; i < 20; i++) tl.rep(1, 0.9);
r = count(sideCal, 'side', tl);
check('fast reps (0.9 s) all counted', r.rc.reps === 20, 'got ' + r.rc.reps);

// Randomized sets (fixed seed): deep and shallow-ish reps at varied speeds, with glitches, sags,
// wobble on the way up and tracking dropouts mixed in. Over-counting is the failure that matters most.
{
  const sets = 150; let over = 0, under = 0, total = 0;
  for (const [cal, view] of [[sideCal, 'side'], [frontCal, 'front']]) for (let s = 0; s < sets; s++) {
    tl = timeline().hold(1.5); let truth = 0;
    for (let r = 0; r < 10; r++) {
      const depth = 0.8 + rnd() * 1.0, sec = 0.9 + rnd() * 1.6, o = {};
      if (rnd() < 0.4) { o.glitch = 1 + Math.floor(rnd() * 6); o.glitchTo = rnd() * 0.2; }
      if (rnd() < 0.15) o.miss = [0.3 + rnd() * 0.2, 0.55 + rnd() * 0.2];
      if (rnd() < 0.3) tl.path([[depth, sec / 2], [0.22, sec * 0.35], [0.22 + 0.4 * rnd(), 0.3], [0, 0.4]]);
      else tl.rep(depth, sec, o);
      truth++;
    }
    r = count(cal, view, tl); total += truth;
    if (r.rc.reps > truth) over += r.rc.reps - truth; else under += truth - r.rc.reps;
  }
  check(`randomized disturbed sets: no extra counts in ${total} reps`, over === 0, `extra ${over}, missed ${under}`);
  check(`randomized disturbed sets: misses under 1%`, under < total * 0.01, `missed ${under} of ${total}`);
}

{ const rc = new RepCounter(sideCal, { depth: 0.7 }); let cues = 0;
  for (let t = 0; t < 20000; t += 33) cues += rc.push(t, views.side(0, 0, 0).elbow).filter(e => e !== 'armed').length;
  check('holding still at the top: no reps, no cues', rc.reps === 0 && cues === 0); }

process.exit(fail ? 1 : 0);
