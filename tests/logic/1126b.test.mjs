// Made-up data only. APP-11-26B: things in one note that do not fit together (report only).
import * as n from '../../app/js/note.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const base = "Pt assessed up in chair. Vital signs: pt denies HAs, chest pain or dizziness. Pt denies breathing complications. Pain 2/10. Pt denies constipation. Fair appetite, adequate fluids intake. Pt continues to work with therapy.";
const c = (p) => n.noteClashes({ fields: {}, text: base, ...p });
const whats = (p) => c(p).map((x) => x.what).sort().join(',');
ok(c({}).length === 0, 'the plain template has nothing to report: ' + JSON.stringify(c({})));
let r = c({ o2: { sob: 'reports' } });
ok(r.length === 1 && r[0].what === 'breathing' && r[0].a === 'Pt denies breathing complications.' && r[0].b === 'Pt reports shortness of breath.', 'denies breathing complications + reports shortness of breath, both word for word');
ok(whats({ o2: { wheeze: 'reports' } }) === 'breathing' && whats({ o2: { sob: 'denies', wheeze: 'denies', cough: 'denies' } }) === '', 'reports wheezing clashes; all denied does not');
ok(whats({ o2: { cough: 'productive' } }) === '' && whats({ text: base + ' No cough reported overnight.', o2: { cough: 'dry' } }) === 'cough'
  && whats({ text: base + ' Pt denies cough.', o2: { cough: 'dry' } }) === '', 'a cough alone is not a breathing complication; typed "No cough reported" + "reports dry cough" is; the app\'s own carried "Pt denies cough." is replaced, so no clash');
ok(whats({ gu: { denies: true, cath: 'Foley', cathSx: ['hematuria'] } }) === 'urinary', 'denies urinary complications + catheter complaint of hematuria');
ok(whats({ gu: { denies: true, cath: 'Foley', cathOk: true } }) === '' && whats({ gu: { sx: ['dysuria'] } }) === '', 'no clash when nothing is contradicted');
ok(whats({ text: base + ' Pt complains of constipation.' }) === 'constipation' && whats({ text: base + ' Pt c/o dizziness.' }) === 'dizziness', 'typed text is read too: constipation, dizziness');
ok(whats({ text: 'Pt denies chest pain but reports dizziness.' }) === '' && whats({ text: 'Pt denies chest pain but reports dizziness. Pt denies dizziness.' }) === 'dizziness', 'a sentence with "denies X but reports Y" is read as two halves');
ok(whats({ text: 'Pt denies pain. Pain 6/10.' }) === 'pain' && whats({ text: 'Pt denies pain. Pain 0/10.' }) === '' && whats({ text: 'Pt denies chest pain. Pain 6/10.' }) === '', 'denies pain against a pain score above 0; chest pain is not "pain"');
ok(whats({ text: base + ' Pt denies nausea.', gu: { gi: ['nausea', 'bloating'] } }) === 'nausea or vomiting', 'denies nausea + complains of nausea');
ok(whats({ exam: { Skin: 'Warm, dry, intact' }, incision: { site: 'hip', state: 'intact' } }) === 'skin' && whats({ exam: { Skin: 'Warm, dry' }, incision: { site: 'hip', state: 'intact' } }) === '', 'Skin written as intact with a surgical incision recorded');
ok(whats({ exam: { Resp: 'Clear, no wheezes' }, o2: { wheeze: 'reports' } }).includes('wheezing'), 'exam says clear, patient reports wheezing');
ok(whats({ exam: { Ext: 'No edema, pulses palpable' }, edema: { left: '2+', right: 'none' } }) === 'edema' && whats({ exam: { Ext: 'Pulses palpable' }, edema: { left: '2+' } }) === '', 'typed "No edema" with a grade picked for a leg');
ok(whats({ incision: { act: 'Visualized incision', state: 'dressing', site: 'knee' } }) === 'incision' && whats({ incision: { act: 'Assessed incision', state: 'dressing' } }) === '', 'visualized + covered with dressing');
ok(whats({ text: base + ' Pt on 2 L via nasal cannula at night.', o2: { room: true } }) === 'oxygen' && whats({ text: base + ' Remains on room air at rest.', o2: { liters: '2' } }) === 'oxygen', 'room air against liters, either way round');
const before = JSON.stringify({ text: base, o2: { sob: 'reports' } });
const pp = JSON.parse(before); pp.fields = {}; n.noteClashes(pp);
ok(pp.text === base && JSON.stringify(pp.o2) === '{"sob":"reports"}', 'the check changes nothing in the note');
console.log(`logic 11-26B: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
