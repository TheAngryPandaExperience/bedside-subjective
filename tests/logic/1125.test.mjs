// Made-up data only. Pure logic of APP-11-25 (O2, urinary, catheter, ostomy).
import * as n from '../../app/js/note.js';
import * as d from '../../app/js/defaults.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const text = "Pt assessed up in chair. Vital signs: denies HAs, dizziness or chest pain. Pt denies breathing complications. Pain 2/10. Pt denies constipation. Fair appetite, adequate fluids intake. Pt continues to work with therapy.";
const dos = '2026-11-25';
ok(d.DETAILS.findIndex((x) => x.key === 'o2') === d.DETAILS.findIndex((x) => x.key === 'bm') - 1, 'O2 chip sits just before BM');
ok(n.o2Sentence({ o2: { liters: '2' } }) === 'Pt on 2 L O2.', 'liters');
ok(n.o2Sentence({ o2: { liters: '2.5 L', sob: 'denies', tx: true } }) === 'Pt on 2.5 L O2. Pt denies shortness of breath. Continues breathing treatments as ordered.', 'all three: ' + n.o2Sentence({ o2: { liters: '2.5 L', sob: 'denies', tx: true } }));
ok(n.o2Sentence({ o2: { sob: 'reports' } }) === 'Pt reports shortness of breath.' && n.o2Sentence({ o2: { tx: true } }) === 'Continues breathing treatments as ordered.', 'each alone');
ok(n.o2Sentence({ o2: { liters: 'abc' } }) === '' && n.o2Sentence({}) === '' && n.o2Liters('200') === '', 'not a number = nothing written');
ok(n.guSentence({ gu: { denies: true } }) === 'Pt denies urinary complications.', 'denies urinary');
ok(n.guSentence({ gu: { sx: ['blood in urine', 'dysuria'] } }) === 'Pt complains of dysuria and blood in urine.', 'two complaints, in the list order');
ok(n.guSentence({ gu: { sx: ['dysuria', 'frequency', 'hesitancy', 'blood in urine'] } }) === 'Pt complains of dysuria, frequency, hesitancy and blood in urine.', 'four complaints');
ok(n.guSentence({ gu: { sx: ['dysuria'], denies: true } }) === 'Pt complains of dysuria.', 'a complaint is never written together with denies');
ok(n.guSentence({ gu: { cath: 'Foley', cathOk: true } }) === 'Foley catheter in place, denies any complications.' && n.guSentence({ gu: { cath: 'Suprapubic' } }) === 'Suprapubic catheter in place.', 'catheter');
ok(n.guSentence({ gu: { ostomy: 'Ileostomy' } }) === 'Ileostomy in place.' && n.guSentence({ gu: { ostomy: 'Bag' } }) === '', 'ostomy; an unknown value writes nothing');
const full = n.fullNote({ text, fields: {}, o2: { liters: '3', sob: 'denies', tx: true }, bm: { date: '2026-11-24', dos, how: 'both' }, gu: { denies: true, cath: 'Foley', cathOk: true, ostomy: 'Colostomy' } });
ok(full.includes('Pt denies breathing complications. Pt on 3 L O2. Pt denies shortness of breath. Continues breathing treatments as ordered. Pain 2/10.'), 'O2 follows the breathing sentence: ' + full);
ok(full.includes('Pt denies constipation. Last BM yesterday (11/24/26). Pt denies urinary complications. Foley catheter in place, denies any complications. Colostomy in place. Fair appetite'), 'BM, then urinary, catheter, ostomy after the constipation sentence');
ok(n.fullNote({ text, fields: {}, gu: { denies: true } }).includes('Pt denies constipation. Pt denies urinary complications. Fair appetite'), 'urinary with no BM day');
ok(n.fullNote({ text: 'Pt seen.', fields: {}, o2: { liters: '2' }, gu: { ostomy: 'Ostomy' } }) === 'Pt seen. Pt on 2 L O2. Ostomy in place.', 'no anchor sentence: at the end');
ok(n.fullNote({ text, fields: {} }) === text, 'nothing tapped = the note is unchanged');
// carried forward, then tapped again
const carried = n.carryForward(full, null, d.DEFAULT_SETTINGS).trim();
ok(carried.includes('Pt on 3 L O2.') && carried.includes('Foley catheter in place') && carried.includes('Colostomy in place.') && !/Last BM/.test(carried), 'carry forward keeps these sentences in the text (the BM day is dropped, as before)');
const again = n.fullNote({ text: carried, fields: {}, o2: { liters: '2' } });
ok(again.split('L O2.').length === 2 && again.includes('Pt on 2 L O2.') && again.includes('Pt denies shortness of breath.') && again.includes('Continues breathing treatments as ordered.'), 'liters tapped again: written once with today\'s number; the rest of the carried text stays');
const again2 = n.fullNote({ text: carried, fields: {}, gu: { sx: ['frequency'], cath: 'Suprapubic' }, o2: { sob: 'reports' } });
ok(again2.includes('Pt complains of frequency.') && !again2.includes('denies urinary') && again2.includes('Suprapubic catheter in place.') && !again2.includes('Foley') && again2.includes('Colostomy in place.')
  && again2.includes('Pt reports shortness of breath.') && !again2.includes('denies shortness'), 'urinary, catheter and SOB tapped again replace the carried ones; the ostomy sentence stays');
ok(n.fullNote({ text: carried, fields: {} }) === carried, 'carried text with nothing tapped is unchanged');
ok(n.stripRetapped('Pt on 2 L O2 via nasal cannula at night.', { o2: { liters: '3' } }) === 'Pt on 2 L O2 via nasal cannula at night.', 'a sentence you typed yourself is never taken out');
ok(n.saysNoBreathingTrouble(text) && n.saysNoBreathingTrouble('No breathing complications reported.') && !n.saysNoBreathingTrouble('Pt seen.'), 'the breathing sentence is recognised');
console.log(`logic 11-25: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
