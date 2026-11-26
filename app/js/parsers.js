// Parsers for PointClickCare rosters and vitals lists.
// Input is plain text: a PDF text layer, pasted text, or OCR output (which is noisy).
// Everything here is pure so it can be tested in Node.

// OCR commonly swaps these characters for digits inside an MRN.
const DIGIT_LOOKALIKES = {
  O: '0', o: '0', D: '0', Q: '0',
  I: '1', l: '1', i: '1', '|': '1', '!': '1',
  Z: '2', z: '2',
  A: '4',
  S: '5', s: '5', $: '5',
  G: '6', b: '6',
  T: '7',
  B: '8',
  g: '9', q: '9', '%': '9',
};

const NAME_WORD = "[A-Za-z][A-Za-z'’\\-]+";
// "LAST, FIRST (MRN" with OCR slop: the comma may read as a period or vanish, parens as braces.
const ROSTER_ROW = new RegExp(
  `(${NAME_WORD})\\s*([,.;]?)\\s*(${NAME_WORD}(?:\\s+[A-Za-z]\\.?)?)\\s*[({\\[]\\s*([0-9A-Za-z%$|!]{2,12})\\s*[)}\\]]?`,
);
const DATE_TOKEN = /\d{1,4}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?/;

/** Turn an OCR'd MRN token into digits, or null if it doesn't look like one. */
export function normalizeMrn(token) {
  if (!token) return null;
  const raw = String(token).trim();
  const digits = (raw.match(/\d/g) || []).length;
  if (digits / raw.length < 0.5) return null;
  const out = raw.split('').map((c) => (/\d/.test(c) ? c : DIGIT_LOOKALIKES[c] ?? '?')).join('');
  return /^\d{3,10}$/.test(out) ? out : null;
}

// ===== APP-11-26A  START: an MRN read through a look-alike is never accepted silently =====
/**
 * One MRN token as OCR read it: { mrn: the digits, repaired: true when a letter or symbol had to be read as a digit,
 * raw: the token as read }. mrn is null when it does not look like an MRN at all.
 */
export function readMrn(token) {
  const raw = String(token ?? '').trim();
  const mrn = normalizeMrn(raw);
  return { mrn, repaired: !!mrn && !/^\d+$/.test(raw), raw };
}

const nameKey = (t) => String(t ?? '').toUpperCase().replace(/[^A-Z]/g, '');

/**
 * Check roster rows against a second source: the building's chart from the computer (its patients' names and MRNs).
 * Nothing is corrected from a guess. Each row gets:
 *   chart: 'match'  - this name and MRN are a patient in the chart (confirmed)
 *          'new'    - neither the name nor the MRN is in the chart
 *          'mrn'    - the name is in the chart with a different MRN
 *          'name'   - the MRN is in the chart under a different name
 *   and, for everything but 'match', a flag saying what was found.
 * A row whose photo gave two different MRNs is settled only when exactly one of the two is that same patient in the
 * chart - then that reading is used and the row says so.
 */
export function checkRoster(rows, chartPatients) {
  const list = (chartPatients || []).map((c) => {
    const [last, first = ''] = String(c.name ?? '').split(',');
    return { mrn: String(c.mrn ?? '').trim(), last: nameKey(last), first: nameKey(first.trim().split(/\s+/)[0]), shown: String(c.name ?? '').trim() };
  });
  const same = (c, r) => c.last === nameKey(r.last) && !!c.first && !!nameKey(r.first)
    && (c.first.startsWith(nameKey(r.first)) || nameKey(r.first).startsWith(c.first));
  return rows.map((r) => {
    const out = { ...r };
    const byName = list.filter((c) => same(c, r));
    const settled = (r.alts || []).filter((m) => byName.some((c) => c.mrn === m));
    if (r.alts && r.alts.length === 2 && r.alts[0] !== r.alts[1] && settled.length === 1) {
      out.mrn = settled[0];
      out.chart = 'match';
      out.flag = '';
      out.note = `the chart confirms ${settled[0]} (the photo also read ${r.alts.find((m) => m !== settled[0])})`;
      return out;
    }
    const byMrn = out.mrn ? list.filter((c) => c.mrn === out.mrn) : [];
    if (byMrn.some((c) => same(c, r))) {
      out.chart = 'match';
      out.flag = '';
      out.note = r.flag ? 'confirmed by the chart' : '';
    } else if (byMrn.length) {
      out.chart = 'name';
      out.flag = `MRN ${out.mrn} is ${byMrn[0].shown} in the chart - check the name and the MRN against the paper`;
    } else if (byName.length) {
      out.chart = 'mrn';
      out.flag = `the chart has MRN ${byName.map((c) => c.mrn).join(' or ')} for ${byName[0].shown}; this list reads ${out.mrn || 'no MRN'}${r.flag ? ` (${r.flag})` : ''}`;
    } else {
      out.chart = 'new';
      out.flag = r.flag ? `${r.flag}; not in the chart either` : 'not in the chart - a new patient? check the name and MRN against the paper';
    }
    return out;
  });
}
// ===== APP-11-26A  END =====

