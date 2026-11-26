// Made-up data only. Pure logic of APP-11-25C (surgical incision under Skin).
import * as n from '../../app/js/note.js';
import * as d from '../../app/js/defaults.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const text = "Pt assessed up in chair. Pain 2/10. Pt continues to work with therapy.";
const ex = (p) => n.examLines(p);
ok(n.incisionExam({ incision: { side: 'right', site: 'hip', state: 'intact' } }) === 'Surgical incision to right hip dry and intact.', 'dry and intact, with where');
ok(n.incisionExam({ incision: { site: 'abdomen', state: 'dressing' } }) === 'Surgical site to abdomen covered with dressing.', 'covered with dressing, no side');
ok(n.incisionExam({ incision: { state: 'intact' } }) === 'Surgical incision dry and intact.' && n.incisionExam({ incision: { side: 'left', site: 'knee' } }) === '', 'no site = no "to ..."; no finding = no exam line');
ok(n.incisionExam({ incision: { side: 'midline', siteOther: 'lumbar spine.', site: 'back', state: 'intact' } }) === 'Surgical incision to midline lumbar spine dry and intact.', 'a typed site is used');
ok(JSON.stringify(ex({ incision: { side: 'right', site: 'hip', state: 'intact' } })) === JSON.stringify(['Exam: Skin: Surgical incision to right hip dry and intact.']), 'alone, it is the Skin exam line');
ok(JSON.stringify(ex({ exam: { Skin: 'Warm, dry', Resp: 'Clear' }, incision: { site: 'knee', side: 'left', state: 'dressing' } }))
  === JSON.stringify(['Exam: Resp: Clear', 'Exam: Skin: Warm, dry. Surgical site to left knee covered with dressing.']), 'with a Skin finding, it follows it on the same line');
ok(JSON.stringify(ex({ exam: { Skin: 'Warm, dry.' }, incision: { state: 'intact' } })) === JSON.stringify(['Exam: Skin: Warm, dry. Surgical incision dry and intact.']), 'no doubled period');
ok(JSON.stringify(ex({ exam: { Resp: 'Clear' } })) === JSON.stringify(['Exam: Resp: Clear']) && ex({ incision: { act: 'Assessed incision', site: 'hip' } }).length === 0, 'no incision finding = the exam lines are as before');
ok(n.incisionSubjective({ incision: { act: 'Visualized incision', side: 'right', site: 'hip' } }) === 'Visualized incision to right hip.' && n.incisionSubjective({ incision: { act: 'Assessed incision' } }) === 'Assessed incision.', 'the note-text sentence');
const full = n.fullNote({ text, fields: { labs: 'Labs reviewed' }, incision: { act: 'Assessed incision', side: 'left', site: 'knee', state: 'intact' } });
ok(full === text + ' Assessed incision to left knee. Labs reviewed.', 'it goes in the note text, before Labs reviewed: ' + full.slice(-60));
ok(!full.includes('dry and intact'), 'the finding itself stays out of the note text (it is an exam line)');
ok(n.fullNote({ text, fields: {}, incision: { side: 'left', site: 'knee', state: 'intact' } }) === text, 'a finding with no "add to the note" button leaves the note text alone');
const cf = n.carryForward(full, null, d.DEFAULT_SETTINGS).trim();
ok(!/incision/.test(cf) && cf.endsWith('Labs reviewed.'), 'yesterday\'s "Assessed incision" sentence is not carried into today');
ok(/The incision was assessed by the surgeon\./.test(n.carryForward('Pt seen. The incision was assessed by the surgeon. Fine.', null, d.DEFAULT_SETTINGS)), 'a sentence you typed about the incision is kept');
console.log(`logic 11-25C: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
