// Made-up patients only. Every building's chart at once, and what the phone holds (APP-11-25H).
const { chromium, devices } = require('playwright');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL', m); } };
const chartFor = (n, made) => ({ kind: 'phone-chart', made, patients: Array.from({ length: n }, (_, i) => ({ name: `DUCK${i}, PAT`, mrn: String(9000 + i), dx: [`Made-up dx ${i}`], dx_from: 'note 11/24/2026', meds: [], meds_from: 'note 11/24/2026' })) });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  let asked = []; let mode = 'ok';
  await page.route('**/api/chart**', (r) => {
    const b = new URL(r.request().url()).searchParams.get('building'); asked.push(b);
    if (mode === 'down') return r.abort();
    if (b === 'Quarry') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, found: true, chart: chartFor(3, '11/25/2026 07:12'), modified: 'x' }) });
    if (b === 'Gravel Pit') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, found: true, chart: chartFor(5, '11/24/2026 18:30'), modified: 'x' }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, found: false, why: 'no phone chart for this building yet' }) });
  });
  await page.goto('http://127.0.0.1:8770/index.html'); await page.waitForSelector('[data-act="add-building"]');
  for (const b of ['Quarry', 'Gravel Pit', 'Slate Hall']) { await page.click('[data-act="add-building"]'); await page.fill('#new-building', b); await page.click('[data-act="save-building"]'); await page.waitForTimeout(350); }
  ok(await page.isVisible('#chartsbox [data-act="charts-all"]'), 'the list screen has a "Dx and Meds on this phone" card with Get all charts');
  asked = [];
  await page.click('[data-act="charts-all"]'); await page.waitForTimeout(1200);
  ok(JSON.stringify(asked) === JSON.stringify(['Quarry', 'Gravel Pit', 'Slate Hall']), 'Get all charts asks for every building, one after another: ' + JSON.stringify(asked));
  const box = async () => (await page.textContent('#chartsbox')).replace(/\s+/g, ' ');
  const t = await box();
  ok(t.includes('Quarry: 3 patients in the chart · chart made 11/25/2026 07:12 · pulled') && t.includes('Gravel Pit: 5 patients in the chart · chart made 11/24/2026 18:30'), 'each building with a chart shows its patients and when it was made and pulled');
  ok(t.includes('Slate Hall: no chart on this phone - no phone chart for this building yet') && t.includes('2 of 3 buildings'), 'a building with no chart says so, with the reason; the heading counts 2 of 3');
  // each patient gets their own part of it, in a building that was never opened
  await page.locator('[data-act="building"]').nth(1).click(); await page.waitForTimeout(400);
  await page.fill('#date', '2026-11-25'); await page.dispatchEvent('#date', 'change'); await page.waitForTimeout(250);
  await page.click('[data-act="add-pt"]'); await page.fill('#ap-last', 'Duck4'); await page.fill('#ap-first', 'Pat'); await page.fill('#ap-mrn', '9004');
  await page.click('[data-act="add-pt-save"]'); await page.waitForTimeout(300);
  mode = 'down';
  await page.click('[data-act="open"]'); await page.waitForSelector('[data-act="loc"]');
  await page.click('[data-act="loc"]'); await page.click('[data-act="pain-pick"][data-v="2"]'); await page.click('button.primary[data-act="pain"]'); await page.waitForSelector('#note');
  await page.click('.dchip[data-dkey="dx"]'); await page.waitForSelector('[data-tap="dx"]');
  ok(JSON.stringify(await page.locator('[data-tap="dx"]').allTextContents()).includes('Made-up dx 4'), 'with the computer now unreachable, a patient in the second building still gets their own diagnoses from the phone');
  await page.goBack(); await page.waitForSelector('#chartsbox');
  // unreachable: stop after the first building, keep what the phone has
  asked = [];
  await page.click('[data-act="charts-all"]'); await page.waitForTimeout(6500);
  const t2 = await box();
  ok(new Set(asked).size === 1 && asked.length === 3, 'computer unreachable: the first building is tried 3 times and the rest are not asked (' + asked.join(', ') + ')');
  ok(t2.includes('Quarry: 3 patients in the chart') && t2.includes('last try: The computer could not be reached') && t2.includes('Gravel Pit: 5 patients in the chart'), 'the charts already on the phone are kept, and the card says the last try failed');
  // fold, and it stays folded
  await page.click('#chartsbox [data-act="fold"]'); await page.waitForTimeout(300);
  ok(!(await page.$('[data-act="charts-all"]')) && (await box()).includes('2 of 3 buildings'), 'the card folds to its heading with the count');
  mode = 'ok'; asked = [];
  await page.reload(); await page.waitForSelector('#chartsbox [data-act="fold"]'); await page.waitForTimeout(1500);
  ok(!(await page.$('[data-act="charts-all"]')), 'it stays folded after the app is opened again');
  ok(JSON.stringify(asked) === JSON.stringify(['Quarry', 'Gravel Pit', 'Slate Hall']), 'opening the app asks for every building by itself: ' + JSON.stringify(asked));
  await page.click('#chartsbox [data-act="fold"]'); await page.waitForTimeout(300);
  ok(!(await box()).includes('last try'), 'after a good pull the "last try" line is gone');
  await page.screenshot({ path: require('os').tmpdir() + '/shot_allcharts.png' });
  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`ui all charts: ${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
