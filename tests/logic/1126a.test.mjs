// Made-up data only. APP-11-26A: an MRN read through a look-alike is never accepted silently; rows are checked against the chart.
import * as p from '../../app/js/parsers.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
ok(JSON.stringify(p.readMrn('8094')) === JSON.stringify({ mrn: '8094', repaired: false, raw: '8094' }), 'plain digits: not repaired');
ok(p.readMrn('8O94').mrn === '8094' && p.readMrn('8O94').repaired === true, '"8O94" reads as 8094 and is marked repaired');
ok(p.readMrn('DUCK').mrn === null && p.readMrn('').mrn === null, 'a word is not an MRN');
const text = ['DUCK, DONALD (8O94) Pod A 202 - 1 1/2/2026 8094', 'MOUSE, MINNIE (8088) Pod A 203 - 1 1/2/2026 8O88', 'BOOP, BETTY (8O96) Pod B',
  'JETSON, JANE (8080) Pod C 1/1/2026 8086', 'FLINTSTONE, FRED (8101) Pod C 1/1/2026 8101', 'RUBBLE, BARNEY (81O5) Pod C 1/1/2026 81O5', 'SLATE, SAM (8110) Pod D'].join('\n');
const r = p.parseRoster(text);
const by = (rows, last) => rows.find((x) => x.last === last);
ok(by(r, 'Duck').mrn === '8094' && by(r, 'Duck').flag === '' && by(r, 'Mouse').flag === '', 'one unclear reading backed by a plain-digit reading of the same row is accepted without a flag');
ok(by(r, 'Boop').mrn === '8096' && by(r, 'Boop').flag === 'MRN had an unclear character (read "8O96" as 8096)', 'a single unclear reading is flagged, with what was read: ' + by(r, 'Boop').flag);
ok(by(r, 'Rubble').flag === 'MRN had an unclear character in both places (read "81O5" and "81O5" as 8105)', 'unclear in both places is flagged: ' + by(r, 'Rubble').flag);
ok(by(r, 'Jetson').flag === 'MRN read as 8080 and 8086' && JSON.stringify(by(r, 'Jetson').alts) === JSON.stringify(['8080', '8086']), 'two different readings are flagged and both are kept');
ok(by(r, 'Flintstone').flag === '' && by(r, 'Slate').flag === '', 'clean rows have no flag');
const chart = [{ name: 'DUCK, DONALD', mrn: '8094' }, { name: 'JETSON, JANE M', mrn: '8080' }, { name: 'FLINTSTONE, WILMA', mrn: '8101' }, { name: 'BOOP, BETTY', mrn: '8098' }, { name: 'RUBBLE, BARNEY', mrn: '8105' }];
const c = p.checkRoster(r, chart);
ok(by(c, 'Duck').chart === 'match' && by(c, 'Duck').flag === '', 'name and MRN both in the chart: confirmed');
ok(by(c, 'Jetson').chart === 'match' && by(c, 'Jetson').mrn === '8080' && by(c, 'Jetson').flag === '' && by(c, 'Jetson').note === 'the chart confirms 8080 (the photo also read 8086)',
  'two readings: the one that is this patient in the chart is used (here not the one the reading itself would have picked): ' + by(c, 'Jetson').note);
ok(by(c, 'Rubble').chart === 'match' && by(c, 'Rubble').flag === '' && by(c, 'Rubble').note === 'confirmed by the chart', 'an unclear reading that is this patient in the chart is confirmed');
ok(by(c, 'Boop').chart === 'mrn' && by(c, 'Boop').mrn === '8096' && by(c, 'Boop').flag.startsWith('the chart has MRN 8098 for BOOP, BETTY; this list reads 8096'), 'name in the chart with another MRN: flagged, and the MRN is NOT changed: ' + by(c, 'Boop').flag);
ok(by(c, 'Flintstone').chart === 'name' && by(c, 'Flintstone').flag === 'MRN 8101 is FLINTSTONE, WILMA in the chart - check the name and the MRN against the paper', 'MRN in the chart under another name: flagged');
ok(by(c, 'Mouse').chart === 'new' && by(c, 'Slate').chart === 'new' && by(c, 'Slate').flag.startsWith('not in the chart'), 'not in the chart: marked new');
ok(c.length === r.length && c.every((x, i) => x.last === r[i].last && x.first === r[i].first), 'no row is dropped, added or renamed by the check');
const twoWrong = p.checkRoster(p.parseRoster('JETSON, JANE (8081) Pod C 1/1/2026 8087'), chart)[0];
ok(twoWrong.chart === 'mrn' && twoWrong.flag.includes('the chart has MRN 8080'), 'two readings and neither is in the chart: nothing is picked, the row is flagged');
ok(p.checkRoster(r, []).every((x) => x.chart === 'new') && p.checkRoster([], chart).length === 0, 'empty chart / empty list');
console.log(`logic 11-26A: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
