// Made-up patients only. "Make patient list" under the loaded patients: make it, copy it, save it as a Word file (APP-11-27A).
const { chromium, devices } = require('playwright');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL', m); } };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Galaxy S9+'], serviceWorkers: 'block', acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8765/index.html'); await page.waitForSelector('[data-act="add-building"]');
  ok(!(await page.$('[data-act="ptlist-make"]')), 'no patients yet: no button');
  await page.click('[data-act="add-building"]'); await page.fill('#new-building', 'Test Hall'); await page.click('[data-act="save-building"]'); await page.waitForTimeout(400);
  await page.fill('#date', '2026-11-27'); await page.dispatchEvent('#date', 'change'); await page.waitForTimeout(300);
  const addPt = async (l, f, m, r) => { await page.click('[data-act="add-pt"]'); await page.fill('#ap-last', l); await page.fill('#ap-first', f); await page.fill('#ap-mrn', m); await page.fill('#ap-room', r); await page.click('[data-act="add-pt-save"]'); await page.waitForTimeout(300); };
  await addPt('Mouse', 'Mickey', '7961', 'Pod A 202 - 1');
  await addPt('Duck', 'Donald', '1111', '1 103 - A');
  await addPt('Dog', 'Pluto', '7963', '');
  const shown = await page.$$eval('.pt-btn .name', (els) => els.map((e) => e.textContent.trim()));
  // the button sits under the patients and above "Delete this day"
  const pos = await page.evaluate(() => { const y = (s) => document.querySelector(s).getBoundingClientRect().top; return [y('.patients .pt-btn:last-child'), y('[data-act="ptlist-make"]'), y('[data-act="del-day"]')]; });
  ok(pos[0] < pos[1] && pos[1] < pos[2], 'the "Make patient list" button is under the last patient and above "Delete this day"');
  ok(!(await page.$('#ptlist-text')), 'nothing is made until the button is tapped');
  await page.click('[data-act="ptlist-make"]'); await page.waitForSelector('#ptlist-text');
  let text = await page.inputValue('#ptlist-text');
  ok(text.split('\n')[0] === 'Test Hall - 11/27/2026 - 3 patients', 'first line: building, date, count');
  ok(JSON.stringify(text.split('\n').slice(1)) === JSON.stringify(shown) && shown.length === 3, 'the lines are exactly the three labels on screen, in the same order');
  ok(await page.isVisible('[data-act="ptlist-copy"]') && await page.isVisible('[data-act="ptlist-docx"]'), 'once made, Copy list and Save Word file are there');
  await page.click('[data-act="ptlist-copy"]'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => navigator.clipboard.readText()) === text, 'Copy list puts exactly that text on the clipboard');
  ok((await page.textContent('#toast')).includes('Patient list copied (3)'), 'and says so');
  // without the room
  await page.click('[data-act="ptlist-room"][data-v="0"]'); await page.waitForTimeout(200);
  text = await page.inputValue('#ptlist-text');
  ok(text.split('\n')[1] === '1. Mouse, Mickey (7961):' && !text.includes('['), '"Without room" takes the bracket off every line');
  await page.click('[data-act="ptlist-copy"]'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => navigator.clipboard.readText()) === text, 'Copy follows the choice');
  await page.click('[data-act="ptlist-room"][data-v="1"]'); await page.waitForTimeout(200);
  // the Word file
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="ptlist-docx"]')]);
  const raw = fs.readFileSync(await dl.path());
  ok(dl.suggestedFilename() === 'Patient list Test Hall 2026-11-27.docx', 'the Word file is named for the building and date');
  ok(raw[0] === 0x50 && raw[1] === 0x4b && raw.includes('[202-1] Mouse, Mickey (7961):') && raw.includes('[ ] Dog, Pluto (7963):') && raw.includes('3 patients'), 'and holds the same lines');
  // the list follows the order on screen
  await page.click('[data-act="sort"][data-by="name"]'); await page.waitForTimeout(400);
  ok(await page.isVisible('#ptlist-text'), 'the list stays open when the order changes');
  text = await page.inputValue('#ptlist-text');
  ok(text.split('\n').slice(1).join('|') === '1. [ ] Dog, Pluto (7963):|2. [103-A] Duck, Donald (1111):|3. [202-1] Mouse, Mickey (7961):', 'and follows the new order, with the numbers');
  await page.click('[data-act="ptlist-close"]'); await page.waitForTimeout(200);
  ok(!(await page.$('#ptlist-text')) && await page.isVisible('[data-act="ptlist-make"]'), 'Close puts the button back');
  // no clipboard permission: the text is selected instead
  await ctx.clearPermissions();
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
  await page.click('[data-act="ptlist-make"]'); await page.waitForSelector('#ptlist-text');
  await page.click('[data-act="ptlist-copy"]'); await page.waitForTimeout(300);
  const sel = await page.evaluate(() => { const t = document.getElementById('ptlist-text'); return [document.activeElement === t, t.selectionStart, t.selectionEnd, t.value.length]; });
  ok(sel[0] && sel[1] === 0 && sel[2] === sel[3] && (await page.textContent('#toast')).includes('press and hold'), 'when the phone refuses to copy, the whole list is selected and the message says what to do');
  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
