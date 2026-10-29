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
    const v = String(f[d.key] ?? '').trim();
    if (!v) continue;
    if (d.quote) out[d.key] = `Pt states "${v.replace(/^"|"$/g, '')}".`;
    else if (d.presets.includes(v)) out[d.key] = sentence(v);
    else if (d.numberText && /^\d+(\.\d+)?$/.test(v)) out[d.key] = sentence(d.numberText(v));
    else out[d.key] = sentence(d.prefix + v);
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
  for (const k of ['pain', 'said']) if (d[k]) tail.push(d[k]);
  if (tail.length && text && !/[.!?"]$/.test(text)) text += '.';
  return [text, ...tail].filter(Boolean).join(' ');
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
