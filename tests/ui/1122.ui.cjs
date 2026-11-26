// Made-up patients only. Drives the real app: back pain parts, BM kind, Labs button (APP-11-22).
const { chromium, devices } = require('playwright');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL', m); } };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  await ctx.addInitScript(() => { Math.random = () => 0; }); // the app varies routine wording at random; a test needs the same wording every run
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8765/index.html'); await page.waitForSelector('[data-act="add-building"]');
  await page.click('[data-act="add-building"]'); await page.fill('#new-building', 'Test Hall'); await page.click('[data-act="save-building"]'); await page.waitForTimeout(400);
  await page.fill('#date', '2026-11-22'); await page.dispatchEvent('#date', 'change'); await page.waitForTimeout(200);
  await page.click('[data-act="add-pt"]'); await page.fill('#ap-last', 'Mouse'); await page.fill('#ap-first', 'Mickey'); await page.fill('#ap-mrn', '9001');
  await page.click('[data-act="add-pt-save"]'); await page.waitForTimeout(300);
  await page.click('[data-act="open"]'); await page.waitForSelector('[data-act="loc"]');
  await page.click('[data-act="loc"]'); await page.click('[data-act="pain-pick"][data-v="4"]');
  // back: tap it, then a part
  const sites = await page.$$eval('[data-act="pain-site"]', (els) => els.map((e) => e.dataset.v));
  ok(sites[0] === 'back' && !sites.includes('lower back'), 'the first site is "back": ' + sites.slice(0, 3).join(','));
  ok((await page.$$('[data-act="pain-back"]')).length === 0, 'the parts are hidden until back is tapped');
  await page.click('[data-act="pain-site"][data-v="back"]'); await page.waitForSelector('[data-act="pain-back"]');
  ok(JSON.stringify(await page.$$eval('[data-act="pain-back"]', (els) => els.map((e) => e.dataset.v))) === JSON.stringify(['lower', 'mid', 'upper']), 'tapping back asks lower, mid or upper');
  await page.screenshot({ path: require('os').tmpdir() + '/shot_back.png' });
  await page.click('[data-act="pain-back"][data-v="mid"]'); await page.waitForTimeout(150);
  ok((await page.textContent('button.primary[data-act="pain"]')).includes('Pain 4/10 to mid back'), 'the button shows "to mid back": ' + await page.textContent('button.primary[data-act="pain"]'));
  await page.click('[data-act="pain-back"][data-v="upper"]'); await page.waitForTimeout(150);
  ok((await page.textContent('button.primary[data-act="pain"]')).includes('to upper back') && !(await page.textContent('button.primary[data-act="pain"]')).includes('mid'), 'another part replaces it');
  await page.click('[data-act="pain-back"][data-v="upper"]'); await page.waitForTimeout(150);
  ok(/to back\s*$/.test((await page.textContent('button.primary[data-act="pain"]')).trim()), 'tapping the part again leaves plain "back"');
  await page.click('[data-act="pain-back"][data-v="lower"]'); await page.waitForTimeout(150);
  await page.click('button.primary[data-act="pain"]'); await page.waitForSelector('#note');
  ok(/Pain 4\/10 to lower back/.test(await page.inputValue('#note')), 'the note says "Pain 4/10 to lower back"');
  const prev = async () => (await page.textContent('#detail-preview')) || '';
  // BM kind
  await page.click('.dchip[data-dkey="bm"]'); await page.waitForSelector('[data-bmkind="loose"]');
  ok(await page.isDisabled('[data-bmkind="loose"]'), 'stool choices wait until a day is picked');
  await page.click('[data-bm="yesterday"]'); await page.waitForTimeout(250);
  await page.click('[data-bmkind="loose"]'); await page.waitForTimeout(250);
  ok((await prev()).includes('Last BM yesterday (11/21/26), loose.'), 'Yesterday + Loose: ' + (await prev()).slice(-120));
  await page.click('[data-bmkind="diarrhea"]'); await page.waitForTimeout(250);
  ok((await prev()).includes('Last BM yesterday (11/21/26), diarrhea.'), 'Diarrhea replaces Loose');
  await page.click('[data-bm="today"]'); await page.waitForTimeout(250);
  ok((await prev()).includes('Last BM today (11/22/26), diarrhea.'), 'changing the day keeps the stool choice');
  await page.click('[data-bmkind="diarrhea"]'); await page.waitForTimeout(250);
  ok((await prev()).includes('Last BM today (11/22/26).'), 'tapping it again removes it');
  await page.click('[data-bmkind="firm"]'); await page.waitForTimeout(250);
  await page.screenshot({ path: require('os').tmpdir() + '/shot_bm17.png' });
  // Labs
  await page.click('.dchip[data-dkey="labs"]'); await page.waitForSelector('.dpreset[data-dv="Labs reviewed with pt"]');
  await page.click('.dpreset[data-dv="Labs reviewed"]'); await page.waitForTimeout(250);
  ok((await prev()).trim().endsWith('Labs reviewed.'), 'Labs reviewed is added at the end: ' + (await prev()).slice(-60));
  await page.click('.dpreset[data-dv="Labs reviewed with pt"]'); await page.waitForTimeout(700);
  ok((await prev()).trim().endsWith('Labs reviewed with pt.') && !(await prev()).includes('Labs reviewed. '), 'Labs reviewed with pt replaces it');
  await page.screenshot({ path: require('os').tmpdir() + '/shot_labs.png' });
  const lines = await page.evaluate(async () => {
    const n = await import('./js/note.js'); const s = await import('./js/store.js');
    const b = (await s.getSettings()).currentBuilding; const day = await s.getDay('2026-11-22', b);
    return n.summaryLines({ ...day, building: 'Test Hall' });
  });
  ok(/Pain 4\/10 to lower back.*constipation\. Last BM today \(11\/22\/26\), firm\..*Labs reviewed with pt\.$/.test(lines[3]), 'the daily summary line carries all three: ' + lines[3].slice(-170));
  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`ui 11-22: ${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message.slice(0, 600)); process.exit(2); });
