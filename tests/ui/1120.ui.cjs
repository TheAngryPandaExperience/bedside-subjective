// Made-up patients only. Drives the real app in a phone-sized browser: BM button and Exam section (APP-11-20).
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
  await page.fill('#date', '2026-11-19'); await page.dispatchEvent('#date', 'change'); await page.waitForTimeout(200);
  await page.click('[data-act="add-pt"]'); await page.fill('#ap-last', 'Mouse'); await page.fill('#ap-first', 'Mickey'); await page.fill('#ap-mrn', '9001');
  await page.click('[data-act="add-pt-save"]'); await page.waitForTimeout(300);
  await page.click('[data-act="open"]'); await page.waitForSelector('[data-act="loc"]');
  await page.click('[data-act="loc"]'); await page.click('[data-act="pain-pick"][data-v="2"]'); await page.click('button.primary[data-act="pain"]');
  await page.waitForSelector('#note');
  const chips = await page.$$eval('.dchip', (els) => els.map((e) => e.dataset.dkey));
  ok(chips.includes('bm') && chips.includes('exam'), 'BM and Exam chips are on the bar: ' + chips.join(','));
  const prev = async () => (await page.textContent('#detail-preview')) || '';
  // BM: yesterday
  await page.click('.dchip[data-dkey="bm"]'); await page.waitForSelector('[data-bm="yesterday"]');
  await page.screenshot({ path: require('os').tmpdir() + '/shot_bm.png' });
  await page.click('[data-bm="yesterday"]'); await page.waitForTimeout(250);
  ok((await prev()).includes('Last BM yesterday (11/18/26).'), 'Yesterday writes both: ' + (await prev()).slice(-160));
  ok(/constipation\. Last BM yesterday/.test(await prev()), 'it follows the constipation sentence');
  await page.click('[data-bmhow="word"]'); await page.waitForTimeout(250);
  ok((await prev()).includes('Last BM yesterday.') && !(await prev()).includes('11/18/26'), 'Word only');
  await page.click('[data-bmhow="date"]'); await page.waitForTimeout(250);
  ok((await prev()).includes('Last BM 11/18/26.') && !(await prev()).includes('yesterday'), 'Date only');
  await page.click('[data-bm="today"]'); await page.waitForTimeout(250);
  ok((await prev()).includes('Last BM 11/19/26.'), 'Today, date only');
  await page.click('[data-bmhow="both"]'); await page.waitForTimeout(250);
  ok((await prev()).includes('Last BM today (11/19/26).'), 'Today, both');
  await page.fill('#bmdate', '11/15'); await page.waitForTimeout(500);
  ok((await prev()).includes('Last BM 11/15/26.') && !(await prev()).includes('today'), 'a typed date replaces it: ' + (await prev()).slice(-120));
  await page.fill('#bmdate', '11/25/26'); await page.waitForTimeout(500);
  ok((await page.textContent('#bmhint')).includes('cannot be after the date of service') && (await prev()).includes('Last BM 11/15/26.'), 'a date after the date of service is refused and the earlier one stays');
  ok((await page.textContent('.dchip[data-dkey="bm"]')).includes('BM'), 'chip shown');
  await page.click('[data-dclose]'); await page.waitForTimeout(150);
  ok(/11\/15\/26/.test(await page.textContent('.dchip[data-dkey="bm"]')), 'the BM chip shows what was picked: ' + await page.textContent('.dchip[data-dkey="bm"]'));
  // Exam
  await page.click('.dchip[data-dkey="exam"]'); await page.waitForSelector('[data-exinput="Resp"]');
  await page.screenshot({ path: require('os').tmpdir() + '/shot_exam.png', fullPage: true });
  await page.click('[data-exsys="Resp"][data-exv="Bibasilar crackles"]'); await page.waitForTimeout(250);
  ok((await prev()).includes('Exam: Resp: Bibasilar crackles'), 'tapping a finding adds its exam line: ' + (await prev()).slice(-80));
  ok((await page.inputValue('[data-exinput="Resp"]')) === 'Bibasilar crackles', 'the box shows it, ready to edit');
  await page.fill('[data-exinput="Resp"]', 'Bibasilar crackles, no wheezes'); await page.waitForTimeout(500);
  ok((await prev()).includes('Exam: Resp: Bibasilar crackles, no wheezes'), 'editing the box changes the line');
  await page.fill('[data-exinput="Ext"]', '1+ bilateral ankle edema'); await page.waitForTimeout(500);
  ok((await prev()).includes('Exam: Ext: 1+ bilateral ankle edema'), 'typing without tapping works');
  const note = await page.inputValue('#note');
  ok(!/Exam:|crackles|Last BM/.test(note), 'nothing was typed into the note box itself');
  await page.click('[data-dclose]'); await page.waitForTimeout(150);
  ok(/Exam\s*2/.test(await page.textContent('.dchip[data-dkey="exam"]')), 'the Exam chip counts the systems filled: ' + await page.textContent('.dchip[data-dkey="exam"]'));
  // what goes out
  const lines = await page.evaluate(async () => {
    const n = await import('./js/note.js'); const s = await import('./js/store.js');
    const b = (await s.getSettings()).currentBuilding; const day = await s.getDay('2026-11-19', b);
    return n.summaryLines({ ...day, building: 'Test Hall' });
  });
  ok(/^MOUSE, MICKEY \(9001\): .*constipation\. Last BM 11\/15\/26\./.test(lines[3]) && lines[4] === 'Exam: Resp: Bibasilar crackles, no wheezes' && lines[5] === 'Exam: Ext: 1+ bilateral ankle edema' && lines.length === 6,
    'the daily summary has the note with the BM sentence, then the two exam lines: ' + JSON.stringify(lines.slice(3)));
  // clear
  await page.click('.dchip[data-dkey="exam"]'); await page.click('[data-dclear]'); await page.waitForTimeout(250);
  ok(!(await prev()).includes('Exam:'), 'Clear removes the exam lines');
  await page.click('.dchip[data-dkey="bm"]'); await page.click('[data-dclear]'); await page.waitForTimeout(250);
  ok(!(await prev()).includes('Last BM'), 'Clear removes the BM sentence');
  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`ui 11-20: ${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message.slice(0, 600)); process.exit(2); });
