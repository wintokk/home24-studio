// Download count logs that signed-in users' phones backed up (users/{uid}/countlog/{start}) and write
// them as one file that test/replay.js reads. Needs project-owner credentials; run in Cloud Shell:
//   node scripts/pull-countlog.js [email-or-uid] > countlog.json && node test/replay.js countlog.json
const { execSync } = require('child_process');
const zlib = require('zlib');

const PROJECT = 'home24-studio';
const who = process.argv[2] || '';
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT };

async function uidFor(s) {
  if (!s.includes('@')) return s;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, { method: 'POST', headers: H, body: JSON.stringify({ email: [s] }) });
  const j = await r.json();
  if (!j.users || !j.users.length) throw new Error('no user with email ' + s);
  return j.users[0].localId;
}

(async () => {
  const uid = who ? await uidFor(who) : null;
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
  const r = await fetch(`${base}${uid ? '/users/' + uid : ''}:runQuery`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'countlog', allDescendants: !uid }] } }),
  });
  const rows = await r.json();
  if (!Array.isArray(rows)) throw new Error(JSON.stringify(rows));
  const sets = rows.filter((x) => x.document).map((x) => {
    const f = x.document.fields, tr = JSON.parse(zlib.gunzipSync(Buffer.from(f.gz.bytesValue, 'base64')).toString('utf8'));
    tr.uid = x.document.name.split('/users/')[1].split('/')[0];
    return tr;
  }).sort((a, b) => a.start - b.start);
  process.stderr.write(`${sets.length} sets\n`);
  process.stdout.write(JSON.stringify({ app: 'anyfield', format: 2, sets }));
})().catch((e) => { console.error(e.message || e); process.exit(1); });
