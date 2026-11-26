// Made-up data only. Pure logic of APP-11-25B (more O2 / bowel / urinary / catheter / ostomy choices, the Ordered button).
import * as n from '../../app/js/note.js';
import * as d from '../../app/js/defaults.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const text = "Pt assessed up in chair. Vital signs: denies HAs, dizziness or chest pain. Pt denies breathing complications. Pain 2/10. Pt denies constipation. Fair appetite, adequate fluids intake. Pt continues to work with therapy.";
const o2 = (o) => n.o2Sentence({ o2: o });
ok(o2({ liters: '2', via: 'nasal cannula', when: 'continuous' }) === 'Pt on 2 L O2 via nasal cannula, continuous.', 'liters + how + when: ' + o2({ liters: '2', via: 'nasal cannula', when: 'continuous' }));
ok(o2({ via: 'trach' }) === 'Pt on O2 via trach.' && o2({ liters: '3', when: 'at night only' }) === 'Pt on 3 L O2, at night only.' && o2({ when: 'as needed' }) === 'Pt on O2, as needed.', 'each part alone');
ok(o2({ room: true }) === 'Pt on room air.' && o2({ room: true, liters: '2' }) === 'Pt on room air.', 'room air');
ok(o2({ pap: 'CPAP' }) === 'Pt uses CPAP.' && o2({ pap: 'BiPAP', wean: true }) === 'Pt uses BiPAP. Weaning O2 as tolerated.', 'CPAP / BiPAP / weaning');
ok(o2({ cough: 'denies' }) === 'Pt denies cough.' && o2({ cough: 'dry' }) === 'Pt reports dry cough.' && o2({ cough: 'productive' }) === 'Pt reports productive cough.', 'cough');
ok(o2({ wheeze: 'denies' }) === 'Pt denies wheezing.' && o2({ wheeze: 'reports' }) === 'Pt reports wheezing.', 'wheezing');
ok(o2({ liters: '2', sob: 'denies', tx: true }) === 'Pt on 2 L O2. Pt denies shortness of breath. Continues breathing treatments as ordered.', 'the version 20 sentences are unchanged');
ok(o2({ liters: '4', via: 'mask', when: 'continuous', pap: 'CPAP', wean: true, sob: 'reports', cough: 'productive', wheeze: 'reports', tx: true })
  === 'Pt on 4 L O2 via mask, continuous. Pt uses CPAP. Weaning O2 as tolerated. Pt reports shortness of breath. Pt reports productive cough. Pt reports wheezing. Continues breathing treatments as ordered.', 'everything, in order');
const gu = (g) => n.guSentence({ gu: g });
ok(gu({ gi: ['bloating', 'nausea'] }) === 'Pt complains of nausea and bloating.', 'bowel complaints');
ok(gu({ sx: ['urgency', 'nocturia', 'urinary incontinence', 'urinary retention', 'flank pain'] }) === 'Pt complains of urgency, urinary incontinence, nocturia, urinary retention and flank pain.', 'the added urinary complaints');
ok(gu({ gi: ['vomiting'], denies: true, urine: 'cloudy' }) === 'Pt complains of vomiting. Pt denies urinary complications. Urine cloudy.', 'bowel, then urinary, then urine');
ok(gu({ urine: 'with sediment' }) === 'Urine with sediment.' && gu({ urine: 'clear' }) === 'Urine clear.', 'urine');
ok(gu({ cath: 'Nephrostomy', cathOk: true }) === 'Nephrostomy tube in place, denies any complications.' && gu({ cath: 'Condom' }) === 'Condom catheter in place.'
  && gu({ cath: 'Straight cath', cathOk: true }) === 'Straight catheterization as ordered, denies any complications.', 'the added catheters');
