// Made-up patients only. APP-11-27A: the loaded patients as a list to copy or save.
const n = await import('../../app/js/' + 'note.js');
const dx = await import('../../app/js/' + 'docx.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

const day = { date: '2026-11-27', building: 'b1', patients: [
  { last: 'Mouse', first: 'Mickey', mrn: '7961', room: 'Pod A 202 - 1', text: 'Seen.' },
  { last: 'Duck', first: 'Donald', mrn: '1111', room: '1 103 - A', text: '' },
  { last: 'Dog', first: 'Pluto', mrn: '7963', room: '', text: '' },
] };
let L = n.patientListLines(day, 'Test Hall', true);
ok(L.length === 4 && L[0] === 'Test Hall - 11/27/2026 - 3 patients', 'first line: building, date, how many');
ok(L[1] === '1. [202-1] Mouse, Mickey (7961):' && L[2] === '2. [103-A] Duck, Donald (1111):', 'with room: the lines read as on the phone');
ok(L[3] === '3. [ ] Dog, Pluto (7963):', 'a patient with no room gets an empty bracket; no room is made up');
ok(L.slice(1).every((x, i) => x === n.listLabel(day.patients[i], i)), 'each line is exactly the label shown in the list');
L = n.patientListLines(day, 'Test Hall', false);
ok(L[1] === '1. Mouse, Mickey (7961):' && L[3] === '3. Dog, Pluto (7963):', 'without room: the lines read as in the file sent to the computer');
ok(L.slice(1).every((x, i) => x === n.patientLabel(day.patients[i], i)), 'each line is exactly the label used in the sent file');
ok(n.patientListLines({ ...day, patients: day.patients.slice(0, 1) }, 'Test Hall')[0].endsWith('1 patient'), 'one patient: "1 patient"');
ok(n.patientListLines(day, '', true)[0] === '11/27/2026 - 3 patients', 'no building name: the date and count only');
const order = n.patientListLines({ ...day, patients: n.sortPatients(day.patients, 'name') }, 'Test Hall').slice(1).map((x) => x.split('] ')[1]);
ok(order.join('|') === 'Dog, Pluto (7963):|Duck, Donald (1111):|Mouse, Mickey (7961):', 'the list follows the order of the patients it is given, and the numbers follow');
ok(JSON.stringify(day.patients.map((p) => p.mrn)) === '["7961","1111","7963"]', 'making the list changes nothing in the day');
const bytes = dx.makeDocx(n.patientListLines(day, 'Test Hall'), { title: 'Patient list' });
const raw = new TextDecoder().decode(bytes);
ok(bytes[0] === 0x50 && bytes[1] === 0x4b && raw.includes('word/document.xml'), 'the Word file is a real .docx package');
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
