// Made-up patients only. The time clock (APP-11-24).
const { chromium, devices } = require('playwright');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL', m); } };
const U = 'http://127.0.0.1:8770/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(U + 'index.html'); await page.waitForSelector('[data-act="add-building"]');
  for (const b of ['Test Hall', 'Quarry']) { await page.click('[data-act="add-building"]'); await page.fill('#new-building', b); await page.click('[data-act="save-building"]'); await page.waitForTimeout(350); }
  await page.locator('[data-act="building"]').nth(0).click(); await page.waitForTimeout(300);
  await page.fill('#date', '2026-11-24'); await page.dispatchEvent('#date', 'change'); await page.waitForTimeout(300);
  const card = () => page.textContent('#clock');
  ok((await card()).includes('Time at Test Hall') && (await card()).includes('Not clocked in'), 'the list screen shows the clock for the building, not clocked in');
  ok(await page.isVisible('[data-act="clock-in"]') && await page.isVisible('[data-act="clock-add"]'), 'Clock in now and Add a time by hand are offered');
  await page.click('[data-act="clock-in"]'); await page.waitForTimeout(300);
  const now = await page.evaluate(() => { const n = new Date(); return String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0'); });
  const inVal = await page.inputValue('[data-clock="in"][data-i="0"]');
  ok(Math.abs((+inVal.slice(0, 2) * 60 + +inVal.slice(3)) - (+now.slice(0, 2) * 60 + +now.slice(3))) <= 1, 'Clock in stamps the time now (' + inVal + ')');
  ok((await card()).includes('Clocked in at') && await page.isVisible('[data-act="clock-out"]') && (await card()).includes('still in'), 'it shows clocked in, and offers Clock out');
  // editing is the point: change the in time
  await page.fill('[data-clock="in"][data-i="0"]', '07:42'); await page.dispatchEvent('[data-clock="in"][data-i="0"]', 'change'); await page.waitForTimeout(300);
  ok((await page.inputValue('[data-clock="in"][data-i="0"]')) === '07:42' && (await card()).includes('Clocked in at 7:42 AM'), 'the in time can be changed by hand');
  await page.click('[data-act="clock-out"]'); await page.waitForTimeout(300);
  ok((await page.inputValue('[data-clock="out"][data-i="0"]')) !== '', 'Clock out stamps the out time');
  await page.fill('[data-clock="out"][data-i="0"]', '11:15'); await page.dispatchEvent('[data-clock="out"][data-i="0"]', 'change'); await page.waitForTimeout(300);
  ok((await card()).includes('3 h 33 min') && (await card()).includes('Total 3 h 33 min'), 'the out time can be changed, and the total follows (3 h 33 min)');
  // a second stretch, typed by hand
  await page.click('[data-act="clock-add"]'); await page.waitForTimeout(300);
  await page.fill('[data-clock="in"][data-i="1"]', '13:00'); await page.dispatchEvent('[data-clock="in"][data-i="1"]', 'change'); await page.waitForTimeout(250);
  await page.fill('[data-clock="out"][data-i="1"]', '14:30'); await page.dispatchEvent('[data-clock="out"][data-i="1"]', 'change'); await page.waitForTimeout(300);
  ok((await card()).includes('Total 5 h 03 min'), 'a second stretch typed by hand is added to the total (5 h 03 min)');
  await page.fill('[data-clock="out"][data-i="1"]', '12:00'); await page.dispatchEvent('[data-clock="out"][data-i="1"]', 'change'); await page.waitForTimeout(300);
  ok((await card()).includes('out is before in') && (await card()).includes('Total 3 h 33 min'), 'an out time before the in time is flagged and not counted');
  await page.fill('[data-clock="out"][data-i="1"]', '14:30'); await page.dispatchEvent('[data-clock="out"][data-i="1"]', 'change'); await page.waitForTimeout(300);
  await page.screenshot({ path: require('os').tmpdir() + '/shot_clock.png' });
  // per building and per date
  await page.locator('[data-act="building"]').nth(1).click(); await page.waitForTimeout(400);
  ok((await card()).includes('Time at Quarry') && (await card()).includes('Not clocked in'), 'another building the same day has its own clock');
  await page.locator('[data-act="building"]').nth(0).click(); await page.waitForTimeout(400);
  ok((await card()).includes('Total 5 h 03 min'), 'back at the first building its times are still there');
  await page.fill('#date', '2026-11-25'); await page.dispatchEvent('#date', 'change'); await page.waitForTimeout(400);
  ok((await card()).includes('Not clocked in'), 'another date starts with no times');
  await page.fill('#date', '2026-11-24'); await page.dispatchEvent('#date', 'change'); await page.waitForTimeout(400);
  // survives a reload; not in what is sent
  await page.reload(); await page.waitForSelector('#clock');
  ok((await card()).includes('Total 5 h 03 min') && (await page.inputValue('[data-clock="in"][data-i="0"]')) === '07:42', 'the times are still there after the app is closed and opened');
  await page.click('[data-act="add-pt"]'); await page.fill('#ap-last', 'Mouse'); await page.fill('#ap-first', 'Mickey'); await page.fill('#ap-mrn', '9001'); await page.click('[data-act="add-pt-save"]'); await page.waitForTimeout(300);
  const sent = await page.evaluate(async () => {
    const n = await import('./js/note.js'); const s = await import('./js/store.js');
    const b = (await s.getSettings()).currentBuilding; const day = await s.getDay('2026-11-24', b);
    return { lines: n.summaryLines({ ...day, building: 'Test Hall' }).join('\n'), dayHasClock: 'clock' in day, backup: Object.keys((await s.exportAll()).clock || {}).length };
  });
  ok(!/07:42|7:42|11:15|Clock|Time at/i.test(sent.lines), 'the daily summary that is sent has no clock times in it');
  ok(sent.dayHasClock === false && sent.backup === 1, 'the times are kept apart from the day, and are in the backup');
  ok((await card()).includes('Total 5 h 03 min'), 'adding a patient does not disturb the clock');
  // remove a stretch
  await page.locator('[data-act="clock-del"]').nth(1).click(); await page.waitForTimeout(300);
  ok((await card()).includes('Total 3 h 33 min') && (await page.locator('[data-clock="in"]').count()) === 1, 'a stretch can be removed');
  // time log
  await page.click('[data-act="settings"]'); await page.waitForSelector('[data-act="timelog"]'); await page.click('[data-act="timelog"]'); await page.waitForTimeout(300);
  const log = await page.textContent('#app');
  ok(log.includes('Time log') && log.includes('11/24/2026') && log.includes('Test Hall') && log.includes('7:42 AM - 11:15 AM') && log.includes('3 h 33 min'), 'Settings has a time log listing the day, building, times and total');
  const text = await page.evaluate(() => navigator.clipboard ? 'has' : 'none');
  await page.screenshot({ path: require('os').tmpdir() + '/shot_timelog.png' });
  await page.locator('[data-act="timelog-open"]').first().click(); await page.waitForTimeout(500);
  ok(await page.isVisible('#clock') && (await card()).includes('Time at Test Hall') && (await page.inputValue('#date')) === '2026-11-24', 'tapping a day in the log opens that day so its times can be changed');
  // delete the day: the clock stays
  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`ui clock: ${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
