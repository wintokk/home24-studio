// Replay tracking data from the app through the current counter.
//   node test/replay.js anyfield-countlog-….json            every set in a count log (Settings → Count log → Share)
//   node test/replay.js anyfield-countlog-….json --set 3    one set, with every frame where something happened
//   add --frames to print every frame
// For each set it prints what the app counted, what you saved (the truth, when you fixed the count),
// and what this version counts. Exit code 1 if this version disagrees with a saved count.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
new Function(html.split('/* LOGIC-START */')[1].split('/* LOGIC-END */')[0])();
const { RepCounter } = globalThis.PushLogic;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
if (!file) { console.error('usage: node test/replay.js <file.json> [--set N] [--frames]'); process.exit(2); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const sets = Array.isArray(data.sets) ? data.sets : [data];          // format 2 log, or one set (format 1)
const showFrames = args.includes('--frames');
const pick = args.includes('--set') ? +args[args.indexOf('--set') + 1] : null;

function replay(tr, verbose) {
  const rc = new RepCounter(tr.setup, { depth: tr.depth });
  const reps = [];
  for (const fr of tr.frames) {
    const [t, v, , , , recorded] = fr;
    const ev = rc.push(t, v);
    if (ev.includes('rep')) reps.push(t);
    if (verbose && (showFrames || ev.length || recorded)) {
      const vt = tr.videoAt != null ? ((t - tr.videoAt) / 1000).toFixed(2) + 's' : '';
      console.log([t, vt, v, rc.p == null ? '' : rc.p.toFixed(3), rc.state, rc.reps, 'now:' + ev.join('|'), 'then:' + recorded].join('\t'));
    }
  }
  return { now: rc.reps, gaps: reps.slice(1).map((t, i) => t - reps[i]) };
}

const fmt = (ms) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
let wrong = 0;
sets.forEach((tr, i) => {
  if (pick != null && i + 1 !== pick) return;
  const verbose = pick != null || sets.length === 1;
  if (verbose) console.log('t_ms\tvideo\tsignal\tprogress\tstate\treps\tevents now\tevents then');
  const r = replay(tr, verbose);
  const counted = tr.counted != null ? tr.counted : tr.reps;
  const truth = tr.status === 'saved' && tr.saved != null ? tr.saved : null;
  const bad = truth != null && r.now !== truth;
  if (bad) wrong++;
  const label = truth == null ? (tr.status || 'unlabelled') : truth === counted ? 'saved as counted' : `saved ${truth} (${counted > truth ? counted - truth + ' extra' : truth - counted + ' missed'})`;
  console.log(`#${i + 1}  ${fmt(tr.start)}  ${tr.setup.signal}  counted ${counted}, ${label}, this version ${r.now}${bad ? '  <-- differs from saved' : ''}`);
  if (verbose) console.log(`ms between counts: ${r.gaps.join(', ')}`);
});
if (sets.length > 1) console.log(`\n${sets.length} sets, ${wrong} where this version disagrees with the saved count`);
process.exit(wrong ? 1 : 0);
