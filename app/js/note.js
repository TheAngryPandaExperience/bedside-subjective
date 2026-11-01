// Pure note logic: template filling, shortcut expansion, daily summary and send log.

import { formatVitals } from './parsers.js';
import { DETAILS } from './defaults.js';

const joinAnd = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

/** "Pain 6/10 to right knee and hip, aching" (no final period), or '' when pain was skipped. */
export function painPhrase(p) {
  if (p.pain == null) return '';
  const sites = p.painSite || [];
  const types = p.painType || [];
  let s = `Pain ${p.pain}/10`;
  if (sites.length) s += ` to ${p.painSide ? `${p.painSide} ` : ''}${joinAnd(sites)}`;
  if (types.length) s += `, ${joinAnd(types)}`;
  return s;
}

/** Fill the template for one patient. Pain null = skipped (the pain sentence is dropped). */
export function renderTemplate(settings, { locationText, pain, vitals, painText }) {
  const vit = formatVitals(vitals, settings);
  let t = settings.template;
  if (pain == null) t = t.replace(/Pain \{pain\}\/10\.\s*/, '');
  else if (painText) t = t.replace('Pain {pain}/10', painText);
  return t
    .replace('{location}', locationText || '')
    .replace('{vitals}', vit ? `${vit}; ` : ' ')
    .replace('{pain}', pain ?? '')
    .replace(/^\s+/, '');
}

/**
 * If the word just before the cursor is a shortcut, return the replacement.
 * `before` is the text up to the cursor, ending with the space or punctuation just typed.
 */
export function expandShortcut(before, phrases) {
  const m = before.match(/(^|\s)(\S+)([\s,;:])$/);
  if (!m) return null;
  const word = m[2];
  const hit = phrases.find((p) => p.key === word) || phrases.find((p) => p.key.toLowerCase() === word.toLowerCase());
  if (!hit) return null;
  const start = before.length - word.length - 1;
  return { start, end: before.length, text: hit.text + m[3] };
}

export function patientLabel(p, i) {
  return `${i + 1}. ${p.last}, ${p.first} (${p.mrn}):`;
}

function sentence(s) {
  const t = String(s).trim().replace(/[.\s]+$/, '');
  return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : '';
}

/**
 * A number or range typed or tapped for a detail, without its unit: "50", "50-75", "50 to 75%" -> "50-75".
 * '' when the value is anything else.
 */
