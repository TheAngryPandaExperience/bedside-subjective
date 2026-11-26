// Release checks that need no browser: one version number, every offline file present, nothing in the wrong folder.
// Run by tests/run-all.mjs. STRICT=1 turns the stray-file warnings into failures.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0, warn = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

const ver = read('app/js/version.js').match(/self\.BEDSIDE_VERSION = (\d+);/);
ok(!!ver, 'app/js/version.js sets self.BEDSIDE_VERSION to a whole number');
const sw = read('app/sw.js');
const appjs = read('app/js/app.js');
ok(/importScripts\('js\/version\.js'\)/.test(sw) && !/VERSION = 'v\d+'/.test(sw), 'app/sw.js takes its version from js/version.js and has no number of its own');
ok(/import '\.\/version\.js'/.test(appjs) && !/APP_VERSION = \d+/.test(appjs), 'app/js/app.js takes its version from js/version.js and has no number of its own');
const shell = [...sw.matchAll(/'([^']+\.(?:js|css|html|svg|png|webmanifest))'/g)].map((m) => m[1]).filter((f) => !f.includes('${'));
const missing = shell.filter((f) => !existsSync(path.join(ROOT, 'app', f)));
ok(shell.length >= 10 && missing.length === 0, `every file the offline copy lists is in app/ (${missing.join(', ') || 'all there'})`);
const jsFiles = readdirSync(path.join(ROOT, 'app/js')).filter((f) => f.endsWith('.js') && f !== 'sw.js');
const unlisted = jsFiles.filter((f) => !shell.includes(`js/${f}`));
ok(unlisted.length === 0, `every script in app/js is in the offline list of sw.js (${unlisted.join(', ') || 'all listed'})`);

// Files that belong somewhere else. They do no harm to the app, but they are how a wrong upload hides.
const WHERE = { 'app/js': /\.js$/, 'app/css': /\.css$/, app: /^(index\.html|sw\.js|manifest\.webmanifest)$/ };
const strays = [];
for (const [dir, rule] of Object.entries(WHERE)) {
  for (const f of readdirSync(path.join(ROOT, dir))) {
    if (statSync(path.join(ROOT, dir, f)).isDirectory()) continue;
    if (!rule.test(f) || (dir === 'app/js' && f === 'sw.js')) strays.push(`${dir}/${f}`);
  }
}
const TOP_OK = new Set(['README.md', 'package.json', 'package-lock.json', '.gitignore', 'RELEASING.md']);
for (const f of readdirSync(ROOT)) {
  if (statSync(path.join(ROOT, f)).isDirectory() || TOP_OK.has(f)) continue;
  strays.push(f);
}
if (strays.length) {
  if (process.env.STRICT) ok(false, `files in the wrong folder: ${strays.join(', ')}`);
  else { warn = strays.length; console.log(`WARN ${strays.length} file(s) in the wrong folder (delete them on GitHub): ${strays.join(', ')}`); }
} else ok(true, 'no file is in the wrong folder');
console.log(`structure (version ${ver ? ver[1] : '?'}): ${pass} passed, ${fail} failed${warn ? `, ${warn} warnings` : ''}`);
process.exit(fail ? 1 : 0);
