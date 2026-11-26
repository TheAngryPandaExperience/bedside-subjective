// Made-up patients only. The day's roster from the computer's roster folder; the room in brackets; the order of the list (APP-11-26F).
const { chromium, devices } = require('playwright');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL', m); } };
const U = 'http://127.0.0.1:8770/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  await ctx.addInitScript(() => { Math.random = () => 0; });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(U + 'index.html'); await page.waitForSelector('[data-act="add-building"]');
  await page.click('[data-act="add-building"]'); await page.fill('#new-building', 'Roster Hall'); await page.click('[data-act="save-building"]'); await page.waitForTimeout(400);
  await page.evaluate(async () => { const s = await import('./js/store.js'); const st = await s.getSettings(); await s.saveSettings({ ...st, receiverToken: 'tok' }); });
  await page.reload(); await page.waitForSelector('[data-act="add-pt"]');
  const setDate = async (d) => { await page.fill('#date', d); await page.dispatchEvent('#date', 'change'); await page.waitForTimeout(300); };
  const file = process.env.BEDSIDE_OUT + '/_Daily Rosters/Roster Hall/Roster RH 11_26_26.txt';
  const before = fs.readFileSync(file, 'utf8');
  // a date with no roster
  await setDate('2026-11-27');
  await page.click('[data-act="import"][data-kind="roster"]'); await page.waitForSelector('#rosterbox'); await page.waitForTimeout(900);
  const none = (await page.textContent('#rosterbox')).replace(/\s+/g, ' ');
  ok(none.includes('No roster for Roster Hall') && none.includes('no roster for 2026-11-27') && none.includes('Roster RH 11_26_26.txt') && !(await page.$('[data-act="roster-load"]')), 'a day with no roster says so and names what is in the folder: ' + none.slice(0, 170));
  ok(await page.isVisible('#photo') === false && !!(await page.$('#file')), 'Choose file and Take photo are still there as before');
  await page.goBack(); await page.waitForSelector('[data-act="add-pt"]');
  // the day that has one
  await setDate('2026-11-26');
  await page.click('[data-act="import"][data-kind="roster"]'); await page.waitForSelector('[data-act="roster-load"]');
  const box = (await page.textContent('#rosterbox')).replace(/\s+/g, ' ');
  ok(box.includes('Roster RH 11_26_26.txt') && box.includes('5 patients') && box.includes('pulled'), 'Load patients shows the roster found in the folder: ' + box.slice(0, 150));
  await page.click('[data-act="roster-load"]'); await page.waitForSelector('.review-row');
  const rows = await page.$$eval('.review-row', (els) => els.map((e) => [e.querySelector('.last').value, e.querySelector('.first').value, e.querySelector('.mrn').value, e.querySelector('.room').value, e.querySelector('input[type=checkbox]').checked].join('|')));
  ok(JSON.stringify(rows) === JSON.stringify(['Mouse|Mickey|7961|Pod B 210 - 1|true', 'Duck|Daisy|8104|Pod A 203 - 2|true', 'Flintstone|Fred|8101|Pod A 202 - 1|true', 'Jetson|Jane|8080||true', 'Boop|Betty|8096|Pod A 202 - 2|true']),
    'the review lists name, MRN and room exactly as in the file, all ticked: ' + JSON.stringify(rows));
  await page.locator('.review-row').nth(3).locator('.room').fill('Pod C 301 - 1');
  await page.locator('.review-row').nth(4).locator('input[type=checkbox]').uncheck();
  await page.click('[data-act="add-roster"]'); await page.waitForSelector('[data-act="open"]');
  const labels = () => page.$$eval('.pt-btn .name', (els) => els.map((e) => e.textContent.trim()));
  let l = await labels();
  ok(JSON.stringify(l) === JSON.stringify(['1. [210-1] Mouse, Mickey (7961):', '2. [203-2] Duck, Daisy (8104):', '3. [202-1] Flintstone, Fred (8101):', '4. [301-1] Jetson, Jane (8080):']),
    'the list: number, room in brackets, last name, first name, (MRN) and colon - the unticked patient is left out, the typed room is used: ' + JSON.stringify(l));
  ok((await page.$$eval('.pt-btn .meta', (els) => els.map((e) => e.textContent.trim()))).join('|').includes('Pod B'), 'the unit shows under the name');
  await page.click('[data-act="sort"][data-by="room"]'); await page.waitForTimeout(300);
  l = await labels();
  ok(l.map((x) => x.split(' ')[1]).join(' ') === '[202-1] [203-2] [210-1] [301-1]' && l[0].startsWith('1. [202-1] Flintstone'), 'Order: Room - by room, and the numbers follow: ' + l.join(' / '));
  await page.click('[data-act="sort"][data-by="name"]'); await page.waitForTimeout(300);
  l = await labels();
  ok(l.map((x) => x.split(' ')[2]).join(' ') === 'Duck, Flintstone, Jetson, Mouse,', 'Order: Last name: ' + l.join(' / '));
  await page.click('[data-act="sort"][data-by="unit"]'); await page.waitForTimeout(300);
  l = await labels();
  ok(l.map((x) => x.split(' ')[1]).join(' ') === '[202-1] [203-2] [210-1] [301-1]' && (await page.$eval('[data-act="sort"][data-by="unit"]', (e) => e.classList.contains('on'))), 'Order: Unit (Pod A, Pod B, Pod C), and the button stays lit');
  // a patient added by hand lands in order
  await page.click('[data-act="add-pt"]'); await page.fill('#ap-last', 'Rubble'); await page.fill('#ap-first', 'Barney'); await page.fill('#ap-mrn', '8105'); await page.fill('#ap-room', 'Pod A 201 - 1');
  await page.click('[data-act="add-pt-save"]'); await page.waitForTimeout(400);
  l = await labels();
  ok(l[0] === '1. [201-1] Rubble, Barney (8105):' && l.length === 5, 'a patient added by hand goes into the same order: ' + l[0]);
  // loading the roster again skips who is already there
  await page.click('[data-act="import"][data-kind="roster"]'); await page.waitForSelector('[data-act="roster-load"]');
  await page.click('[data-act="roster-load"]'); await page.waitForSelector('.review-row');
  await page.click('[data-act="add-roster"]'); await page.waitForSelector('[data-act="open"]');
  l = await labels();
  ok(l.length === 6 && l.filter((x) => x.includes('Mouse')).length === 1 && l.some((x) => x.includes('[202-2] Boop')), 'loading the roster again adds only who is missing (Boop), nobody twice');
  // the patient screen and the sent file
  await page.locator('[data-act="open"]').nth(0).click(); await page.waitForSelector('[data-act="loc"]');
  ok((await page.textContent('h1.mono')).trim() === '1. [201-1] Rubble, Barney (8105):', 'the patient screen shows the same label');
  await page.click('[data-act="loc"]'); await page.click('[data-act="pain-pick"][data-v="2"]'); await page.click('button.primary[data-act="pain"]'); await page.waitForSelector('#note');
  await page.goBack(); await page.waitForSelector('[data-act="send"]');
  const sent = await page.evaluate(async () => {
    const n = await import('./js/note.js'); const s = await import('./js/store.js');
    const b = (await s.getSettings()).currentBuilding; const day = await s.getDay('2026-11-26', b);
    return n.summaryLines({ ...day, building: 'Roster Hall' });
  });
  ok(sent.some((x) => /^RUBBLE, BARNEY \(8105\): /.test(x)) && !sent.some((x) => x.includes('[')), 'the file sent to the computer has no room bracket: ' + JSON.stringify(sent.find((x) => /RUBBLE/.test(x)).slice(0, 40)));
  // a change of plans: only the patients with no note go
  await page.click('[data-act="del-day"]'); await page.waitForSelector('[data-act="del-day-empty"]');
  ok((await page.textContent('[data-act="del-day-empty"]')).includes('5 with no note'), 'Delete this day also offers "Only remove the 5 with no note"');
  await page.click('[data-act="del-day-empty"]'); await page.waitForTimeout(400);
  l = await labels();
  ok(l.length === 1 && l[0].includes('Rubble'), 'that leaves the one patient with a note');
  // the roster stays on the phone when the computer cannot be reached
  await page.route('**/api/roster**', (r) => r.abort());
  await page.click('[data-act="import"][data-kind="roster"]'); await page.waitForSelector('[data-act="roster-load"]'); await page.waitForTimeout(5500);
  const off = (await page.textContent('#rosterbox')).replace(/\s+/g, ' ');
  ok(off.includes('Using the copy on this phone') && await page.isEnabled('[data-act="roster-load"]'), 'with the computer unreachable the roster already pulled can still be loaded');
  ok(fs.readFileSync(file, 'utf8') === before, 'the roster file on the computer is exactly as it was');
  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`ui 11-26F: ${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