export function numberValue(v, unit = '') {
  const u = unit ? `(?:\\s*${unit})?` : '';
  const m = String(v).trim().match(new RegExp(`^(\\d+(?:\\.\\d+)?)${u}(?:\\s*(?:-|–|to)\\s*(\\d+(?:\\.\\d+)?)${u})?$`, 'i'));
  if (!m) return '';
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

/** The quick details as { key: sentence }. Empty ones are left out. */
function detailMap(p) {
  const f = p.fields || {};
  const out = {};
  for (const d of DETAILS) {
    if (d.key === 'pain') {
      // Pain normally lives in the template sentence; add it here only if the note has none.
      if (p.pain != null && !/Pain \d+\/10/.test(p.text || '')) out.pain = `${painPhrase(p)}.`;
      continue;
    }
    if (d.key === 'abx') {
      // Antibiotic sentences are worked out by the app for the date of service (see abxSentences).
      if (p.abx?.length) out.abx = p.abx.join(' ');
      continue;
    }
    let v = String(f[d.key] ?? '').trim();
    if (!v) continue;
    const num = numberValue(v, d.unit);
    if (d.quote) out[d.key] = `Pt states "${v.replace(/^"|"$/g, '')}".`;
    else if (d.presets.includes(v)) out[d.key] = sentence(v);
    else if (d.numberText && num) out[d.key] = sentence(d.numberText(num));
    else {
      // Typed text for a % detail: put a % after each bare number ("ate 50 of lunch" -> "ate 50% of lunch").
      if (d.unit === '%') v = v.replace(/(\d+(?:\.\d+)?)(?!\s*%|[\d.])/g, '$1%');
      out[d.key] = sentence(d.prefix + v);
    }
  }
  return out;
}

/** The quick details as sentences, in the order of DETAILS. */
export function detailSentences(p) {
  return Object.values(detailMap(p));
}

// Insert `add` right after the first match of `re` in `text`; null if there is no match.
function insertAfter(text, re, add) {
  const m = re.exec(text);
  if (!m) return null;
  const at = m.index + m[0].length;
  return `${text.slice(0, at)} ${add}${text.slice(at)}`;
}

/**
 * The note as it goes out, with each quick detail in its place:
 * overnight, nursing and new after the first sentence (where the patient was assessed);
 * meal % after the appetite sentence; therapy after the therapy sentence; anything else at the end.
 * If the anchor sentence was edited away, that detail goes at the end.
 */
export function fullNote(p) {
  const d = detailMap(p);
  let text = String(p.text || '').trim();
  const tail = [];
  const place = (keys, re) => {
    const add = keys.map((k) => d[k]).filter(Boolean).join(' ');
    if (!add) return;
    const next = text ? insertAfter(text, re, add) : null;
    if (next == null) tail.push(add); else text = next;
  };
  place(['overnight', 'nursing', 'new'], /^[^.!?]*[.!?]/);
  place(['meal'], /\b(?:good|fair|poor)\s+appetite[^.]*\./i);
  place(['therapy'], /\b(?:continues to work with|working with|participat\w* (?:in|with)) therapy[^.]*\./i);
  for (const k of ['pain', 'abx', 'said']) if (d[k]) tail.push(d[k]);
  if (tail.length && text && !/[.!?"]$/.test(text)) text += '.';
  return [text, ...tail].filter(Boolean).join(' ');
}

/**
 * Yesterday's note as a start for today: the vitals are swapped for today's (or left blank),
 * since old readings must never be carried into a new note. Everything else is kept to edit.
 */
export function carryForward(lastNote, todayVitals, settings) {
  const vit = formatVitals(todayVitals, settings);
  return stripAbx(String(lastNote)).trim().replace(/Vital signs:.*?(?=\bdenies\b)/i, `Vital signs: ${vit ? `${vit}; ` : ' '}`) + ' ';
}

// ---------- antibiotics ----------
// A course: { id, drug, route: 'oral' | 'IV', start: 'YYYY-MM-DD', days: 14 (or 0 = length not set),
//   added: date of service it was entered on, stopped?: { date, reason: 'discontinued' | 'completed' | 'changed' } }

const dayNo = (iso) => Math.round(Date.UTC(...iso.split('-').map((x, i) => +x - (i === 1 ? 1 : 0))) / 86400000);

/** Day number of the course on `date` (start date = day 1). */
export function abxDayNumber(c, date) {
  return dayNo(date) - dayNo(c.start) + 1;
}

/** "2026-11-11": the last day of the course, or '' when no length is set. */
export function abxEndDate(c) {
  if (!c.days) return '';
  return new Date((dayNo(c.start) + c.days - 1) * 86400000).toISOString().slice(0, 10);
}

/** The drug's name for the note: "Ceftriaxone (Rocephin)" -> "Ceftriaxone". */
export const abxName = (drug) => String(drug).replace(/\s*\(.*\)\s*$/, '').trim();

/** What the course means on `date`: 'before', 'active', 'stopping' (stopped that day), or 'ended'. */
export function abxState(c, date) {
  const n = abxDayNumber(c, date);
  if (n < 1) return 'before';
  if (c.stopped) {
    if (date === c.stopped.date) return 'stopping';
    if (date > c.stopped.date) return 'ended';
  }
  if (c.days && n > c.days) return 'ended';
  return 'active';
}

/** The note sentences for a patient's courses on one date of service. */
export function abxSentences(courses, date) {
  const out = [];
  for (const c of courses || []) {
    if (c.added && date < c.added) continue; // don't change notes from before it was entered
    const state = abxState(c, date);
    const what = `${c.route} ${abxName(c.drug)}`;
    if (state === 'active') {
      out.push(`Pt continues with ${what} without complications on day ${abxDayNumber(c, date)}${c.days ? ` of ${c.days}` : ''}.`);
    } else if (state === 'stopping') {
      out.push({
        completed: `Pt completed ${what} without complications.`,
        changed: `Pt's ${what} was changed to oral today.`,
      }[c.stopped.reason] || `Pt's ${what} was discontinued today.`);
    }
  }
  return out;
}

/** Take the app's antibiotic sentences out of a note (used when starting from an earlier note). */
export function stripAbx(text) {
  return String(text)
    .replace(/\s*Pt continues with (?:oral|IV) [^.]*? without complications on day \d+(?: of \d+)?\./g, '')
    .replace(/\s*Pt completed (?:oral|IV) [^.]*? without complications\./g, '')
    .replace(/\s*Pt's (?:oral|IV) [^.]*? was (?:discontinued|changed to oral) today\./g, '');
}

/** Word-by-word differences from `before` to `after`: [{ t: 'same' | 'add' | 'del', w }]. */
export function wordDiff(before, after) {
  const a = String(before).split(/\s+/).filter(Boolean);
  const b = String(after).split(/\s+/).filter(Boolean);
  // Longest common subsequence table, filled from the end.
  const L = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push({ t: 'same', w: a[i] }); i++; j++; }
    else if (j < b.length && (i === a.length || L[i][j + 1] >= L[i + 1][j])) out.push({ t: 'add', w: b[j++] });
    else out.push({ t: 'del', w: a[i++] });
  }
  return out;
}

/** The same text as a fingerprint, so an edit after sending can be detected. */
export function noteHash(p) {
  // Notes without details hash as before, so earlier sends don't all look changed.
  const s = `${p.mrn}|${detailSentences(p).length ? fullNote(p) : p.text || ''}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

/** Which patients changed since the last send (by fingerprint). */
export function changedSinceSend(day) {
  const last = [...(day.sends || [])].reverse().find((s) => s.hashes);
  if (!last) return day.patients.filter((p) => p.text).map((p) => p.mrn);
  return day.patients.filter((p) => p.text && last.hashes?.[p.mrn] !== noteHash(p)).map((p) => p.mrn);
}

/** Patients included in the last send who have since been deleted from the day. */
export function removedSinceSend(day) {
  const last = [...(day.sends || [])].reverse().find((s) => s.hashes);
  if (!last) return [];
  const names = last.names || {};
  return Object.keys(last.hashes).filter((mrn) => !day.patients.some((p) => p.mrn === mrn)).map((mrn) => names[mrn] || mrn);
}

export function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

function stamp(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Make the next send-log entry (not yet saved). */
export function nextSend(day, now = Date.now()) {
  const n = (day.sends || []).filter((s) => s.kind !== 'deleted').length + 1;
  const included = day.patients.filter((p) => p.text);
  const changed = changedSinceSend(day);
  return {
    n,
    at: now,
    kind: n === 1 ? 'original' : 'update',
    count: included.length,
    changed: n === 1 ? [] : changed,
    removed: removedSinceSend(day),
    hashes: Object.fromEntries(included.map((p) => [p.mrn, noteHash(p)])),
    names: Object.fromEntries(included.map((p) => [p.mrn, `${p.last}, ${p.first} (${p.mrn})`])),
  };
}

export function logLines(day, sends) {
  return sends.map((s) => {
    if (s.kind === 'deleted') return `${stamp(s.at)}  Daily file deleted from computer`;
    const removed = s.removed?.length ? `  Removed: ${s.removed.join('; ')}` : '';
    const who = s.kind === 'original'
      ? `${s.count} patient${s.count === 1 ? '' : 's'}`
      : `Changed: ${s.changed.map((mrn) => {
        const i = day.patients.findIndex((p) => p.mrn === mrn);
        return i < 0 ? mrn : `${i + 1}. ${day.patients[i].last}, ${day.patients[i].first}`;
      }).join('; ') || 'none'}`;
    return `${stamp(s.at)}  Send #${s.n} (${s.kind})  ${who}${removed}`;
  });
}

