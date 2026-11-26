// Pure note logic: template filling, shortcut expansion, daily summary and send log.

import { formatVitals } from './parsers.js';
import { DETAILS, PHRASE_VARIANTS, VITALS_TAILS, EXAM_SYSTEMS, GU_SYMPTOMS, OSTOMIES, O2_DELIVERY, O2_WHEN, O2_PAP, COUGH_KINDS, CATH_TEXT, CATH_SYMPTOMS, URINE_LOOKS, OSTOMY_OUTPUT, STOMA_SKIN, GI_SYMPTOMS, ORDER_LABS, ORDER_TESTS, US_AREAS, DOPPLER_SIDES, DOPPLER_LIMBS, INCISION_SIDES, INCISION_SITES, INCISION_STATES, INCISION_ACTS, EDEMA_GRADES, EDEMA_KINDS } from './defaults.js';

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
    if (d.key === 'o2') { const s = o2Sentence(p); if (s) out.o2 = s; continue; } // APP-11-25
    if (d.key === 'bm') { // APP-11-20; APP-11-25: the urinary / catheter / ostomy sentences follow the BM sentence
      const s = bmSentence(p); if (s) out.bm = s;
      const g = guSentence(p); if (g) out.gu = g;
      continue;
    }
    if (d.key === 'ordered') { const s = orderedSentence(p); if (s) out.ordered = s; continue; } // APP-11-25B
    if (d.key === 'exam') { const x = examSentence(p); if (x) out.onexam = x; const s = incisionSubjective(p); if (s) out.incision = s; continue; } // APP-11-25E: "On exam: ..." for the ticked systems // APP-11-20: exam findings go out as their own lines; APP-11-25C: "Visualized incision ..." is note text: exam findings go out as their own lines (examLines), never in the note text
    if (d.key === 'dx' || d.key === 'meds') continue; // APP-11-22-CHART: tapped items go out as their own lines (tapLines)
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
  let text = stripRetapped(String(p.text || ''), p).trim(); // APP-11-25: a sentence tapped again today replaces the one carried in the text
  const tail = [];
  const place = (keys, re) => {
    const add = keys.map((k) => d[k]).filter(Boolean).join(' ');
    if (!add) return;
    const next = text ? insertAfter(text, re, add) : null;
    if (next == null) tail.push(add); else text = next;
  };
  // APP-11-22: the antibiotic sentence comes right after where the patient was assessed, before the other details
  place(['abx', 'overnight', 'nursing', 'new'], /^[^.!?]*[.!?]/);
  // APP-11-11: also the varied wordings ("Appetite fair, ...", "Appetite is fair, ...", "Pt continues with therapy.")
  place(['meal'], /\b(?:(?:good|fair|poor)\s+appetite|appetite\s+(?:is\s+)?(?:good|fair|poor))[^.]*\./i);
  place(['therapy'], /\b(?:continues to work with|continues with|working with|participat\w* (?:in|with)) therapy[^.]*\./i);
  place(['o2'], /\bbreathing complications[^.]*\./i); // APP-11-25: the O2 sentences follow the breathing sentence
  place(['bm', 'gu'], /\bconstipation[^.]*\./i); // APP-11-20: the BM sentence follows the constipation sentence (APP-11-25: then urinary / catheter / ostomy)
  for (const k of ['pain', 'onexam', 'incision', 'labs', 'ordered', 'said']) if (d[k]) tail.push(d[k]); // APP-11-22: labs sentence at the end; APP-11-25B: then what was ordered
  if (tail.length && text && !/[.!?"]$/.test(text)) text += '.';
  return [text, ...tail].filter(Boolean).join(' ');
}

/**
 * Yesterday's note as a start for today: the vitals are swapped for today's (or left blank),
 * since old readings must never be carried into a new note. Everything else is kept to edit.
 */
export function carryForward(lastNote, todayVitals, settings) {
  const vit = formatVitals(todayVitals, settings);
  // APP-11-20: yesterday's "Last BM ..." sentence is about that day, so it is not carried into today's note
  // APP-11-25B: yesterday's "Ordered ..." sentence is about that day too
  const kept = stripAbx(String(lastNote)).replace(/\s*\bLast BM [^.]*\./g, '').replace(/(^|[.!?"])\s*Ordered [^.]*\./g, '$1')
    .replace(new RegExp(`(^|[.!?"])\\s*(?:${INCISION_ACTS.join('|')})[^.]*\\.`, 'g'), '$1') // APP-11-25C: so is "Visualized incision ..."
    .replace(/(^|[.!?"])\s*On exam: .*?\.(?=\s|$)/g, '$1'); // APP-11-25E: and "On exam: ..."
  return kept.trim().replace(/Vital signs:.*?(?=\b(?:pt\s+)?denies\b)/i, `Vital signs: ${vit ? `${vit}; ` : ' '}`) + ' ';
}

// ===== APP-11-20  START: BM sentence and exam lines =====
const mdy = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${m}/${d}/${String(y).slice(-2)}`; };

/**
 * "Last BM yesterday (11/18/26)." from p.bm = { date, dos, how }. "today" and "yesterday" are counted from the
 * date of service, not from the phone's clock. Any other day is written as its date. '' when no BM date is set.
 */
export function bmSentence(p) {
  const b = p.bm;
  if (!b?.date || !b.dos) return '';
  const diff = dayNo(b.dos) - dayNo(b.date);
  const word = diff === 0 ? 'today' : diff === 1 ? 'yesterday' : '';
  const how = b.how || 'both';
  const kind = b.kind ? `, ${b.kind}` : ''; // APP-11-22: firm, loose or diarrhea
  if (!word || how === 'date') return `Last BM ${mdy(b.date)}${kind}.`;
  if (how === 'word') return `Last BM ${word}${kind}.`;
  return `Last BM ${word} (${mdy(b.date)})${kind}.`;
}

/**
 * A typed date ("11/15", "11/15/26", "11-15-2026") as YYYY-MM-DD, or '' when it is not a real date or is after the
 * date of service. With no year typed, it is the most recent such day on or before the date of service.
 */
export function parseBmDate(text, dos) {
  const m = String(text).trim().match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2}|\d{4}))?$/);
  if (!m || !dos) return '';
  const [dy] = dos.split('-').map(Number);
  let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : dy;
  const iso = (yy) => `${yy}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
  const real = (s) => { const t = new Date(`${s}T00:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s; };
  if (!m[3] && real(iso(y)) && iso(y) > dos) y -= 1;
  const out = iso(y);
  return real(out) && out <= dos ? out : '';
}

/** The filled-in exam systems as lines for the daily summary: ["Exam: Resp: Bibasilar crackles", ...]. */
export function examLines(p) {
  const e = p.exam || {};
  const inc = incisionExam(p); // APP-11-25C: the incision finding is part of the Skin line
  return EXAM_SYSTEMS.map((s) => {
    let v = String(e[s.key] ?? '').replace(/\s+/g, ' ').trim();
    if (s.key === 'Skin' && inc) v = v ? `${v.replace(/[.\s]+$/, '')}. ${inc}` : inc;
    const ed = s.key === 'Ext' ? edemaExam(p) : ''; // APP-11-25D: edema by leg is part of the Ext line
    if (ed) v = v ? `${v.replace(/[.\s]+$/, '')}. ${ed}` : ed;
    return [s.key, v];
  }).filter(([, v]) => v).map(([k, v]) => `Exam: ${k}: ${v}`);
}

// ===== APP-11-25E  START: exam findings put in the note text =====
/**
 * "On exam: Resp diminished at the bases; Ext 2+ left lower leg edema, no right lower leg edema." - one sentence for
 * the body systems ticked "Put in note" (p.exn.sys), each with exactly the finding that goes to the exam section.
 * A system that is ticked but has no finding is left out. A capitalised ordinary first word is lowercased ("Diminished"
 * -> "diminished"); abbreviations (NAD, RRR) and everything else are left as they are.
 */
export function examSentence(p) {
  const want = p.exn?.sys || [];
  if (!want.length) return '';
  const lower = (t) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
  const parts = examLines(p).map((ln) => ln.match(/^Exam: ([^:]+): (.*)$/)).filter((m) => m && want.includes(m[1]))
    .map((m) => `${m[1]} ${m[2].replace(/[.\s]+$/, '').split(/\.\s+/).map(lower).join('; ')}`);
  return parts.length ? `On exam: ${parts.join('; ')}.` : '';
}
// ===== APP-11-25E  END =====

// ===== APP-11-25D  START: edema for each leg =====
/**
 * The Ext finding from p.edema = { left, right, kind }: "2+ left lower leg edema, no right lower leg edema";
 * both legs the same: "2+ bilateral lower leg edema" / "No lower leg edema"; one leg picked: that leg only.
 * kind (pitting / non-pitting) is written on every leg that has edema: "2+ pitting left lower leg edema".
 */
export function edemaExam(p) {
  const e = p.edema || {};
  const L = EDEMA_GRADES.includes(e.left) ? e.left : '';
  const R = EDEMA_GRADES.includes(e.right) ? e.right : '';
  const kind = EDEMA_KINDS.includes(e.kind) ? `${e.kind} ` : '';
  const one = (g, where) => (g === 'none' ? `no ${where} lower leg edema` : `${g} ${kind}${where} lower leg edema`);
  const cap1 = (t) => t[0].toUpperCase() + t.slice(1);
  if (!L && !R) return '';
  if (L && R && L === R) return L === 'none' ? 'No lower leg edema' : cap1(one(L, 'bilateral'));
  return cap1([L ? one(L, 'left') : '', R ? one(R, 'right') : ''].filter(Boolean).join(', '));
}
// ===== APP-11-25D  END =====

// ===== APP-11-25C  START: surgical incision =====
/** " to right hip" from p.incision = { side, site, siteOther }; '' when no site is given. */
export function incisionWhere(p) {
  const c = p.incision || {};
  const typed = String(c.siteOther ?? '').replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const site = typed || (INCISION_SITES.includes(c.site) ? c.site : '');
  if (!site) return '';
  return ` to ${INCISION_SIDES.includes(c.side) ? `${c.side} ` : ''}${site}`;
}

/** The exam finding: "Surgical incision to right hip dry and intact." / "Surgical site to right hip covered with dressing." */
export function incisionExam(p) {
  const st = INCISION_STATES.find(([k]) => k === p.incision?.state);
  return st ? `${st[2].replace('{at}', incisionWhere(p))}.` : '';
}

/** The note-text sentence: "Visualized incision to right hip." / "Assessed incision to right hip." */
export function incisionSubjective(p) {
  const act = p.incision?.act;
  return INCISION_ACTS.includes(act) ? `${act}${incisionWhere(p)}.` : '';
}
// ===== APP-11-25C  END =====
// ===== APP-11-20  END =====

// ===== APP-11-25  START: O2, urinary, catheter and ostomy sentences =====
const listAnd = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** The liters as typed or tapped ("2", "2.5", "2 L") as a plain number, or '' when it is not a number. */
export function o2Liters(v) {
  const m = String(v ?? '').trim().match(/^(\d{1,2}(?:\.\d)?)\s*(?:l|lpm|liters?)?$/i);
  return m ? m[1] : '';
}

/**
 * The O2 button's sentences from p.o2 = { liters, via, when, room, pap, wean, sob, cough, wheeze, tx }:
 * "Pt on 2 L O2 via nasal cannula, continuous." or "Pt on room air."; "Pt uses CPAP."; "Weaning O2 as tolerated.";
 * "Pt denies shortness of breath."; "Pt reports dry cough."; "Pt denies wheezing."; "Continues breathing treatments as ordered."
 */
export function o2Sentence(p) {
  const o = p.o2 || {};
  const out = [];
  const l = o2Liters(o.liters);
  const via = O2_DELIVERY.includes(o.via) ? ` via ${o.via}` : '';
  const when = O2_WHEN.includes(o.when) ? `, ${o.when}` : '';
  if (o.room) out.push('Pt on room air.');
  else if (l || via || when) out.push(`Pt on ${l ? `${l} L ` : ''}O2${via}${when}.`);
  if (O2_PAP.includes(o.pap)) out.push(`Pt uses ${o.pap}.`);
  if (o.wean) out.push('Weaning O2 as tolerated.');
  if (o.sob === 'denies') out.push('Pt denies shortness of breath.');
  else if (o.sob === 'reports') out.push('Pt reports shortness of breath.');
  if (o.cough === 'denies') out.push('Pt denies cough.');
  else if (COUGH_KINDS.includes(o.cough)) out.push(`Pt reports ${o.cough} cough.`);
  if (o.wheeze === 'denies') out.push('Pt denies wheezing.');
  else if (o.wheeze === 'reports') out.push('Pt reports wheezing.');
  if (o.tx) out.push('Continues breathing treatments as ordered.');
  return out.join(' ');
}

const picked = (all, list) => all.filter((s) => (list || []).includes(s));

/**
 * The bowel, urinary, catheter, ostomy and PEG sentences from p.gu, in this order:
 * "Pt complains of nausea and bloating."; "Pt denies urinary complications." or "Pt complains of dysuria and urgency.";
 * "Urine cloudy."; "Foley catheter in place, denies any complications." (or ", complains of leaking."); "Draining clear
 * yellow urine."; "Voiding trial planned."; "Colostomy in place, denies any complications."; "Stoma pink and moist.";
 * "Output formed."; "Skin around stoma intact."; "PEG tube in place, site clean and dry."
 */
export function guSentence(p) {
  const g = p.gu || {};
  const out = [];
  const gi = picked(GI_SYMPTOMS, g.gi);
  if (gi.length) out.push(`Pt complains of ${listAnd(gi)}.`);
  const sx = picked(GU_SYMPTOMS, g.sx);
  if (sx.length) out.push(`Pt complains of ${listAnd(sx)}.`);
  else if (g.denies) out.push('Pt denies urinary complications.');
  if (URINE_LOOKS.includes(g.urine)) out.push(`Urine ${g.urine}.`);
  if (CATH_TEXT[g.cath]) {
    const csx = picked(CATH_SYMPTOMS, g.cathSx);
    out.push(`${CATH_TEXT[g.cath]}${csx.length ? `, complains of ${listAnd(csx)}` : g.cathOk ? ', denies any complications' : ''}.`);
    if (g.drain) out.push('Draining clear yellow urine.');
    if (g.trial) out.push('Voiding trial planned.');
  }
  if (OSTOMIES.includes(g.ostomy)) {
    out.push(`${g.ostomy} in place${g.ostOk ? ', denies any complications' : ''}.`);
    if (g.stoma) out.push('Stoma pink and moist.');
    const o = OSTOMY_OUTPUT.find(([k]) => k === g.output);
    if (o) out.push(`${o[1]}.`);
    if (STOMA_SKIN.includes(g.skin)) out.push(`Skin around stoma ${g.skin}.`);
  }
  if (g.peg) out.push(`PEG tube in place${g.pegOk ? ', site clean and dry' : ''}.`);
  return out.join(' ');
}

/** The items of the Ordered button, in the order they are written. */
export function orderedItems(p) {
  const o = p.ordered || {};
  const clean = (t) => String(t ?? '').replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const out = [...picked(ORDER_LABS, o.labs), ...picked(ORDER_TESTS, o.tests), ...picked(US_AREAS, o.us).map((a) => `ultrasound of ${a}`)];
  if (clean(o.usOther)) out.push(`ultrasound of ${clean(o.usOther)}`);
  if (DOPPLER_SIDES.includes(o.dopSide) && DOPPLER_LIMBS.includes(o.dopLimb)) {
    out.push(`ultrasound doppler of ${o.dopSide} ${o.dopLimb} ${o.dopSide === 'bilateral' ? 'extremities' : 'extremity'}`);
  }
  if (clean(o.other)) out.push(clean(o.other));
  return out;
}

/** "Ordered CBC, BMP and CXR." from p.ordered; '' when nothing is picked. */
export function orderedSentence(p) {
  const items = orderedItems(p);
  return items.length ? `Ordered ${listAnd(items)}.` : '';
}

const alt = (list) => list.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const listRe = (lead, list) => new RegExp(`\\s*${lead}(?:${alt(list)})(?:(?:, | and )(?:${alt(list)}))*\\.`, 'g');
const RETAP = {
  air: [new RegExp(`\\s*Pt on (?:\\d{1,2}(?:\\.\\d)? L )?O2(?: via (?:${alt(O2_DELIVERY)}))?(?:, (?:${alt(O2_WHEN)}))?\\.`, 'g'), /\s*Pt on room air\./g],
  pap: [new RegExp(`\\s*Pt uses (?:${alt(O2_PAP)})\\.`, 'g')],
  wean: [/\s*Weaning O2 as tolerated\./g],
  sob: [/\s*Pt (?:denies|reports) shortness of breath\./g],
  cough: [/\s*Pt denies cough\./g, new RegExp(`\\s*Pt reports (?:${alt(COUGH_KINDS)}) cough\\.`, 'g')],
  wheeze: [/\s*Pt (?:denies|reports) wheezing\./g],
  tx: [/\s*Continues breathing treatments as ordered\./g],
  gi: [listRe('Pt complains of ', GI_SYMPTOMS)],
  urinary: [/\s*Pt denies urinary complications\./g, listRe('Pt complains of ', GU_SYMPTOMS)],
  urine: [new RegExp(`\\s*Urine (?:${alt(URINE_LOOKS)})\\.`, 'g')],
  cath: [new RegExp(`\\s*(?:${alt(Object.values(CATH_TEXT))})(?:, denies any complications|, complains of (?:${alt(CATH_SYMPTOMS)})(?:(?:, | and )(?:${alt(CATH_SYMPTOMS)}))*)?\\.`, 'g'),
    /\s*Draining clear yellow urine\./g, /\s*Voiding trial planned\./g],
  ostomy: [new RegExp(`\\s*(?:${alt(OSTOMIES)}) in place(?:, denies any complications)?\\.`, 'g'), /\s*Stoma pink and moist\./g,
    new RegExp(`\\s*(?:${alt(OSTOMY_OUTPUT.map((x) => x[1]))})\\.`, 'g'), new RegExp(`\\s*Skin around stoma (?:${alt(STOMA_SKIN)})\\.`, 'g')],
  peg: [/\s*PEG tube in place(?:, site clean and dry)?\./g],
};

/**
 * Yesterday's note is carried forward with these sentences in its text. When the same thing is tapped again today, the
 * carried sentence is taken out so it is written once, with today's choice. A part that is not tapped today is left
 * exactly as it is in the text.
 */
export function stripRetapped(text, p) {
  const o = p.o2 || {};
  const g = p.gu || {};
  const on = { air: !!(o.room || o2Liters(o.liters) || O2_DELIVERY.includes(o.via) || O2_WHEN.includes(o.when)), pap: O2_PAP.includes(o.pap),
    wean: !!o.wean, sob: !!o.sob, cough: !!o.cough, wheeze: !!o.wheeze, tx: !!o.tx,
    gi: picked(GI_SYMPTOMS, g.gi).length > 0, urinary: !!(g.denies || picked(GU_SYMPTOMS, g.sx).length), urine: URINE_LOOKS.includes(g.urine),
    cath: !!CATH_TEXT[g.cath], ostomy: OSTOMIES.includes(g.ostomy), peg: !!g.peg };
  let t = String(text);
  for (const k of Object.keys(RETAP)) if (on[k]) for (const re of RETAP[k]) t = t.replace(re, '');
  return t;
}

/** True when the note's own text says the patient denies breathing complications (any of the app's wordings). */
export function saysNoBreathingTrouble(text) {
  return /\b(?:denies (?:any )?breathing complications|no breathing complications reported|reports no breathing complications)\b/i.test(String(text || ''));
}
// ===== APP-11-25  END =====

// ===== APP-11-11  START: varied wording and blanks =====

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A whole sentence only: at the start or after a sentence end, and followed by a space or the end.
const sentenceRe = (s) => new RegExp(`(^|[.!?]\\s+)${escRe(s)}(?=\\s|$)`);
const VITALS_TAIL_RE = new RegExp(`(Vital signs:[^\\n]*?)\\b(${VITALS_TAILS.map(escRe).sort((a, b) => b.length - a.length).join('|')})`, 'i');

/**
 * Reword the routine sentences of a note. Only a sentence that is exactly one of the tested wordings is changed
 * (a sentence that was edited is left alone), and it is swapped for another tested wording of the same sentence.
 * A wording that is in `avoid` (the last note) is not picked while another is available.
 * `rnd` returns a number from 0 up to 1 (Math.random); tests pass their own.
 */
// ===== APP-11-22-CHART  START: diagnoses and medications tapped from the chart =====
/**
 * One line per tapped item, in the order tapped: "Dx: Hypertension", "Med: Apixaban Oral Tablet 5 MG".
 * Note Updater (version 85) writes them under the therapy text of the day's note as
 * "11/22: Diagnoses addressed: ..." and "11/22: Medications reviewed: ...".
 */
export function tapLines(p) {
  const clean = (list) => (Array.isArray(list) ? list : []).map((x) => String(x ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [...clean(p.tapDx).map((x) => `Dx: ${x}`), ...clean(p.tapMeds).map((x) => `Med: ${x}`)];
}

/** The chart entry for a patient: by MRN; by exact name only for an entry that has no MRN. */
export function chartEntry(chart, p) {
  const list = chart?.patients;
  if (!Array.isArray(list)) return null;
  const mrn = String(p.mrn ?? '').trim();
  const name = `${String(p.last).trim()}, ${String(p.first).trim()}`.toUpperCase();
  return (mrn && list.find((x) => String(x.mrn ?? '').trim() === mrn))
    || list.find((x) => !String(x.mrn ?? '').trim() && String(x.name ?? '').trim().toUpperCase() === name) || null;
}
// ===== APP-11-22-CHART  END =====

export function varyWording(text, avoid = '', rnd = Math.random) {
  let out = String(text);
  const prev = String(avoid || '');
  const pick = (list, used) => {
    const ok = list.filter((v) => !used(v));
    const from = ok.length ? ok : list;
    return from[Math.min(from.length - 1, Math.floor(rnd() * from.length))];
  };
  for (const family of PHRASE_VARIANTS) {
    const have = family.find((v) => sentenceRe(v).test(out));
    if (!have) continue;
    const next = pick(family, (v) => sentenceRe(v).test(prev));
    if (next !== have) out = out.replace(sentenceRe(have), (m, lead) => lead + next);
  }
  const m = VITALS_TAIL_RE.exec(out);
  if (m) {
    const was = VITALS_TAIL_RE.exec(prev)?.[2].toLowerCase();
    const next = pick(VITALS_TAILS, (v) => v.toLowerCase() === was);
    out = out.slice(0, m.index) + m[1] + next + out.slice(m.index + m[0].length);
  }
  return out;
}

/** How many ___ blanks (from a "Today's decisions" sentence) are still in the text. */
export function blankCount(text) {
  return (String(text || '').match(/_{3,}/g) || []).length;
}

/** Where the next ___ is at or after `from` (wrapping to the start), as [start, end]; null when there is none. */
export function nextBlank(text, from = 0) {
  const re = /_{3,}/g;
  let first = null;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    first ??= [m.index, m.index + m[0].length];
    if (m.index >= from) return [m.index, m.index + m[0].length];
  }
  return first;
}

/** A sent day has notes that were written or changed after the last send, or was never sent at all. */
export function unsentCount(day) {
  if (!day.patients.some((p) => p.text)) return 0;
  return changedSinceSend(day).length + ((day.sends || []).some((s) => s.hashes) ? removedSinceSend(day).length : 0);
}

// ===== APP-11-11  END =====

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
  const ex = examLines(p); // APP-11-20: a changed exam line counts as a change; notes without one hash as before
  const tap = tapLines(p); // APP-11-22-CHART: a changed tapped line counts as a change; notes without one hash as before
  const s = `${p.mrn}|${detailSentences(p).length ? fullNote(p) : p.text || ''}${ex.length ? `|${ex.join('|')}` : ''}${tap.length ? `|${tap.join('|')}` : ''}`;
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

// ===== APP-11-24  START: time clock arithmetic =====
/** Minutes between two "HH:MM" clock times on the same day; null when either is missing, malformed, or out is before in. */
export function clockMinutes(tin, tout) {
  const m = (t) => { const x = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return x && +x[1] < 24 && +x[2] < 60 ? +x[1] * 60 + +x[2] : null; };
  const a = m(tin);
  const b = m(tout);
  return a == null || b == null || b < a ? null : b - a;
}

/** "2 h 05 min" / "45 min". */
export function clockSpan(mins) {
  if (mins == null) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

/** Total minutes of the finished segments of one day at one building (open or invalid segments are not counted). */
export function clockTotal(segs) {
  return (segs || []).reduce((sum, s) => sum + (clockMinutes(s.in, s.out) ?? 0), 0);
}

/** "7:42 AM" from "07:42". */
export function clock12(t) {
  const x = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  if (!x) return '';
  const h = +x[1];
  return `${h % 12 || 12}:${x[2]} ${h < 12 ? 'AM' : 'PM'}`;
}
// ===== APP-11-24  END =====

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
    lines.push(...examLines(p)); // APP-11-20: read by Note Updater version 82 and later
    lines.push(...tapLines(p)); // APP-11-22-CHART: read by Note Updater version 85 and later
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
