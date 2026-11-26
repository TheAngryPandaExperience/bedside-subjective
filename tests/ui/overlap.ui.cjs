// Made-up patient only. The Dx / Meds lists with many long rows: no row may run over the next one (APP-11-25G).
const { chromium, devices } = require('playwright');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL', m); } };
const meds = Array.from({ length: 14 }, (_, i) => ({ name: `Madeupdrug${i} Oral Tablet Delayed Release ${i + 1}0 MG (Madeupdrug Sodium ${i})`,
  text: `Madeupdrug${i} Oral Tablet Delayed Release ${i + 1}0 MG (Madeupdrug Sodium ${i}) — Give 1 tablet by mouth every 24 hours as needed for Bowel Care **IF THE FIRST CHOICE IS INEFFECTIVE AFTER 8 HOURS (row ${i})` }));
const dx = Array.from({ length: 12 }, (_, i) => `Made-up diagnosis ${i}, with a long description that needs a second and maybe a third line on a phone screen`);
const chart = { kind: 'phone-chart', made: '11/25/2026 07:12', patients: [{ name: 'DUCK, PAT', mrn: '9002', dx, dx_from: 'note 11/24/2026', meds, meds_from: 'Medications file 11/24/2026' }] };
(async () => {
  const browser = await chromium.launch();
  for (const scheme of ['dark', 'light']) {
    const ctx = await browser.newContext({ ...devices['Galaxy S9+'], serviceWorkers: 'block', colorScheme: scheme });
    const page = await ctx.newPage();
    await page.route('**/api/chart**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, found: true, chart, modified: 'x' }) }));
    await page.goto('http://127.0.0.1:8770/index.html'); await page.waitForSelector('[data-act="add-building"]');
    await page.click('[data-act="add-building"]'); await page.fill('#new-building', 'Test Hall'); await page.click('[data-act="save-building"]'); await page.waitForTimeout(400);
    await page.fill('#date', '2026-11-25'); await page.dispatchEvent('#date', 'change'); await page.waitForTimeout(250);
    await page.click('[data-act="add-pt"]'); await page.fill('#ap-last', 'Duck'); await page.fill('#ap-first', 'Pat'); await page.fill('#ap-mrn', '9002');
    await page.click('[data-act="add-pt-save"]'); await page.waitForTimeout(300);
    await page.click('[data-act="open"]'); await page.waitForSelector('[data-act="loc"]');
    await page.click('[data-act="loc"]'); await page.click('[data-act="pain-pick"][data-v="2"]');
    await page.click('button.primary[data-act="pain"]'); await page.waitForSelector('#note');
    for (const kind of ['dx', 'meds']) {
      await page.click(`.dchip[data-dkey="${kind}"]`); await page.waitForTimeout(300);
      if (!(await page.$(`[data-tap="${kind}"]`))) { await page.click('[data-chart="refresh"]'); await page.waitForSelector(`[data-tap="${kind}"]`); }
      const r = await page.$$eval(`#chartlist [data-tap="${kind}"]`, (els) => els.map((e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, cut: e.scrollHeight > e.clientHeight + 1, lines: Math.round(b.height) }; }));
      const want = kind === 'dx' ? 12 : 14;
      ok(r.length === want, `${scheme} ${kind}: all ${want} rows are listed (${r.length})`);
      ok(r.every((x) => !x.cut), `${scheme} ${kind}: no row's text is taller than its button (${r.filter((x) => x.cut).length} cut)`);
      ok(r.every((x, i) => i === 0 || x.top >= r[i - 1].bottom - 0.5), `${scheme} ${kind}: no row sits on top of the row before it`);
      ok(r.some((x) => x.lines > 60), `${scheme} ${kind}: long rows are taller than one line (tallest ${Math.max(...r.map((x) => x.lines))}px)`);
      const box = await page.$eval('#chartlist', (e) => ({ h: e.clientHeight, sh: e.scrollHeight, vh: innerHeight }));
      ok(box.sh > box.h && box.h <= box.vh * 0.49, `${scheme} ${kind}: the list scrolls inside its own box and stays under half the screen`);
      await page.screenshot({ path: require('os').tmpdir() + `/shot_${kind}_${scheme}.png` });
    }
    await ctx.close();
  }
  console.log(`ui overlap: ${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
