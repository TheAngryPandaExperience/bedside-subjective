// Made-up data only. APP-11-26D: long-standing settings carried to the next day, to be confirmed.
import * as n from '../../app/js/note.js';
import * as d from '../../app/js/defaults.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const text = "Pt assessed up in chair. Pt denies breathing complications. Pain 2/10. Pt denies constipation. Pt continues to work with therapy.";
const y = { text, fields: {}, o2: { liters: '2', via: 'nasal cannula', when: 'continuous', pap: 'CPAP', sob: 'denies', cough: 'dry', wheeze: 'denies', tx: true, wean: true },
  gu: { denies: true, gi: ['nausea'], urine: 'clear', cath: 'Foley', cathOk: true, drain: true, trial: true, ostomy: 'Colostomy', ostOk: true, stoma: true, output: 'formed', skin: 'intact', peg: true, pegOk: true } };
const st = n.standingState(y);
ok(JSON.stringify(st) === JSON.stringify({ o2: { liters: '2', via: 'nasal cannula', when: 'continuous', pap: 'CPAP' }, gu: { cath: 'Foley', ostomy: 'Colostomy', peg: true } }),
  'only the oxygen set-up, catheter, ostomy and PEG tube are long-standing: ' + JSON.stringify(st));
ok(n.standingText(st) === 'Pt on 2 L O2 via nasal cannula, continuous. Pt uses CPAP. Foley catheter in place. Colostomy in place. PEG tube in place.', 'what they write: ' + n.standingText(st));
ok(n.standingState({ o2: { sob: 'reports', cough: 'dry' }, gu: { denies: true, sx: ['dysuria'] } }) === null && n.standingState({}) === null, 'symptoms alone carry nothing');
ok(JSON.stringify(n.standingState({ o2: { room: true } })) === '{"o2":{"room":true}}', 'room air is a set-up too');
// today's note: yesterday's text carried, the settings copied in, waiting for a look
const carried = n.carryForward(n.fullNote(y), null, d.DEFAULT_SETTINGS).trim();
const today = { text: carried, fields: {}, o2: { ...st.o2 }, gu: { ...st.gu }, carriedSet: { from: '2026-11-25', o2: Object.keys(st.o2), gu: Object.keys(st.gu) } };
const full = n.fullNote(today);
ok(full.split('L O2').length === 2 && full.split('Foley catheter').length === 2 && full.split('Colostomy in place').length === 2 && full.split('PEG tube').length === 2, 'each carried setting is written once (not once from the text and once from the setting)');
ok(full.includes('Foley catheter in place.') && !full.includes('Foley catheter in place, denies any complications') && !full.includes('Draining clear yellow urine') && !full.includes('Voiding trial'),
  'yesterday\'s catheter findings are not carried with the catheter');
ok(full.includes('Colostomy in place.') && !/Stoma pink|Output formed|Skin around stoma/.test(full) && full.includes('PEG tube in place.') && !full.includes('site clean and dry'), 'nor yesterday\'s ostomy and PEG findings');
ok(n.standingText(n.pendingStanding(today)) === n.standingText(st), 'everything carried is waiting to be confirmed');
ok(n.pendingStanding({ ...today, carriedSet: { from: '2026-11-25', o2: [], gu: ['cath'] } }).gu.cath === 'Foley' && !n.pendingStanding({ ...today, carriedSet: { from: '2026-11-25', o2: [], gu: ['cath'] } }).o2, 'a part you set yourself today is no longer waiting');
ok(n.pendingStanding({ ...today, carriedSet: undefined }) === null && n.pendingStanding({ text, fields: {}, carriedSet: { from: 'x', o2: ['liters'], gu: [] } }) === null, 'confirmed, or removed: nothing waiting');
// removed: the carried sentences leave the text too
const removed = n.stripRetapped(carried, today).trim();
ok(!/L O2|CPAP|Foley|Colostomy|PEG tube/.test(removed) && removed.includes('Pt denies breathing complications.') && removed.includes('Pt complains of nausea.'), 'Remove takes those sentences out of the carried text and leaves the rest: ' + removed.slice(-120));
console.log(`logic 11-26D: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
