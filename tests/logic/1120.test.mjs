// Made-up data only. Checks the pure logic of APP-11-20 (BM sentence, typed BM date, exam lines).
import * as n from '../../app/js/note.js';
import * as d from '../../app/js/defaults.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const dos = '2026-11-19';
const bm = (date, how) => n.bmSentence({ bm: { date, dos, how } });
ok(bm('2026-11-18', 'both') === 'Last BM yesterday (11/18/26).', 'both, yesterday: ' + bm('2026-11-18', 'both'));
ok(bm('2026-11-19', 'both') === 'Last BM today (11/19/26).', 'both, today');
ok(bm('2026-11-18', 'word') === 'Last BM yesterday.' && bm('2026-11-19', 'word') === 'Last BM today.', 'word only');
ok(bm('2026-11-18', 'date') === 'Last BM 11/18/26.' && bm('2026-11-19', 'date') === 'Last BM 11/19/26.', 'date only');
ok(bm('2026-11-15', 'both') === 'Last BM 11/15/26.' && bm('2026-11-15', 'word') === 'Last BM 11/15/26.', 'another day is always its date');
ok(bm('2026-11-18', undefined) === 'Last BM yesterday (11/18/26).', 'no choice saved = both');
ok(n.bmSentence({}) === '' && n.bmSentence({ bm: { date: '', dos } }) === '', 'no BM set = no sentence');
// "yesterday" is counted from the date of service, across a month and a year end
ok(n.bmSentence({ bm: { date: '2026-10-31', dos: '2026-11-01', how: 'both' } }) === 'Last BM yesterday (10/31/26).', 'month end');
ok(n.bmSentence({ bm: { date: '2025-12-31', dos: '2026-01-01', how: 'both' } }) === 'Last BM yesterday (12/31/25).', 'year end');
// typed dates
const P = (t) => n.parseBmDate(t, dos);
ok(P('11/15') === '2026-11-15' && P('11/15/26') === '2026-11-15' && P('11-15-2026') === '2026-11-15' && P(' 11.15 ') === '2026-11-15', 'typed date forms');
ok(P('11/19') === '2026-11-19', 'the date of service itself is allowed');
ok(P('11/20') === '2025-11-20', 'no year and later than the date of service = last year: ' + P('11/20'));
ok(P('11/20/26') === '' && P('12/1/2026') === '', 'a typed year after the date of service is refused');
ok(P('2/30') === '' && P('13/1') === '' && P('abc') === '' && P('') === '' && P('11/') === '', 'not a date = refused');
ok(n.parseBmDate('12/31', '2026-01-02') === '2025-12-31', 'year end without a year');
// placement: after the constipation sentence, else at the end
const text = "Pt assessed up in chair. Vital signs: denies HAs, dizziness or chest pain. Pain 2/10. Pt denies constipation. Fair appetite, adequate fluids intake. Pt continues to work with therapy.";
const full = n.fullNote({ text, fields: {}, bm: { date: '2026-11-18', dos, how: 'both' } });
ok(full.includes('Pt denies constipation. Last BM yesterday (11/18/26). Fair appetite'), 'BM follows the constipation sentence: ' + full);
ok(n.fullNote({ text: 'Pt assessed in bed. No complaints.', fields: {}, bm: { date: '2026-11-19', dos, how: 'word' } }) === 'Pt assessed in bed. No complaints. Last BM today.', 'no constipation sentence = at the end');
ok(n.fullNote({ text, fields: {} }) === text, 'no BM = note unchanged');
ok(n.fullNote({ text, fields: {}, exam: { Resp: 'Bibasilar crackles' } }) === text, 'exam findings are never put in the note text');
// carry forward drops yesterday's BM sentence and nothing else
const cf = n.carryForward(full, null, d.DEFAULT_SETTINGS);
ok(!/Last BM/.test(cf) && cf.includes('Pt denies constipation. Fair appetite') && cf.includes('continues to work with therapy.'), 'carry forward drops the BM sentence only: ' + cf);
// exam lines
const p = { mrn: '9001', last: 'Mouse', first: 'Mickey', text, exam: { Ext: ' 1+ bilateral  lower leg edema ', Resp: 'Bibasilar crackles', CV: '   ' } };
ok(JSON.stringify(n.examLines(p)) === JSON.stringify(['Exam: Resp: Bibasilar crackles', 'Exam: Ext: 1+ bilateral lower leg edema']), 'exam lines, in body order, blanks left out: ' + JSON.stringify(n.examLines(p)));
ok(n.examLines({}).length === 0, 'no exam = no lines');
const day = { date: dos, building: 'Test Hall', patients: [p, { mrn: '9002', last: 'Duck', first: 'Donald', text: 'Pt assessed at bedside.' }, { mrn: '9003', last: 'Dog', first: 'Pluto', text: '', exam: { Skin: 'Warm, dry, intact' } }], sends: [] };
const lines = n.summaryLines(day);
ok(lines[3].startsWith('MOUSE, MICKEY (9001): Pt assessed up in chair.') && lines[4] === 'Exam: Resp: Bibasilar crackles' && lines[5] === 'Exam: Ext: 1+ bilateral lower leg edema', 'exam lines follow their patient');
ok(lines[6] === 'DUCK, DONALD (9002): Pt assessed at bedside.' && lines[7] === 'DOG, PLUTO (9003): New pt' && lines[8] === 'Exam: Skin: Warm, dry, intact' && lines.length === 9, 'others unchanged; a new patient can carry exam lines');
// a changed exam line or BM counts as a change since the last send; a note with neither hashes as before
const plain = { mrn: '9002', text: 'Pt assessed at bedside.' };
const h0 = n.noteHash(plain);
ok(n.noteHash({ ...plain, exam: {} }) === h0 && n.noteHash({ ...plain, fields: {} }) === h0, 'no exam and no BM = same fingerprint as before');
ok(n.noteHash({ ...plain, exam: { Resp: 'clear' } }) !== h0 && n.noteHash({ ...plain, bm: { date: dos, dos, how: 'both' } }) !== h0, 'exam or BM changes the fingerprint');
day.sends.push(n.nextSend(day));
ok(n.unsentCount(day) === 0, 'sent = nothing unsent');
p.exam.Resp = 'Clear to auscultation bilaterally, no wheezes or crackles';
ok(n.unsentCount(day) === 1, 'an exam change after sending counts as unsent');
// settings and lists
ok(d.DETAILS.some((x) => x.key === 'bm') && d.DETAILS.some((x) => x.key === 'exam'), 'BM and Exam are on the detail bar');
ok(new Set(d.EXAM_SYSTEMS.map((s) => s.key)).size === d.EXAM_SYSTEMS.length && d.EXAM_SYSTEMS.every((s) => s.presets.length), 'exam systems are unique and each has findings to tap');
ok(d.DEFAULT_SETTINGS.bmHow === 'both', 'BM is written both ways unless changed');
console.log(`logic 11-20: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
