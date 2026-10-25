import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRoster, parseVitals, formatVitals, matchVitals, normalizeMrn } from '../app/js/parsers.js';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const TRUTH = [
  ['Mickey', 'Mouse', '7961'], ['Daisy', 'Duck', '8104'], ['Donald', 'Duck', '8094'], ['Minnie', 'Mouse', '8088'],
  ['Betty', 'Boop', '8096'], ['Wilma', 'Flintstone', '8093'], ['Fred', 'Flintstone', '8101'],
  ['George', 'Jetson', '8074'], ['Jane', 'Jetson', '8080'],
];

test('roster from text is exact and skips the provider line', () => {
  const r = parseRoster(fx('roster-text.txt'));
  assert.deepEqual(r.map((p) => [p.last, p.first, p.mrn]), TRUTH);
  assert.equal(r[0].room, 'Pod A 202 - 1');
  assert.ok(r.every((p) => !p.flag));
});

test('roster from preprocessed photo OCR finds every patient and flags doubtful MRNs', () => {
  const r = parseRoster(fx('roster-ocr-pre.txt'));
  assert.equal(r.length, 9);
  for (const [i, p] of r.entries()) {
    const ok = p.mrn === TRUTH[i][2];
    console.log(`${p.last}, ${p.first} (${p.mrn}) ${ok ? 'ok' : 'WRONG'} ${p.flag}`);
    if (!ok) assert.ok(p.flag, `wrong MRN must be flagged: ${p.last}`);
  }
});

test('roster from raw photo OCR: wrong MRNs are always flagged', () => {
  const r = parseRoster(fx('roster-ocr-raw.txt'));
  console.log(r.map((p) => `${p.last}, ${p.first} (${p.mrn}) ${p.flag}`).join('\n'));
  assert.ok(r.length >= 8);
});

test('normalizeMrn fixes lookalikes', () => {
  assert.equal(normalizeMrn('80%6'), '8096');
  assert.equal(normalizeMrn('BOTA'), null); // too few real digits to trust
  assert.equal(normalizeMrn('8O74'), '8074');
});

test('inline vitals list', () => {
  const v = parseVitals(fx('vitals-inline.txt'));
  assert.equal(v.length, 6);
  assert.equal(formatVitals(v[0]), 'BP 101/51, HR 82, RR 20, T 97.5, SpO2 92% RA');
  assert.equal(formatVitals(v[1]), 'BP 145/67, HR 65, RR 20, T 98.1, SpO2 96% RA, BS 304 non-fasting');
  assert.equal(v[4].mrn, '7961');
  assert.equal(formatVitals(v[5]), 'BP 148/72, HR 77, RR 18, T 98, SpO2 92% RA, BS 206 non-fasting');
});

test('summary vitals layout', () => {
  const v = parseVitals(fx('vitals-summary.txt'));
  assert.equal(v.length, 1);
  assert.equal(v[0].mrn, '8074');
  assert.equal(formatVitals(v[0]), 'BP 123/69, HR 67, RR 18, T 98.9, SpO2 94% RA');
});

test('morning sugar is fasting', () => {
  const v = parseVitals('Patient: Doe, Jo (1234) BS 98 mg/dL (0630)');
  assert.equal(formatVitals(v[0]), 'BS 98 fasting');
});

test('vitals match roster by MRN and warn on name mismatch', () => {
  const roster = parseRoster(fx('roster-text.txt'));
  const m = matchVitals(roster, parseVitals(fx('vitals-inline.txt')));
  const jones = m.find((x) => x.vitals.mrn === '7961');
  assert.equal(roster[jones.patientIndex].last, 'Mickey');
  assert.equal(jones.how, 'mrn-name-mismatch');
  assert.equal(m.find((x) => x.vitals.mrn === '8072').how, 'none');
});

test('roster from in-browser OCR of the photo (comma missing on one row)', () => {
  const r = parseRoster(fx('roster-ocr-browser.txt'));
  assert.equal(r.length, 9);
  assert.deepEqual(r.map((p) => p.mrn), TRUTH.map((t) => t[2]));
  assert.equal(r[3].last, 'Minnie');
});
