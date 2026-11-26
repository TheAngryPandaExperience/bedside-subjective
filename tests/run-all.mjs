// Runs every test of the Bedside app: node tests/run-all.mjs     (made-up patients only; nothing leaves this computer)
//   1. structure   - one version number, offline file list, files in the right folders
//   2. logic       - the sentences the app writes (tests/logic, tests/parsers.test.js)
//   3. receiver    - the computer side (tests/receiver, Python)
//   4. ui          - the real app driven in a phone-sized browser (tests/ui, needs "npx playwright install chromium")
// Options: --no-ui skips part 4.  One or more words after the command run only the files whose name has that word.
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const noUi = args.includes('--no-ui');
const only = args.filter((a) => !a.startsWith('--'));
const want = (f) => !only.length || only.some((w) => f.includes(w));
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const results = [];

function run(label, cmd, cmdArgs, env = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 300000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const good = r.status === 0;
  const last = out.trim().split('\n').filter(Boolean).pop() || '';
  results.push({ label, good, last });
  console.log(`${good ? 'ok  ' : 'FAIL'} ${label}  ${last.slice(0, 90)}`);
  if (!good) console.log(out.split('\n').filter((l) => l.trim() && !l.startsWith('PASS')).slice(-14).map((l) => `       ${l.slice(0, 260)}`).join('\n'));
  else for (const l of out.split('\n').filter((x) => x.startsWith('WARN'))) console.log(`       ${l.slice(0, 400)}`);
}

const portOpen = (port) => new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
async function waitPort(port) { for (let i = 0; i < 60; i++) { if (await portOpen(port)) return true; await new Promise((r) => setTimeout(r, 250)); } return false; }

run('structure', process.execPath, ['tests/check-structure.mjs']);
for (const f of readdirSync(path.join(ROOT, 'tests/logic')).filter((x) => x.endsWith('.mjs') && want(x)).sort()) run(`logic/${f}`, process.execPath, [`tests/logic/${f}`]);
if (want('parsers')) run('parsers.test.js', process.execPath, ['--test', 'tests/parsers.test.js']);
for (const f of readdirSync(path.join(ROOT, 'tests/receiver')).filter((x) => x.endsWith('.py') && want(x)).sort()) run(`receiver/${f}`, PY, [`tests/receiver/${f}`]);

if (!noUi) {
  const out = mkdtempSync(path.join(tmpdir(), 'bedside-'));
  const web = spawn(process.execPath, ['tests/ui/serve_app.mjs'], { cwd: ROOT, stdio: 'ignore' });   // the app's files on 127.0.0.1:8765
  const rcv = spawn(PY, ['tests/ui/serve_receiver.py'], { cwd: ROOT, env: { ...process.env, BEDSIDE_OUT: out }, stdio: 'ignore' });
  try {
    if (!(await waitPort(8765)) || !(await waitPort(8770))) { results.push({ label: 'ui servers', good: false, last: 'could not start' }); console.log('FAIL ui servers did not start (is Python installed?)'); }
    else for (const f of readdirSync(path.join(ROOT, 'tests/ui')).filter((x) => x.endsWith('.cjs') && want(x)).sort()) run(`ui/${f}`, process.execPath, [`tests/ui/${f}`], { BEDSIDE_OUT: out });
  } finally {
    rcv.kill(); web.kill();
    try { rmSync(out, { recursive: true, force: true }); } catch { /* left behind in the temp folder */ }
  }
}
const bad = results.filter((r) => !r.good);
console.log(`\n${results.length - bad.length} of ${results.length} test files passed${bad.length ? ` - FAILED: ${bad.map((b) => b.label).join(', ')}` : ''}`);
process.exit(bad.length ? 1 : 0);