ok(gu({ cath: 'Foley', cathSx: ['pain', 'leaking'], cathOk: true }) === 'Foley catheter in place, complains of leaking and pain.', 'a catheter complaint is never written with "denies"');
ok(gu({ cath: 'Foley', cathOk: true, drain: true, trial: true }) === 'Foley catheter in place, denies any complications. Draining clear yellow urine. Voiding trial planned.', 'draining / voiding trial');
ok(gu({ drain: true, trial: true, cathSx: ['pain'] }) === '', 'catheter extras with no catheter picked write nothing');
ok(gu({ ostomy: 'Urostomy', ostOk: true, stoma: true, output: 'liquid', skin: 'intact' }) === 'Urostomy in place, denies any complications. Stoma pink and moist. Output liquid. Skin around stoma intact.', 'ostomy extras');
ok(gu({ ostomy: 'Colostomy', output: 'high output', skin: 'irritated' }) === 'Colostomy in place. High output. Skin around stoma irritated.' && gu({ stoma: true, output: 'formed' }) === '', 'high output / irritated; extras need the ostomy');
ok(gu({ peg: true }) === 'PEG tube in place.' && gu({ peg: true, pegOk: true }) === 'PEG tube in place, site clean and dry.' && gu({ pegOk: true }) === '', 'PEG tube');
ok(gu({ cath: 'Foley', cathOk: true }) === 'Foley catheter in place, denies any complications.' && gu({ ostomy: 'Ileostomy' }) === 'Ileostomy in place.', 'the version 20 sentences are unchanged');
// ordered
const ord = (r) => n.orderedSentence({ ordered: r });
ok(ord({ labs: ['BMP', 'CBC'] }) === 'Ordered CBC and BMP.' && ord({ tests: ['CXR'] }) === 'Ordered CXR.' && ord({}) === '', 'labs / one test / nothing');
ok(ord({ labs: ['CBC'], tests: ['KUB', 'CXR'], us: ['abdomen'], usOther: 'right upper quadrant.', dopSide: 'left', dopLimb: 'lower', other: 'EKG' })
  === 'Ordered CBC, CXR, KUB, ultrasound of abdomen, ultrasound of right upper quadrant, ultrasound doppler of left lower extremity and EKG.', 'everything: ' + ord({ labs: ['CBC'], tests: ['KUB', 'CXR'], us: ['abdomen'], usOther: 'right upper quadrant.', dopSide: 'left', dopLimb: 'lower', other: 'EKG' }));
ok(ord({ dopSide: 'bilateral', dopLimb: 'lower' }) === 'Ordered ultrasound doppler of bilateral lower extremities.' && ord({ dopSide: 'right', dopLimb: 'upper' }) === 'Ordered ultrasound doppler of right upper extremity.', 'doppler wording');
ok(ord({ dopSide: 'left' }) === '' && ord({ dopLimb: 'upper' }) === '', 'the doppler is written only when both the side and upper / lower are picked');
ok(d.ORDER_TESTS.includes('CXR') && d.ORDER_TESTS.includes('KUB') && d.ORDER_LABS.every((x) => !x.includes('.')), 'CXR and KUB are there; no lab name has a period in it');
const full = n.fullNote({ text, fields: { labs: 'Labs reviewed' }, ordered: { labs: ['CBC', 'BMP'], tests: ['CXR'] } });
ok(full.endsWith('therapy. Labs reviewed. Ordered CBC, BMP and CXR.'), 'the Ordered sentence is at the end, after Labs reviewed: ' + full.slice(-70));
ok(d.DETAILS.findIndex((x) => x.key === 'ordered') === d.DETAILS.findIndex((x) => x.key === 'labs') + 1, 'the Ordered button sits right after Labs');
const cf = n.carryForward(full, null, d.DEFAULT_SETTINGS).trim();
ok(!/Ordered/.test(cf) && cf.endsWith('Labs reviewed.'), 'yesterday\'s Ordered sentence is not carried into today: ' + cf.slice(-50));
ok(/He ordered soup\./.test(n.carryForward('Pt seen. He ordered soup. Fine.', null, d.DEFAULT_SETTINGS)), 'a sentence that only has the word "ordered" in it is kept');
// carried text, tapped again
const y = n.fullNote({ text, fields: {}, o2: { liters: '2', via: 'nasal cannula', when: 'continuous', cough: 'dry' }, gu: { gi: ['nausea'], cath: 'Foley', cathOk: true, drain: true, ostomy: 'Colostomy', output: 'formed', peg: true, pegOk: true } });
const c = n.carryForward(y, null, d.DEFAULT_SETTINGS).trim();
ok(c.includes('Pt on 2 L O2 via nasal cannula, continuous.') && c.includes('Output formed.') && c.includes('PEG tube in place, site clean and dry.'), 'these sentences are carried in the text');
const t2 = n.fullNote({ text: c, fields: {}, o2: { room: true, cough: 'denies' }, gu: { cath: 'Suprapubic', cathSx: ['blockage'], ostomy: 'Colostomy', output: 'liquid' } });
ok(t2.includes('Pt on room air.') && !t2.includes('nasal cannula') && t2.includes('Pt denies cough.') && !t2.includes('dry cough'), 'room air and cough tapped today replace the carried ones');
ok(t2.includes('Suprapubic catheter in place, complains of blockage.') && !t2.includes('Foley') && !t2.includes('Draining clear yellow urine') && t2.includes('Output liquid.') && !t2.includes('Output formed')
  && t2.split('Colostomy in place.').length === 2, 'catheter and ostomy tapped today replace the carried ones, each written once');
ok(t2.includes('Pt complains of nausea.') && t2.includes('PEG tube in place, site clean and dry.'), 'what was not tapped today (bowel complaint, PEG) stays as carried');
ok(n.fullNote({ text: c, fields: {} }) === c, 'carried text with nothing tapped is unchanged');
console.log(`logic 11-25B: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
