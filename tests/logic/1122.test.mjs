// Made-up data only. Checks the pure logic of APP-11-22 (labs sentence, antibiotic placement, BM kind, back sites).
import * as n from '../../app/js/note.js';
import * as d from '../../app/js/defaults.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const text = "Pt assessed up in chair. Vital signs: denies HAs, dizziness or chest pain. Pain 2/10. Pt denies constipation. Fair appetite, adequate fluids intake. Pt continues to work with therapy.";
const dos = '2026-11-22';
// labs
ok(n.fullNote({ text, fields: { labs: 'Labs reviewed' } }) === text + ' Labs reviewed.', 'Labs reviewed goes at the end: ' + n.fullNote({ text, fields: { labs: 'Labs reviewed' } }).slice(-40));
ok(n.fullNote({ text, fields: { labs: 'Labs reviewed with pt' } }).endsWith('therapy. Labs reviewed with pt.'), 'Labs reviewed with pt');
ok(n.fullNote({ text, fields: {} }) === text, 'no labs = unchanged');
const labs = d.DETAILS.find((x) => x.key === 'labs');
ok(labs && JSON.stringify(labs.presets) === JSON.stringify(['Labs reviewed', 'Labs reviewed with pt']), 'the Labs detail has the two choices');
// antibiotic sentence right after where the patient was assessed
const abx = ['Pt continues with IV Vancomycin, day 3 of 7, without complications.'];
const f = n.fullNote({ text, fields: {}, abx });
ok(f.startsWith('Pt assessed up in chair. Pt continues with IV Vancomycin, day 3 of 7, without complications. Vital signs:'), 'antibiotic sentence follows the assessed sentence: ' + f.slice(0, 120));
ok(!f.trim().endsWith('complications.') && f.split('Vancomycin').length === 2, 'and is not at the end, and appears once');
const f2 = n.fullNote({ text, fields: { overnight: 'No acute events overnight', labs: 'Labs reviewed' }, abx });
ok(f2.startsWith('Pt assessed up in chair. Pt continues with IV Vancomycin, day 3 of 7, without complications. No acute events overnight. Vital signs:') && f2.endsWith('Labs reviewed.'), 'antibiotic first, then overnight; labs last');
ok(n.fullNote({ text: '', fields: {}, abx }) === abx[0], 'with no note text the antibiotic sentence stands alone, once');
// BM kind
const bm = (date, how, kind) => n.bmSentence({ bm: { date, dos, how, kind } });
ok(bm('2026-11-21', 'both', 'loose') === 'Last BM yesterday (11/21/26), loose.', 'both + loose: ' + bm('2026-11-21', 'both', 'loose'));
ok(bm('2026-11-22', 'word', 'diarrhea') === 'Last BM today, diarrhea.' && bm('2026-11-21', 'date', 'firm') === 'Last BM 11/21/26, firm.', 'word + diarrhea, date + firm');
ok(bm('2026-11-18', 'both', 'firm') === 'Last BM 11/18/26, firm.' && bm('2026-11-21', 'both') === 'Last BM yesterday (11/21/26).', 'another day + firm; no kind = as before');
ok(JSON.stringify(d.BM_KINDS) === JSON.stringify(['firm', 'loose', 'diarrhea']), 'three stool choices');
const withBm = n.fullNote({ text, fields: {}, bm: { date: '2026-11-21', dos, how: 'both', kind: 'diarrhea' } });
ok(withBm.includes('Pt denies constipation. Last BM yesterday (11/21/26), diarrhea. Fair appetite'), 'placed after the constipation sentence');
ok(!/Last BM/.test(n.carryForward(withBm, null, d.DEFAULT_SETTINGS)), 'carry forward still drops it');
// back
ok(d.PAIN_SITES[0] === 'back' && !d.PAIN_SITES.includes('lower back') && JSON.stringify(d.BACK_PARTS) === JSON.stringify(['lower', 'mid', 'upper']), 'the site is "back" with three parts');
ok(n.painPhrase({ pain: 4, painSite: ['mid back'], painType: ['aching'] }) === 'Pain 4/10 to mid back, aching' && n.painPhrase({ pain: 4, painSite: ['back'] }) === 'Pain 4/10 to back'
  && n.painPhrase({ pain: 4, painSide: 'left', painSite: ['lower back', 'hip'] }) === 'Pain 4/10 to left lower back and hip', 'pain sentence with a back part, plain back, and an older "lower back"');
console.log(`logic 11-22: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