/**
 * The daily file, in the layout the Note Updater reads: building, "Daily notes", the date of service
 * as M/D/YYYY, then one line per patient: "LAST, FIRST (MRN): whole note on one line".
 * A patient with no note yet is written as "New pt". Nothing else goes in the file; the send log
 * is kept separately.
 */
export function summaryLines(day) {
  const [y, m, d] = day.date.split('-').map(Number);
  const lines = [];
  if (day.building) lines.push(day.building);
  lines.push('Daily notes', `${m}/${d}/${y}`);
  for (const p of day.patients) {
    const text = p.text ? fullNote(p).replace(/\s+/g, ' ').trim() : '';
    const name = `${String(p.last).trim().toUpperCase()}, ${String(p.first).trim().toUpperCase()}`;
    lines.push(`${name} (${p.mrn}): ${text || 'New pt'}`);
  }
  return lines;
}

export function buildSummary(day) {
  return summaryLines(day).join('\n') + '\n';
}

/** "Desert Blossom Daily notes 10_26_26.docx" */
export function summaryFilename(day) {
  const [y, m, d] = day.date.split('-').map(Number);
  const stamp = `${m}_${d}_${String(y).slice(-2)}`;
  return day.building ? `${day.building} Daily notes ${stamp}.docx` : `Daily notes ${stamp}.docx`;
}
