// Made-up data only. APP-11-26G: rooms from the PCC download's own columns, and a Word roster with one cell per line.
const p = await import('../../app/js/' + 'parsers.js');
const n = await import('../../app/js/' + 'note.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

const pdf = `Date: Nov 26, 2026 Test Hall Health and Rehabilitation
Time: 10:30:31 MT Medical Professional
User: Donald Duck Page # 1
Medical Professional: Duck, Donald
Name Location Birth Date
MOUSE, MICKEY (7961) 1 103 - A 3/8/1930 11/18/2026 7961
MOUSE, MINNIE (7962) 1 01 - 2 12/28/1931 11/15/2026 7962
DOG, PLUTO Jr (7963) Pod A 202 - 1 9/3/1936 10/31/2026 7963
GOOF, GOOFY (7964) 114 - B 4/24/1932 10/1/2026 7964
DUCK, DAISY (7965) 4/24/1940 10/1/2026 7965
5 resident(s)`;
let r = p.parseRoster(pdf);
ok(r.length === 5, 'five patients, and the medical professional is not one of them');
ok(r[0].room === '1 103 - A' && n.roomTag(r[0]) === '[103-A]' && n.roomParts(r[0].room).unit === '1', 'a bare-number unit: 1 103 - A');
ok(r[1].room === '1 01 - 2' && n.roomTag(r[1]) === '[01-2]', 'the room is kept as written (01, not 1)');
ok(r[2].room === 'Pod A 202 - 1' && n.roomTag(r[2]) === '[202-1]', 'Pod A still reads as before');
ok(r[3].room === '114 - B' && n.roomParts(r[3].room).unit === '', 'no unit column: room and bed only');
ok(r[4].room === '' && n.roomTag(r[4]) === '[ ]', 'no room in the file: none is made up');
ok(r.every((x) => !x.flag && x.alts.length === 2), 'both MRN readings found and agreeing on every row');
ok(r.map((x) => x.mrn).join() === '7961,7962,7963,7964,7965', 'MRNs unchanged');

const docx = `Date:  Nov 26, 2026\n\nTest Hall\n\nMedical Professional\n\nName\n\nLocation\n\nBirth Date\n\nAdmission Date\n\nNumber\n\nDUCK, DONALD\n\n
MOUSE, MICKEY (7961)\n\nPod A 202 - 1\n\n3/8/1930\n\n11/18/2026\n\n7961\n\nMOUSE, MINNIE (7962)\n\nPod B 114 - 2\n\n12/28/1931\n\n11/15/2026\n\n7962\n\nDOG, PLUTO (7963)\n\nPod B 115 - 1\n\n9/3/1936\n\n10/31/2026\n\n7963\n\n3 resident(s)\n`;
r = p.parseRoster(docx);
ok(r.length === 3, 'Word roster: three patients');
ok(r.map((x) => n.roomTag(x)).join() === '[202-1],[114-2],[115-1]', 'Word roster: rooms come from the next cell');
ok(r.every((x) => !x.flag && x.alts.length === 2 && x.alts[0] === x.alts[1]), 'Word roster: the MRN column is read as the second reading');
ok(r[2].mrn === '7963', 'the "3 resident(s)" line is not taken as the last patient\'s MRN');

// a cell missing: nothing from the next patient or the footer is pulled in
r = p.parseRoster('MOUSE, MICKEY (7961)\n\nMOUSE, MINNIE (7962)\n\nPod B 114 - 2\n\n12/28/1931\n\n11/15/2026\n\n7962\n\n2 resident(s)');
ok(r.length === 2 && r[0].room === '' && r[1].room === 'Pod B 114 - 2' && !r[0].flag, 'a row with no cells after it keeps no room');
// the photo layout is unchanged
r = p.parseRoster('MOUSE, MICKEY (7961) Pod A 202 - 1 3/8/1930 7961');
ok(r[0].room === 'Pod A 202 - 1', 'the earlier layout reads the same');
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