function titleCase(word) {
  if (word !== word.toUpperCase()) return word;
  return word.toLowerCase().replace(/(^|[\s\-'’])([a-z])/g, (m, p, c) => p + c.toUpperCase());
}

function cleanName(w) {
  return titleCase(w.replace(/[^A-Za-z'’\-. ]/g, '').trim());
}

/** The MRN column at the end of a roster row, scanning back until a date. APP-11-26A: returns readMrn's record. */
function trailingMrn(rest) {
  const tokens = rest.trim().split(/\s+/).reverse();
  for (const t of tokens) {
    if (DATE_TOKEN.test(t)) return null;
    const n = readMrn(t);
    if (n.mrn) return n;
    if (t.length >= 3 && /\d/.test(t)) return null; // garbled number: give up rather than guess
  }
  return null;
}

function roomFrom(rest) {
  const m = rest.match(/\b(?:Pod|Unit|Hall|Wing)\s+\w{1,3}\s+\d{2,4}\s*-\s*\w{1,2}\b/i)
    || rest.match(/\bRoom:?\s*\w+/i);
  return m ? m[0].replace(/\s+/g, ' ') : '';
}

/**
 * Parse a roster into [{last, first, mrn, room, flag}].
 * A row's MRN is read twice (in the parens and in the MRN column). When they disagree
 * the row is flagged for review and the likelier value is chosen.
 */
export function parseRoster(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (/medical professional|^\s*user:/i.test(line)) continue;
    const m = line.match(ROSTER_ROW);
    if (!m) continue;
    const rest = line.slice(m.index + m[0].length);
    const pRead = readMrn(m[4]); // APP-11-26A: keep how each MRN was read, not only its digits
    const cRead = trailingMrn(rest);
    const paren = pRead.mrn;
    const column = cRead ? cRead.mrn : null;
    // Without a comma or any MRN this is probably header noise, not a patient.
    if (!m[2] && !paren && !column) continue;
    rows.push({ last: cleanName(m[1]), first: cleanName(m[3]), paren, column, pRead, cRead, room: roomFrom(rest) });
  }

  // Typical MRN length, from rows where both readings agree.
  const lengths = rows.filter((r) => r.paren && r.paren === r.column).map((r) => r.paren.length);
  const typical = lengths.length ? mode(lengths) : null;

  const out = [];
  const seen = new Set();
  for (const r of rows) {
    let mrn = null;
    let flag = '';
    // APP-11-26A: a reading that needed a look-alike swapped for a digit ("8O94" -> 8094) stands only when the other
    // reading of the same row is plain digits and says the same; otherwise the row is flagged with what was read.
    const unclear = (x) => (x && x.repaired ? `"${x.raw}"` : '');
    if (r.paren && r.column) {
      if (r.paren === r.column) {
        mrn = r.paren;
        if (r.pRead.repaired && r.cRead.repaired) flag = `MRN had an unclear character in both places (read ${unclear(r.pRead)} and ${unclear(r.cRead)} as ${mrn})`;
      } else {
        const pOk = !typical || r.paren.length === typical;
        const cOk = !typical || r.column.length === typical;
        mrn = cOk || !pOk ? r.column : r.paren;
        flag = `MRN read as ${r.paren} and ${r.column}`;
      }
    } else {
      mrn = r.paren || r.column;
      const one = r.paren ? r.pRead : r.cRead;
      if (!mrn) flag = 'MRN not found';
      else if (one && one.repaired) flag = `MRN had an unclear character (read ${unclear(one)} as ${mrn})`;
      else if (typical && mrn.length !== typical) flag = 'MRN length looks wrong';
    }
    const key = mrn || `${r.last},${r.first}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ last: r.last, first: r.first, mrn: mrn || '', room: r.room, flag, alts: [r.paren, r.column].filter(Boolean) });
  }
  return out;
}

function mode(arr) {
  const counts = new Map();
  for (const x of arr) counts.set(x, (counts.get(x) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// ---------- Vitals ----------

const PATIENT_HEADER = new RegExp(
  `(?:Patient:\\s*)?(${NAME_WORD})\\s*[,.]\\s*(${NAME_WORD})\\s*[({\\[]\\s*([0-9A-Za-z%$|!]{2,12})\\s*[)}\\]]`,
  'g',
);

/** "1639" or "16:39" -> minutes after midnight. */
function toMinutes(hhmm) {
  if (!hhmm) return null;
  const m = String(hhmm).match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const h = +m[1];
  const min = +m[2];
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/**
 * Split a vitals list into one block per patient and pull the most recent reading of each vital.
 * PCC lists the newest reading first in both the one-line and the summary layouts.
 */
export function parseVitals(text) {
  const src = String(text).replace(/-\r?\n/g, '-'); // re-join words broken across lines
  const headers = [...src.matchAll(PATIENT_HEADER)];
  return headers.map((h, i) => {
    const block = src.slice(h.index + h[0].length, i + 1 < headers.length ? headers[i + 1].index : undefined);
    return {
      last: cleanName(h[1]),
      first: cleanName(h[2]),
      mrn: normalizeMrn(h[3]) || '',
      ...readVitals(block),
    };
  });
}

export function readVitals(block) {
  const v = {};

  // Blood sugar first, while times are still in the text (needed for fasting vs non-fasting).
  const bs = block.match(/(?:\b(\d{1,2}:\d{2})\s+)?(\d{2,3})\s*mg\/dL(?:\s*\((\d{3,4})\))?/i)
    || block.match(/\b(?:BS|FSBS|BG|Glucose|Blood Sugar)\b\D{0,6}(\d{2,3})(?:\s*\((\d{3,4})\))?/i);
  if (bs) {
    if (bs.length === 4) v.bs = { value: +bs[2], minutes: toMinutes(bs[3] || bs[1]) };
    else v.bs = { value: +bs[1], minutes: toMinutes(bs[2]) };
  }

  // Drop dates and clock times so they can't be mistaken for readings.
  const t = block
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ');

  const bp = t.match(/\b(\d{2,3})\s*\/\s*(\d{2,3})\b/);
  if (bp) v.bp = `${bp[1]}/${bp[2]}`;

  const hr = t.match(/\b(?:HR|Pulse|P)\s*:?\s*(\d{2,3})\b/) || t.match(/\b(\d{2,3})\s*bpm\b/i);
  if (hr) v.hr = +hr[1];

  const rr = t.match(/\b(?:RR|Resp(?:iration)?s?)\s*:?\s*(\d{1,2})\b/) || t.match(/\b(\d{1,2})\s*Breaths/i);
  if (rr) v.rr = +rr[1];

  const temp = t.match(/\b(?:Temp|T)\s*:?\s*(\d{2,3}(?:\.\d)?)\b/) || t.match(/\b(\d{2,3}(?:\.\d)?)\s*°?\s*F\b/);
  if (temp) v.temp = temp[1];

  const spo2 = t.match(/(\d{2,3})\s*%\s*(?:\(?\s*(RA|Room Air|[\d.]+\s*L[^)|,\n]*|NC|nasal cannula)\s*\)?)?/i);
  if (spo2) {
    const src = spo2[2] ? (/room air|^ra$/i.test(spo2[2].trim()) ? 'RA' : spo2[2].trim()) : '';
    v.spo2 = `${spo2[1]}%${src ? ' ' + src : ''}`;
  }
  return v;
}

/**
 * Fasting if the sugar was checked inside the morning window (default 04:00-09:00).
 * Returns 'fasting', 'non-fasting' or '' when the time is unknown.
 */
export function fastingLabel(minutes, start = '04:00', end = '09:00') {
  if (minutes == null) return '';
  const s = toMinutes(start);
  const e = toMinutes(end);
  return minutes >= s && minutes < e ? 'fasting' : 'non-fasting';
}

/** "BP 101/51, HR 82, RR 20, T 97.5, SpO2 92% RA, BS 304 non-fasting" */
export function formatVitals(v, opts = {}) {
  if (!v) return '';
  const parts = [];
  if (v.bp) parts.push(`BP ${v.bp}`);
  if (v.hr != null) parts.push(`HR ${v.hr}`);
  if (v.rr != null) parts.push(`RR ${v.rr}`);
  if (v.temp) parts.push(`T ${v.temp}`);
  if (v.spo2) parts.push(`SpO2 ${v.spo2}`);
  if (v.bs) {
    const label = fastingLabel(v.bs.minutes, opts.fastingStart, opts.fastingEnd);
    parts.push(`BS ${v.bs.value}${label ? ' ' + label : ''}`);
  }
  return parts.join(', ');
}

/**
 * Match vitals rows to roster patients: by MRN first, then by last name + first initial.
 * Returns [{patientIndex, vitals, how}] where how is 'mrn' | 'name' | 'mrn-name-mismatch'.
 */
export function matchVitals(patients, vitalsRows) {
  const out = [];
  for (const v of vitalsRows) {
    let idx = v.mrn ? patients.findIndex((p) => p.mrn === v.mrn) : -1;
    let how = 'mrn';
    if (idx >= 0 && patients[idx].last.toLowerCase() !== v.last.toLowerCase()) how = 'mrn-name-mismatch';
    if (idx < 0) {
      idx = patients.findIndex(
        (p) => p.last.toLowerCase() === v.last.toLowerCase() && p.first[0]?.toLowerCase() === v.first[0]?.toLowerCase(),
      );
      how = 'name';
    }
    out.push({ patientIndex: idx, vitals: v, how: idx < 0 ? 'none' : how });
  }
  return out;
}
