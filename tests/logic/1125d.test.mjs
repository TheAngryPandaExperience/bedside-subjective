// Made-up data only. Pure logic of APP-11-25D (edema for each leg).
import * as n from '../../app/js/note.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const e = (x) => n.edemaExam({ edema: x });
ok(e({ left: '2+', right: 'none' }) === '2+ left lower leg edema, no right lower leg edema', 'one leg 2+, the other none: ' + e({ left: '2+', right: 'none' }));
ok(e({ left: 'none', right: '1+' }) === 'No left lower leg edema, 1+ right lower leg edema', 'none left, 1+ right');
ok(e({ left: '3+', right: 'trace' }) === '3+ left lower leg edema, trace right lower leg edema', '3+ and trace');
ok(e({ left: '2+', right: '2+' }) === '2+ bilateral lower leg edema' && e({ left: 'none', right: 'none' }) === 'No lower leg edema' && e({ left: 'trace', right: 'trace' }) === 'Trace bilateral lower leg edema', 'the same on both legs is written the way the old buttons wrote it');
ok(e({ left: '4+' }) === '4+ left lower leg edema' && e({ right: 'none' }) === 'No right lower leg edema' && e({}) === '', 'one leg picked = that leg only; nothing picked = nothing');
ok(e({ left: '2+', right: 'none', kind: 'pitting' }) === '2+ pitting left lower leg edema, no right lower leg edema', 'pitting is written on the leg that has edema only');
ok(e({ left: '1+', right: '1+', kind: 'non-pitting' }) === '1+ non-pitting bilateral lower leg edema', 'non-pitting, both legs');
ok(e({ left: '5+', right: 'lots' }) === '', 'an unknown grade writes nothing');
const ex = (p) => JSON.stringify(n.examLines(p));
ok(ex({ edema: { left: '2+', right: 'none' } }) === JSON.stringify(['Exam: Ext: 2+ left lower leg edema, no right lower leg edema']), 'alone, it is the Ext exam line');
ok(ex({ exam: { Ext: 'Pedal pulses palpable' }, edema: { left: '1+', right: 'trace' } }) === JSON.stringify(['Exam: Ext: Pedal pulses palpable. 1+ left lower leg edema, trace right lower leg edema']), 'with typed Ext text, it follows it on the Ext line');
ok(ex({ exam: { Ext: '1+ bilateral lower leg edema', Skin: 'Warm, dry, intact' } }) === JSON.stringify(['Exam: Ext: 1+ bilateral lower leg edema', 'Exam: Skin: Warm, dry, intact']), 'no by-leg grade = the exam lines are as before');
console.log(`logic 11-25D: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
