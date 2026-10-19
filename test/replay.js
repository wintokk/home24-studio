// Replay a tracking file shared from the app (Settings → Tracking data → Share) through the current
// counter. Usage: node test/replay.js anyfield-tracking-YYYY-MM-DD-HHMM.json [--frames]
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
new Function(html.split('/* LOGIC-START */')[1].split('/* LOGIC-END */')[0])();
const { RepCounter } = globalThis.PushLogic;
const trace = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const showFrames = process.argv.includes('--frames');
const rc = new RepCounter(trace.setup, { depth: trace.depth });
const reps = [];
for (const fr of trace.frames) {
  const [t, v, , , , recorded] = fr;
  const ev = rc.push(t, v);
  if (ev.includes('rep')) reps.push(t);
  if (showFrames || ev.length || recorded) console.log([t, v, rc.p == null ? '' : rc.p.toFixed(3), rc.state, rc.reps, 'now:' + ev.join('|'), 'then:' + recorded].join('\t'));
}
const gaps = reps.slice(1).map((t, i) => t - reps[i]);
console.log(`\nsignal ${trace.setup.signal}, depth ${trace.depth}, ${trace.frames.length} frames`);
console.log(`counted then: ${trace.reps}, counted by this version: ${rc.reps}`);
console.log(`ms between counts: ${gaps.join(', ')}`);
