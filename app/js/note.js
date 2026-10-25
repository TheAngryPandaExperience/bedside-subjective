// Pure note logic: template filling, shortcut expansion, daily summary and send log.

import { formatVitals } from './parsers.js';

/** Fill the template for one patient. Pain null = skipped (the pain sentence is dropped). */
export function renderTemplate(settings, { locationText, pain, vitals }) {
  const vit = formatVitals(vitals, settings);
  let t = settings.template;
  if (pain == null) t = t.replace(/Pain \{pain\}\/10\.\s*/, '');
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

/** The same text as a fingerprint, so an edit after sending can be detected. */
export function noteHash(p) {
  const s = `${p.mrn}|${p.text || ''}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

/** Which patients changed since the last send (by fingerprint). */
export function changedSinceSend(day) {
  const last = day.sends?.[day.sends.length - 1];
  if (!last) return day.patients.filter((p) => p.text).map((p) => p.mrn);
  return day.patients.filter((p) => p.text && last.hashes?.[p.mrn] !== noteHash(p)).map((p) => p.mrn);
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
  const n = (day.sends?.length || 0) + 1;
  const included = day.patients.filter((p) => p.text);
  const changed = changedSinceSend(day);
  return {
    n,
    at: now,
    kind: n === 1 ? 'original' : 'update',
    count: included.length,
    changed: n === 1 ? [] : changed,
    hashes: Object.fromEntries(included.map((p) => [p.mrn, noteHash(p)])),
  };
}

export function logLines(day, sends) {
  return sends.map((s) => {
    const who = s.kind === 'original'
      ? `${s.count} patient${s.count === 1 ? '' : 's'}`
      : `Changed: ${s.changed.map((mrn) => {
        const i = day.patients.findIndex((p) => p.mrn === mrn);
        return i < 0 ? mrn : `${i + 1}. ${day.patients[i].last}, ${day.patients[i].first}`;
      }).join('; ') || 'none'}`;
    return `${stamp(s.at)}  Send #${s.n} (${s.kind})  ${who}`;
  });
}

/** The daily summary file, with the send log (including this send) at the bottom. */
export function buildSummary(day, send, settings = {}) {
  const lines = [`Date of service: ${formatDate(day.date)}`];
  if (settings.providerName) lines.push(`Provider: ${settings.providerName}`);
  lines.push('');
  day.patients.forEach((p, i) => {
    lines.push(patientLabel(p, i));
    lines.push(p.text ? p.text.trim() : '(not documented)');
    lines.push('');
  });
  lines.push('---- Send log ----');
  lines.push(...logLines(day, [...(day.sends || []), send]));
  return lines.join('\n') + '\n';
}

export function summaryFilename(day) {
  return `${day.date}_subjective.txt`;
}
