// Made-up patients only. Long-standing settings carried to the next day and confirmed there (APP-11-26D).
const { chromium, devices } = require('playwright');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL', m); } };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  await ctx.addInitScript(() => { Math.random = () => 0; });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  let sends = 0; page.on('request', (r) => { if (r.url().includes('/api/send')) sends++; });
  await page.goto('http://127.0.0.1:8770/index.html'); await page.waitForSelector('[data-act="add-building"]');
  await page.click('[data-act="add-building"]'); await page.fill('#new-building', 'Carry Hall'); await page.click('[data-act="save-building"]'); await page.waitForTimeout(400);
  await page.evaluate(async () => { const s = await import('./js/store.js'); const st = await s.getSettings(); await s.saveSettings({ ...st, receiverToken: 'tok' }); });
  await page.reload(); await page.waitForSelector('[data-act="add-pt"]');
  const setDate = async (d) => { await page.fill('#date', d); await page.dispatchEvent('#date', 'change'); await page.waitForTimeout(300); };
  const addPt = async (l, m) => { await page.click('[data-act="add-pt"]'); await page.fill('#ap-last', l); await page.fill('#ap-first', 'Pat'); await page.fill('#ap-mrn', m); await page.click('[data-act="add-pt-save"]'); await page.waitForTimeout(300); };
  const fresh = async () => { await page.waitForSelector('[data-act="loc"]'); await page.click('[data-act="loc"]'); await page.click('[data-act="pain-pick"][data-v="2"]'); await page.click('button.primary[data-act="pain"]'); await page.waitForSelector('#note'); };
  const prev = async () => (await page.textContent('#detail-preview')) || '';
  const tap = async (sel) => { await page.click(sel); await page.waitForTimeout(230); };
  // day 1: oxygen, a symptom, a Foley with findings
  await setDate('2026-11-25'); await addPt('Duck', '9002'); await addPt('Goof', '9003');
  for (const i of [0, 1]) {
    await page.locator('[data-act="open"]').nth(i).click(); await fresh();
    await page.click('.dchip[data-dkey="o2"]'); await page.waitForSelector('[data-o2l="2"]');
    await tap('[data-o2l="2"]'); await tap('[data-pick="o2.via"][data-v="nasal cannula"]'); await tap('[data-o2sob="denies"]');
    await page.click('.dchip[data-dkey="bm"]'); await page.waitForSelector('[data-gucath="Foley"]');
    await tap('[data-gucath="Foley"]'); await tap('[data-pick="gu.drain"]');
    await page.goBack(); await page.waitForSelector('[data-act="open"]');
  }
  // day 2
  await setDate('2026-11-26'); await addPt('Duck', '9002'); await addPt('Goof', '9003');
  await page.locator('[data-act="open"]').nth(0).click(); await page.waitForSelector('[data-act="carry"]');
  await page.click('[data-act="carry"]'); await page.waitForSelector('#note');
  const banner = (await page.textContent('#carriedset')).replace(/\s+/g, ' ');
  ok(banner.includes('Carried from') && banner.includes('not confirmed today') && banner.includes('Pt on 2 L O2 via nasal cannula. Foley catheter in place.'), 'started from the last note: the carried settings are listed for a look: ' + banner.slice(0, 150));
  await page.click('.dchip[data-dkey="o2"]'); await page.waitForSelector('[data-o2l="2"]');
  ok(await page.$eval('[data-o2l="2"]:not([data-mu])', (e) => e.classList.contains('on')) && await page.$eval('[data-pick="o2.via"][data-v="nasal cannula"]:not([data-mu])', (e) => e.classList.contains('on'))
    && !(await page.$eval('[data-o2sob="denies"]:not([data-mu])', (e) => e.classList.contains('on'))), 'the O2 buttons start with the set-up on, and yesterday\'s "denies shortness of breath" is NOT pre-set');
  const pv = await prev();
  ok(pv.split('L O2').length === 2 && pv.includes('Foley catheter in place.') && !pv.includes('Foley catheter in place, denies') && !pv.includes('Draining clear yellow urine'), 'the note has each carried setting once, without yesterday\'s catheter findings');
  await page.goBack(); await page.waitForSelector('[data-act="send"]');
  // patient 2: started fresh, not from the last note - the settings still come along
  await page.locator('[data-act="open"]').nth(1).click(); await fresh();
  ok(!!(await page.$('#carriedset')) && (await prev()).includes('Pt on 2 L O2 via nasal cannula.'), 'a note started fresh gets the carried settings too');
  await page.click('[data-act="standing-drop"]'); await page.waitForTimeout(400);
  ok(!(await page.$('#carriedset')) && !/L O2|Foley/.test(await page.inputValue('#note')) && !/L O2|Foley/.test(await prev()), 'Remove takes them off this note');
  await page.goBack(); await page.waitForSelector('[data-act="send"]');
  // sending with something not confirmed
  await page.click('[data-act="send"]'); await page.waitForSelector('[data-act="send-clashes"]');
  const gate = (await page.textContent('#app')).replace(/\s+/g, ' ');
  ok(gate.includes('1. Duck, Pat') && gate.includes('not confirmed today') && gate.includes('Pt on 2 L O2 via nasal cannula. Foley catheter in place.') && !gate.includes('2. Goof') && sends === 0, 'Send day stops and lists the patient whose carried settings were not confirmed');
  await page.click('[data-act="back"]'); await page.waitForSelector('[data-act="open"]');
  await page.locator('[data-act="open"]').nth(0).click(); await page.waitForSelector('#note');
  // setting it yourself settles that part
  await page.click('.dchip[data-dkey="o2"]'); await page.waitForSelector('[data-o2l="3"]'); await tap('[data-o2l="3"]:not([data-mu])');
  const b2 = (await page.textContent('#carriedset')).replace(/\s+/g, ' ');
  ok(!b2.includes('L O2') && b2.includes('Foley catheter in place.') && (await prev()).includes('Pt on 3 L O2 via nasal cannula.'), 'changing the oxygen yourself settles the oxygen; the catheter is still waiting');
  await page.click('[data-act="standing-ok"]'); await page.waitForTimeout(400);
  ok(!(await page.$('#carriedset')) && (await prev()).includes('Foley catheter in place.'), '"Still right" keeps the catheter and clears the banner');
  await page.goBack(); await page.waitForSelector('[data-act="send"]');
  await page.click('[data-act="send"]'); await page.waitForTimeout(2000);
  ok(sends === 1 && !(await page.$('[data-act="send-clashes"]')), 'with everything confirmed the day is sent without the check screen');
  // the switch in Settings
  await page.click('[data-act="settings"]'); await page.waitForSelector('#s-standing');
  ok(await page.isChecked('#s-standing'), 'Settings has the switch, on');
  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`ui 11-26D: ${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
