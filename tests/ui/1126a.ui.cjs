// Made-up patients only. Load patients: rows are checked against the chart; doubtful rows start unticked (APP-11-26A).
const { chromium, devices } = require('playwright');
const path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL', m); } };
const chart = { kind: 'phone-chart', made: '11/25/2026 07:12', patients: [
  { name: 'DUCK, DONALD', mrn: '8094', dx: [], meds: [] }, { name: 'JETSON, JANE M', mrn: '8080', dx: [], meds: [] },
  { name: 'FLINTSTONE, WILMA', mrn: '8101', dx: [], meds: [] }, { name: 'BOOP, BETTY', mrn: '8098', dx: [], meds: [] }] };
const LIST = ['DUCK, DONALD (8094) Pod A 202 - 1 1/2/2026 8094', 'JETSON, JANE (8080) Pod C 1/1/2026 8086', 'BOOP, BETTY (8096) Pod B 1/1/2026 8096',
  'FLINTSTONE, FRED (8101) Pod C 1/1/2026 8101', 'SLATE, SAM (8110) Pod D 1/1/2026 8110'].join('\n');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  let have = false;
  await page.route('**/api/chart**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(have ? { ok: true, found: true, chart, modified: 'x' } : { ok: true, found: false, why: 'no phone chart yet' }) }));
  await page.goto('http://127.0.0.1:8770/index.html'); await page.waitForSelector('[data-act="add-building"]');
  await page.click('[data-act="add-building"]'); await page.fill('#new-building', 'Quarry'); await page.click('[data-act="save-building"]'); await page.waitForTimeout(400);
  const read = async () => { await page.click('[data-act="import"][data-kind="roster"]'); await page.waitForSelector('#raw'); await page.fill('#raw', LIST); await page.click('[data-act="parse"]'); await page.waitForSelector('.review-row'); };
  const rows = () => page.$$eval('.review-row', (els) => els.map((e) => ({ last: e.querySelector('.last').value, mrn: e.querySelector('.mrn').value, on: e.querySelector('input[type=checkbox]').checked, text: e.textContent.replace(/\s+/g, ' ').trim() })));
  // no chart on the phone
  await read();
  let r = await rows();
  ok(!!(await page.$('#nochart')) && r.length === 5, 'with no chart on the phone the screen says the names and MRNs could not be checked');
  ok(r.find((x) => x.last === 'Jetson').on === false && r.find((x) => x.last === 'Jetson').text.includes('MRN read as 8080 and 8086') && r.filter((x) => x.on).length === 4, 'a row whose two MRN readings differ starts unticked; clean rows are ticked');
  await page.goBack(); await page.waitForSelector('[data-act="charts-all"]');
  have = true;
  await page.click('[data-act="charts-all"]'); await page.waitForTimeout(700);
  await read();
  r = await rows();
  const by = (last) => r.find((x) => x.last === last);
  ok(!(await page.$('#nochart')) && (await page.textContent('#result h2')).includes('2 confirmed by the chart') && (await page.textContent('#result h2')).includes('2 to check'), 'heading: ' + (await page.textContent('#result h2')).replace(/\s+/g, ' '));
  ok(by('Duck').on && by('Duck').text.includes('✓ in the chart'), 'name and MRN in the chart: ticked and marked');
  ok(by('Jetson').on && by('Jetson').mrn === '8080' && by('Jetson').text.includes('the chart confirms 8080 (the photo also read 8086)'), 'two readings: the one that is this patient in the chart is used, and the row says so');
  ok(!by('Boop').on && by('Boop').mrn === '8096' && by('Boop').text.includes('the chart has MRN 8098 for BOOP, BETTY; this list reads 8096'), 'name in the chart with another MRN: unticked, MRN left as read');
  ok(!by('Flintstone').on && by('Flintstone').text.includes('MRN 8101 is FLINTSTONE, WILMA in the chart'), 'MRN in the chart under another name: unticked');
  ok(by('Slate').on && by('Slate').text.includes('not in the chart (a new patient?)'), 'pasted text, clean row, not in the chart: ticked, with a note');
  ok(!!(await page.$('#tickhint')), 'the screen explains that rows to check start unticked');
  await page.screenshot({ path: require('os').tmpdir() + '/shot_roster.png', fullPage: true });
  await page.click('[data-act="add-roster"]'); await page.waitForSelector('[data-act="open"]');
  const names = await page.$$eval('[data-act="open"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  ok(names.length === 3 && names.some((n) => n.includes('Duck')) && names.some((n) => n.includes('Jetson')) && names.some((n) => n.includes('Slate')) && !names.some((n) => /Boop|Flintstone/.test(n)), 'only the ticked rows are added: ' + names.length);
  // ticking a doubtful row adds it, with what you typed
  await read();
  const boop = page.locator('.review-row', { has: page.locator('.last[value="Boop"]') });
  await boop.locator('.mrn').fill('8098'); await boop.locator('input[type=checkbox]').check();
  await page.click('[data-act="add-roster"]'); await page.waitForSelector('[data-act="open"]');
  const after = await page.$$eval('[data-act="open"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  ok(after.length === 4 && after.some((n) => n.includes('Boop')), 'a row you fix and tick is added; the others already on the list are skipped');
  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`ui 11-26A: ${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
