// Made-up data only. Time clock arithmetic (APP-11-24). Run from the app folder: node t_clock.mjs
const n = await import('../../app/js/' + 'note.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
ok(n.clockMinutes('07:42', '11:15') === 213, '07:42 to 11:15 is 213 minutes');
ok(n.clockMinutes('07:42', '07:42') === 0, 'same time is 0');
ok(n.clockMinutes('11:15', '07:42') === null, 'out before in is not counted');
ok(n.clockMinutes('07:42', '') === null && n.clockMinutes('', '09:00') === null, 'a missing time is not counted');
ok(n.clockMinutes('25:00', '26:00') === null && n.clockMinutes('7:5', '8:00') === null, 'a malformed time is not counted');
ok(n.clockSpan(213) === '3 h 33 min' && n.clockSpan(45) === '45 min' && n.clockSpan(125) === '2 h 05 min' && n.clockSpan(0) === '0 min', 'spans read as hours and minutes');
ok(n.clockTotal([{ in: '07:42', out: '11:15' }, { in: '13:00', out: '14:30' }, { in: '15:00', out: '' }, { in: '16:00', out: '15:00' }]) === 303, 'the total counts finished stretches only (213 + 90)');
ok(n.clockTotal([]) === 0 && n.clockTotal(undefined) === 0, 'no times: total 0');
ok(n.clock12('07:42') === '7:42 AM' && n.clock12('13:05') === '1:05 PM' && n.clock12('00:10') === '12:10 AM' && n.clock12('12:00') === '12:00 PM' && n.clock12('') === '', '12-hour display');
const day = { date: '2026-11-24', building: 'Test Hall', patients: [{ last: 'Mouse', first: 'Mickey', mrn: '9001', text: 'Pt assessed at bedside.' }] };
ok(!n.summaryLines(day).join('\n').match(/clock|Time at|\d h \d\d min/i), 'the daily summary has no clock text in it');
console.log(`logic clock: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
