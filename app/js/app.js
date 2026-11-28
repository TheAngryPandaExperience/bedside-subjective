// Bedside Subjective: screens and event handling.
// Screens: day (patient list), import (roster or vitals), patient (prompts + editor), settings, log.

import './version.js'; // sets self.BEDSIDE_VERSION
import { parseRoster, parseVitals, matchVitals, formatVitals, checkRoster } from './parsers.js';
import { renderTemplate, expandShortcut, patientLabel, fullNote, detailSentences, painPhrase, buildSummary, summaryLines, summaryFilename, carryForward, wordDiff, abxSentences, abxDayNumber, abxEndDate, abxState, abxName, nextSend, logLines, changedSinceSend, formatDate, varyWording, blankCount, nextBlank, unsentCount, bmSentence, parseBmDate, examLines, o2Sentence, o2Liters, guSentence, saysNoBreathingTrouble, orderedSentence, orderedItems, incisionExam, incisionSubjective, edemaExam, noteClashes, standingState, standingText, pendingStanding, stripRetapped, listLabel, roomParts, sortPatients, patientListLines, tapLines, chartEntry, clockMinutes, clockSpan, clockTotal, clock12 } from './note.js';
import { getDay, saveDay, deleteDay, listDays, getSettings, saveSettings, purgeOld, requestPersistence, getAbx, saveAbx, exportAll, importAll, getCharts, saveCharts, getRosters, saveRosters, getClock, saveClock } from './store.js';
import { fileToText } from './importers.js';
import { makeDocx, DOCX_TYPE } from './docx.js';
import { DEFAULT_SETTINGS, DETAILS, PAIN_SIDES, PAIN_SITES, PAIN_TYPES, DECISION_GROUP, DECISION_PHRASES, EXAM_SYSTEMS, BM_HOW, BM_KINDS, BACK_PARTS, O2_LITERS, GU_SYMPTOMS, CATHETERS, OSTOMIES, O2_DELIVERY, O2_WHEN, O2_PAP, COUGH_KINDS, CATH_SYMPTOMS, URINE_LOOKS, OSTOMY_OUTPUT, STOMA_SKIN, GI_SYMPTOMS, ORDER_LABS, ORDER_TESTS, US_AREAS, DOPPLER_SIDES, DOPPLER_LIMBS, INCISION_SIDES, INCISION_SITES, INCISION_STATES, INCISION_ACTS, EDEMA_GRADES, EDEMA_KINDS, EDEMA_PRESET_RE } from './defaults.js';

// Bump with every release so it's easy to confirm a phone has the latest copy.
// 15 (11/11/2026) = APP-11-11: Today's decisions buttons, the computer's receipt after a send, varied wording,
// and safety for notes that were not sent. Every changed place is marked APP-11-11.
// 18 (11/22/2026) = APP-11-22-CHART: Dx and Meds buttons. The patient's diagnoses and medications are pulled from the
// computer (Note Updater version 85 writes them); a tapped one is sent as a "Dx:" / "Med:" line under the patient.
// 19 (11/24/2026) = APP-11-24: a time clock for each building and day (clock in, clock out, every time editable,
// more than one stretch a day), with a time log in Settings. The times stay on the phone and in the backup; they are
// never part of the daily summary that goes to the notes.
const APP_VERSION = self.BEDSIDE_VERSION; // set in js/version.js - the one place the number lives

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

let settings;
let day;
let view = { name: 'day' };
let abx = {}; // antibiotic courses by MRN
let bcounts = {}; // building id -> { done, total } for the date on screen
let focusNext = false; // after switching building, scroll to the next patient not done
let lastReceipt = null; // APP-11-11: { id: day id, n, text, ok } - the computer's receipt for the send just made
let unsent = []; // APP-11-11: other days on this phone with notes that were not sent: { date, building, n, never }
let retrying = false; // APP-11-11
let ptList = { open: false, room: true }; // APP-11-27A: the patient list made from the loaded patients (open = shown; room = with the room bracket)

// A building's id never changes (its days are saved under it); its name can be renamed.
const bname = (id) => (id ? settings.buildingNames?.[id] || id : '');
// The day with its building's current name, for files, headings and the computer.
const named = (d = day) => ({ ...d, building: bname(d.building) });
const formerNames = (id) => (settings.buildingFormer?.[id] || []).filter((n) => n !== bname(id));

// Load a day and bring each patient's antibiotic sentences up to date for its date of service.
async function loadDay(date, building) {
  const d = await getDay(date, building);
  let changed = false;
  for (const p of d.patients) {
    const next = abxSentences(abx[p.mrn], d.date);
    if (JSON.stringify(next) !== JSON.stringify(p.abx || [])) {
      if (next.length) p.abx = next; else delete p.abx;
      changed = true;
    }
  }
  if (changed && d.patients.length) await saveDay(d);
  return d;
}

// Done / total for every building on the date on screen, shown on the building buttons.
async function updateCounts() {
  const date = day.date;
  const next = {};
  for (const id of settings.buildings) {
    const d = id === day.building ? day : await getDay(date, id);
    next[id] = { done: d.patients.filter((p) => p.status === 'done').length, total: d.patients.length };
  }
  bcounts = next;
  if (day.date !== date) return;
  document.querySelectorAll('[data-count]').forEach((el) => { el.outerHTML = countHtml(el.dataset.count); });
}
function countHtml(id) {
  const c = bcounts[id];
  if (!c || !c.total) return `<span class="n" data-count="${esc(id)}"></span>`;
  return `<span class="n ${c.done === c.total ? 'all' : ''}" data-count="${esc(id)}">${c.done}/${c.total}${c.done === c.total ? ' ✓' : ''}</span>`;
}

async function switchBuilding(id) {
  settings.currentBuilding = id;
  await saveSettings(settings);
  day = await loadDay(day.date, id);
  focusNext = true;
  pullChart(id); // APP-11-22-CHART
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Building names become folder names on the computer, so keep them to safe characters.
const cleanBuilding = (s) => String(s).replace(/[^A-Za-z0-9 _.\-]/g, '').trim().slice(0, 60);
const todayIso = () => new Date().toLocaleDateString('en-CA');
// Blank receiver address = the computer that served the app. Otherwise e.g. https://your-pc.tail1234.ts.net/
const receiverBase = (url = settings.receiverUrl) => (url ? url.replace(/\/?$/, '/') : '');

// "Install app" support: Android/desktop Chrome fire beforeinstallprompt; iPhone needs Share > Add to Home Screen.
let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (view.name === 'day') render();
});
window.addEventListener('appinstalled', () => { installPrompt = null; toast('Installed. Open it from your home screen.'); });

function toast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { toastEl.hidden = true; }, ms);
}

// ---------- navigation ----------

function go(next) {
  view = next;
  history.pushState({}, '');
  render();
}

window.addEventListener('popstate', async () => {
  if (view.name === 'patient') await flushNote();
  view = { name: 'day' };
  render();
});

async function boot() {
  settings = await getSettings();
  abx = await getAbx();
  // Starter phrases added after install go into the saved list once (they can be deleted after).
  settings.addedDefaults ??= [];
  if (!settings.addedDefaults.includes('dcc')) {
    const dcc = DEFAULT_SETTINGS.phrases.find((x) => x.key === '.dcc');
    if (dcc && !settings.phrases.some((x) => x.key === '.dcc')) settings.phrases = [...settings.phrases, dcc];
    settings.addedDefaults.push('dcc');
    await saveSettings(settings);
  }
  // APP-11-11: the "Today's decisions" buttons, added once, shown first on the phrase bar.
  if (!settings.addedDefaults.includes('decisions')) {
    const add = DECISION_PHRASES.filter((d) => !settings.phrases.some((x) => x.key === d.key));
    settings.phrases = [...settings.phrases, ...add];
    if (!settings.pinned.includes(DECISION_GROUP)) settings.pinned = [DECISION_GROUP, ...settings.pinned];
    settings.addedDefaults.push('decisions');
    await saveSettings(settings);
  }
  requestPersistence();
  purgeOld(settings.retentionDays, (d) => unsentCount(d) > 0); // APP-11-11: unsent changes are never aged out
  let date = todayIso();
  try { date = sessionStorage.getItem('date') || date; } catch { /* private mode */ }
  if (settings.buildings.length && !settings.buildings.includes(settings.currentBuilding)) settings.currentBuilding = settings.buildings[0];
  day = await loadDay(date, settings.currentBuilding);
  charts = await getCharts().catch(() => ({})); // APP-11-22-CHART
  rosters = await getRosters().catch(() => ({})); // APP-11-26F
  timeclock = await getClock().catch(() => ({})); // APP-11-24
  render();
  pullAllCharts(); // APP-11-25H (was the open building only): every building's chart, not waited for; the buttons use what is on the phone until it arrives
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

function render() {
  document.querySelector('.phrase-bar')?.remove();
  const screens = { timelog: renderTimeLog, day: renderDay, import: renderImport, patient: renderPatient, settings: renderSettings, log: renderLog, buildings: renderBuildings, rename: renderRename, rollover: renderRollover };
  screens[view.name]();
  window.scrollTo(0, 0);
  if (view.name === 'day' && focusNext) {
    focusNext = false;
    app.querySelector('.pt-btn.next')?.scrollIntoView({ block: 'center' });
  }
}

// ---------- day ----------

function statusPill(p) {
  if (p.status === 'done') return '<span class="pill p-good">Done</span>';
  if (p.text) return '<span class="pill p-amber">In progress</span>';
  return '<span class="pill p-acc">Not started</span>';
}

function renderDay() {
  const nextIdx = day.patients.findIndex((p) => p.status !== 'done');
  const bn = bname(day.building);
  const documented = day.patients.filter((p) => p.text).length;
  const changed = day.sends.length ? changedSinceSend(day).length : 0;
  app.innerHTML = `
    <div class="top">
      <div class="grow"><h1>Bedside Subjective</h1></div>
      <button class="ghost" data-act="settings" aria-label="Settings">Settings</button>
    </div>
    ${!isStandalone() && (installPrompt || isIos()) ? `<div class="banner" style="margin-bottom:12px">
      ${installPrompt ? 'Install this app on your phone so it opens from the home screen and works offline.'
        : 'To install: tap the Share button, then <b>Add to Home Screen</b>.'}
      ${installPrompt ? '<button class="primary" data-act="install">Install app</button>' : ''}</div>` : ''}
    ${receiptHtml()}${pendingHtml()}<div id="unsent">${unsentHtml()}</div>
    <div class="buildings" role="group" aria-label="Building">
      ${settings.buildings.map((b) => `<button class="bchip ${b === day.building ? 'on' : ''}" data-act="building" data-b="${esc(b)}" aria-pressed="${b === day.building}">${esc(bname(b))} ${countHtml(b)}</button>`).join('')}
      <button class="bchip add" data-act="add-building">+ Building</button>
      ${settings.buildings.length ? '<button class="ghost small" data-act="manage-buildings" style="min-height:40px">Manage</button>' : ''}
    </div>
    <div id="add-building-form" class="row" style="margin-bottom:12px" hidden>
      <input id="new-building" placeholder="Building name, e.g. Wellsprings" autocomplete="off" style="flex:1">
      <button class="primary" data-act="save-building">Add</button>
    </div>
    ${!settings.buildings.length ? '<p class="small muted" style="margin:0 0 12px">Add the buildings you see patients at. Each building keeps its own patient list and its own daily file.</p>' : ''}
    <div class="row" style="margin-bottom:12px">
      <label class="grow">Date of service<input type="date" id="date" value="${esc(day.date)}"></label>
    </div>
    <div id="clock">${clockHtml()}</div>
    <div id="chartsbox">${chartsHtml()}</div>
    <div class="row" style="margin-bottom:14px;flex-wrap:wrap">
      <button class="grow" data-act="import" data-kind="roster">Load patients</button>
      <button class="grow" data-act="rollover">Roll over</button>
      <button class="grow" data-act="import" data-kind="vitals" ${day.patients.length ? '' : 'disabled'}>Load vitals</button>
      <button class="grow" data-act="add-pt">+ Add patient</button>
    </div>
    <div id="add-pt-form" class="card" style="display:grid;gap:8px;margin-bottom:14px" hidden>
      <div class="row">
        <input id="ap-last" placeholder="Last name" autocomplete="off" autocapitalize="words" style="flex:1;min-width:0">
        <input id="ap-first" placeholder="First name" autocomplete="off" autocapitalize="words" style="flex:1;min-width:0">
      </div>
      <div class="row">
        <input id="ap-mrn" placeholder="MRN" autocomplete="off" inputmode="numeric" style="flex:1;min-width:0">
        <input id="ap-room" placeholder="Room (optional)" autocomplete="off" style="flex:1;min-width:0">
      </div>
      <div id="ap-msg" class="small" style="color:var(--bad)"></div>
      <div class="row" style="justify-content:flex-end">
        <button class="ghost" data-act="add-pt-cancel">Cancel</button>
        <button class="primary" data-act="add-pt-save">Add to list</button>
      </div>
    </div>
    ${day.patients.length > 1 ? `<div class="row" id="sortrow" style="align-items:center;margin-bottom:8px"><span class="small muted">Order:</span>
      ${[['name', 'Last name'], ['room', 'Room'], ['unit', 'Unit']].map(([k, label]) => `<button class="dpreset ${settings.sortBy === k ? 'on' : ''}" data-act="sort" data-by="${k}" style="min-height:36px;padding:4px 10px">${label}</button>`).join('')}</div>` : ''}
    ${day.patients.length ? `<div class="patients">${day.patients.map((p, i) => `
      <button class="pt-btn ${i === nextIdx ? 'next' : ''}" data-act="open" data-i="${i}">
        <span class="name">${esc(listLabel(p, i))}</span>
        <span class="meta">${[roomParts(p.room).unit, p.vitals ? 'vitals loaded' : ''].filter(Boolean).map(esc).join(' · ')}${activeAbx(p.mrn, day.date).length ? ' <span class="abx-tag">ABX</span>' : ''}${blankCount(p.text) ? ' <span class="abx-tag">___ to fill</span>' : ''}</span>
        <span class="status">${statusPill(p)}</span>
      </button>`).join('')}</div>
      <div id="ptlist" style="margin-top:14px">${ptListHtml()}</div>
      <div style="margin-top:18px">
        <button class="ghost danger" data-act="del-day">Delete this day</button>
        <div id="del-day-confirm" class="banner" hidden>Delete all ${day.patients.length} patients and notes for ${esc(bn ? `${bn}, ` : '')}${esc(formatDate(day.date))} from this phone? Files already sent to your computer stay there.
          <button class="danger" data-act="del-day-yes">Delete day</button>${day.patients.some((x) => !String(x.text || '').trim()) && day.patients.some((x) => String(x.text || '').trim()) ? `<button data-act="del-day-empty">Only remove the ${day.patients.filter((x) => !String(x.text || '').trim()).length} with no note</button>` : ''}<button data-act="del-day-no">Keep</button></div>
      </div>`
      : `<div class="empty card"><p><b>No patients for ${esc(bn ? `${bn} on ` : '')}${esc(formatDate(day.date))} yet.</b></p><p>Tap <b>Load patients</b> and choose your PCC roster as a PDF, Word file or photo, or paste the text. Or tap <b>Roll over</b> to bring patients from an earlier day.</p></div>`}
    ${day.patients.length ? `<div class="bottom-bar"><div class="inner">
      <div class="grow small muted">${documented} of ${day.patients.length} documented${day.sends.length ? ` · sent ${day.sends.filter((s) => s.kind !== 'deleted').length}×${changed ? ` · <b style="color:var(--amber)">${changed} changed since</b>` : ''}` : ''}</div>
      ${day.sends.length ? '<button class="ghost" data-act="log">Log</button>' : ''}
      <button class="primary" data-act="send" ${documented ? '' : 'disabled'}>Send day</button>
    </div></div>` : ''}`;

  app.querySelector('#date').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    day = await loadDay(e.target.value, day.building);
    try { sessionStorage.setItem('date', day.date); } catch { /* ignore */ }
    render();
  });
  updateCounts();
  updateUnsent(); // APP-11-11
  wireClock(); // APP-11-24
}

// ===== APP-11-11  START: receipt, not-sent warnings, retry =====

// The computer's answer to the send just made: what it saved and anything to check.
function receiptHtml() {
  const r = lastReceipt;
  if (!r || r.id !== day.id) return '';
  return `<div class="card" style="margin-bottom:12px;border-left:4px solid var(${r.ok ? '--good' : '--amber'})">
    <div class="row"><b class="grow">Send #${r.n}: saved on the computer</b><button class="ghost small" data-act="receipt-ok">OK</button></div>
    <div class="small" style="white-space:pre-wrap;margin-top:4px">${esc(r.text)}</div></div>`;
}

// A send for this day that did not get through, kept in front of him until it does.
function pendingHtml() {
  if (!day.pending) return '';
  return `<div class="banner" style="margin-bottom:12px"><div class="grow"><b>Not sent yet.</b> ${day.pending.answered ? esc(day.pending.error) : 'The last send for this day did not reach the computer. It is sent again by itself when the computer can be reached while this screen is open.'} The notes are safe on this phone.</div>
    <button class="primary" data-act="send">Send now</button></div>`;
}

function unsentHtml() {
  if (!unsent.length) return '';
  const shut = !!settings.folded?.unsent; // APP-11-25B: the card folds up to its heading
  const n = unsent.reduce((t, u) => t + u.n, 0);
  return `<div class="banner" style="margin-bottom:12px"><button class="ghost grow" data-act="fold" data-k="unsent" aria-expanded="${!shut}" style="text-align:left;min-height:40px"><b>${shut ? '▸' : '▾'} Not sent from other days${shut ? ` (${n} note${n === 1 ? '' : 's'} on ${unsent.length} day${unsent.length === 1 ? '' : 's'})` : ':'}</b></button>
    ${shut ? '' : unsent.map((u) => `<button data-act="goto-day" data-date="${esc(u.date)}" data-b="${esc(u.building)}">${esc(u.building ? `${bname(u.building)} ` : '')}${esc(formatDate(u.date))} · ${u.never ? `${u.n} never sent` : `${u.n} changed`}</button>`).join('')}</div>`;
}

// Look through every saved day for notes that were never sent or were changed after the last send.
async function updateUnsent() {
  const id = day.id;
  const next = [];
  for (const d of await listDays()) {
    if (d.id === id) continue;
    const n = unsentCount(d);
    if (n) next.push({ date: d.date, building: d.building, n, never: !(d.sends || []).some((s) => s.hashes) });
  }
  next.sort((a, b) => (a.date < b.date ? 1 : -1));
  unsent = next;
  const box = document.getElementById('unsent');
  if (box && day.id === id && view.name === 'day') box.innerHTML = unsentHtml();
}

// A send that failed is tried again, without a tap, when the phone can reach the computer again.
// Only for the day on screen, only from the list screen, and only one try at a time.
async function retryPending() {
  if (retrying || !day?.pending || day.pending.answered || view.name !== 'day' || document.hidden) return;
  retrying = true;
  try {
    const r = await fetch(`${receiverBase()}api/ping`, { headers: { 'X-Token': settings.receiverToken || '' } });
    if (r.ok && day.pending && view.name === 'day') await sendDay({ quiet: true, allowBlanks: true });
  } catch { /* still not reachable */ }
  retrying = false;
}
window.addEventListener('online', retryPending);
document.addEventListener('visibilitychange', () => { if (!document.hidden) retryPending(); });
setInterval(retryPending, 60000);

// ===== APP-11-11  END =====

// This patient's antibiotic courses that show on `date` (running, or stopped that day).
function activeAbx(mrn, date) {
  return (abx[mrn] || []).filter((c) => ['active', 'stopping'].includes(abxState(c, date)));
}

// ---------- import ----------

function renderImport() {
  const roster = view.kind === 'roster';
  app.innerHTML = `
    <div class="top">
      <button class="ghost" data-act="back">‹ List</button>
      <div class="grow"><h1>${roster ? 'Load patients' : 'Load vitals'}</h1></div>
    </div>
    <div class="stack">
      <p class="muted small">${roster
        ? 'A PDF exported from PCC reads exactly. For a photo, fill the frame with the list, hold steady and avoid glare. A long list can go in several photos: patients already added are skipped. Any MRN that might be misread is highlighted for you to check.'
        : 'Vitals are matched to your patients by MRN, then by name. Anything not matched stays blank.'}</p>
      ${roster ? `<div id="rosterbox">${rosterBoxHtml()}</div>` : ''}
      <div class="row">
        <label class="btn grow" style="display:flex;align-items:center;justify-content:center;color:var(--ink)">Choose file
          <input type="file" id="file" accept=".pdf,.docx,.txt,image/*" hidden></label>
        <label class="btn grow" style="display:flex;align-items:center;justify-content:center;color:var(--ink)">Take photo
          <input type="file" id="photo" accept="image/*" capture="environment" hidden></label>
      </div>
      <div id="prog" hidden><div class="small muted" id="progtext">Reading…</div><div class="progress"><i></i></div></div>
      <label>Or paste text<textarea id="raw" rows="5" placeholder="${roster ? 'MOUSE, MICKEY (7961) Pod A 202 - 1 …' : 'Patient: Mouse, Mickey (7961) – BP 120/70 …'}"></textarea></label>
      <button data-act="parse">Read pasted text</button>
      <div id="result"></div>
    </div>`;

  const handleFile = async (file) => {
    if (!file) return;
    const prog = app.querySelector('#prog');
    const bar = prog.querySelector('i');
    prog.hidden = false;
    app.querySelector('#progtext').textContent = `Reading ${file.name}…`;
    view.ocr = /^image\//.test(file.type || '') || /\.(jpe?g|png|heic|webp)$/i.test(file.name || ''); // APP-11-26A: a photo is read by OCR
    try {
      const text = await fileToText(file, (p) => { bar.style.width = `${Math.round(p * 100)}%`; }, view.kind === 'roster' ? judgeRoster : judgeVitals);
      app.querySelector('#raw').value = text;
      showParsed(text);
    } catch (err) {
      app.querySelector('#progtext').textContent = `Couldn't read that file: ${err.message}. Try a PDF, or paste the text.`;
      return;
    }
    prog.hidden = true;
  };
  if (roster) pullRoster(day.building, day.date); // APP-11-26F: ask the computer's roster folder as the screen opens (not waited for)
  app.querySelector('#file').addEventListener('change', (e) => handleFile(e.target.files[0]));
  app.querySelector('#photo').addEventListener('change', (e) => handleFile(e.target.files[0]));
}

// How good a photo reading is, so the importer can retry with another layout when it is poor.
// Take a building off the selector and switch to the next one. Its other days stay on the phone
// (and come back if the building is added again) until they age out.
async function removeBuilding(id, date) {
  settings.buildings = settings.buildings.filter((b) => b !== id);
  if (settings.currentBuilding === id || !settings.buildings.includes(settings.currentBuilding)) settings.currentBuilding = settings.buildings[0] || '';
  await saveSettings(settings);
  day = await loadDay(date, settings.currentBuilding);
}

function judgeRoster(text) {
  const rows = parseRoster(text);
  const flagged = rows.filter((r) => r.flag).length;
  return { value: rows.length * 2 - flagged * 3, done: rows.length >= 3 && !flagged };
}
function judgeVitals(text) {
  const n = parseVitals(text).length;
  return { value: n, done: n >= 3 };
}

function showParsed(text) {
  const out = app.querySelector('#result');
  if (view.kind === 'roster') {
    // APP-11-26A: every row is checked against the building's chart on this phone (a second source for names and MRNs).
    // A row that is not confirmed starts unticked, so nothing doubtful is added without your tick.
    const known = charts[day.building]?.chart?.patients;
    let rows = parseRoster(text);
    if (known) {
      const read = rows; // as the reading itself flagged them, before the chart was looked at
      rows = checkRoster(rows, known).map((r, i) => {
        // a clean row from a PDF or pasted text that is simply new to the building is not held back
        if (!view.ocr && r.chart === 'new' && !read[i].flag) return { ...r, flag: '', note: 'not in the chart (a new patient?)' };
        return r;
      });
    }
    view.rows = rows;
    if (!rows.length) {
      out.innerHTML = '<p class="card">No names with MRNs found. Check the text above, edit it if needed, and tap Read pasted text.</p>';
      return;
    }
    const flagged = rows.filter((r) => r.flag).length;
    const confirmed = rows.filter((r) => r.chart === 'match').length;
    out.innerHTML = `
      <h2>${rows.length} patients found${known ? ` · ${confirmed} confirmed by the chart` : ''}${flagged ? ` · <span style="color:var(--amber)">${flagged} to check</span>` : ''}</h2>
      ${known ? '' : `<p class="small" id="nochart" style="color:var(--amber)">No chart on this phone for ${esc(bname(day.building) || 'this building')}, so the names and MRNs could not be checked against it. "Get all charts" on the list screen brings it.</p>`}
      ${flagged ? '<p class="small muted" id="tickhint">Rows to check start unticked. Compare each with the paper, fix it if needed, and tick it to add it.</p>' : ''}
      <div class="review">${rows.map((r, i) => `
        <div class="review-row ${r.flag ? 'flagged' : ''}" data-i="${i}">
          <input type="checkbox" ${r.flag ? '' : 'checked'} aria-label="Include ${esc(r.last)}">
          <input class="last" value="${esc(r.last)}" aria-label="Last name">
          <input class="first" value="${esc(r.first)}" aria-label="First name">
          <input class="mrn mono" value="${esc(r.mrn)}" inputmode="numeric" aria-label="MRN">
          <input class="room" value="${esc(r.room || '')}" placeholder="Room (as in the list)" aria-label="Room" style="grid-column:2/-1;font-size:.85rem;padding:5px 8px">
          ${r.flag ? `<div class="flag">${esc(r.flag)}</div>` : ''}
          ${!r.flag && (r.chart === 'match' || r.note) ? `<div class="small muted" style="grid-column:1/-1">${r.chart === 'match' ? '✓ in the chart' : ''}${r.note ? `${r.chart === 'match' ? ' - ' : ''}${esc(r.note)}` : ''}</div>` : ''}
        </div>`).join('')}</div>
      <p class="small muted" style="margin-top:10px">${day.patients.length ? 'Patients already on today\'s list are skipped.' : ''}</p>
      <button class="primary" data-act="add-roster" style="width:100%">Add to ${esc(day.building ? `${bname(day.building)} · ` : '')}${esc(formatDate(day.date))}</button>`;
  } else {
    const vit = parseVitals(text);
    const matches = matchVitals(day.patients, vit);
    view.matches = matches;
    if (!matches.length) {
      out.innerHTML = '<p class="card">No patients found in that list. Each patient needs a "Last, First (MRN)" line.</p>';
      return;
    }
    out.innerHTML = `<h2>${matches.length} vitals rows</h2><div class="stack">${matches.map((m, i) => {
      const p = day.patients[m.patientIndex];
      const note = { mrn: '', name: 'matched by name only', 'mrn-name-mismatch': 'MRN matches but the name differs', none: 'no matching patient' }[m.how];
      return `<label class="card match" style="color:var(--ink)">
        <input type="checkbox" data-i="${i}" ${m.how === 'mrn' ? 'checked' : ''} ${m.how === 'none' ? 'disabled' : ''}>
        <div><b>${esc(m.vitals.last)}, ${esc(m.vitals.first)} (${esc(m.vitals.mrn)})</b>
          ${p ? ` → ${esc(patientLabel(p, m.patientIndex))}` : ''}
          <div class="small muted">${esc(formatVitals(m.vitals, settings)) || 'no readings found'}</div>
          ${note ? `<div class="small" style="color:var(--amber)">${esc(note)}</div>` : ''}</div>
      </label>`;
    }).join('')}</div>
    <button class="primary" data-act="apply-vitals" style="width:100%;margin-top:12px">Apply checked vitals</button>`;
  }
}

async function addRoster() {
  const have = new Set(day.patients.map((p) => p.mrn));
  let added = 0;
  app.querySelectorAll('.review-row').forEach((row) => {
    if (!row.querySelector('input[type=checkbox]').checked) return;
    const r = view.rows[+row.dataset.i];
    const p = {
      last: row.querySelector('.last').value.trim(),
      first: row.querySelector('.first').value.trim(),
      mrn: row.querySelector('.mrn').value.trim(),
      room: row.querySelector('.room')?.value.trim() ?? r.room,
      status: 'new',
      text: '',
    };
    if (!p.last || have.has(p.mrn)) return;
    have.add(p.mrn);
    day.patients.push(p);
    added++;
  });
  if (settings.sortBy) day.patients = sortPatients(day.patients, settings.sortBy); // APP-11-26F
  await saveDay(day);
  toast(`Added ${added} patient${added === 1 ? '' : 's'}`);
  history.back();
}

async function applyVitals() {
  let n = 0;
  app.querySelectorAll('.match input:checked').forEach((cb) => {
    const m = view.matches[+cb.dataset.i];
    const p = day.patients[m.patientIndex];
    if (!p) return;
    const { last, first, mrn, ...readings } = m.vitals;
    p.vitals = readings;
    // Fill the vitals into a note that was already started from the template.
    // APP-11-11: also the "pt denies" wording.
    if (p.text && /Vital signs:\s+(?:pt\s+)?denies/i.test(p.text)) {
      p.text = p.text.replace(/Vital signs:\s+((?:pt\s+)?denies)/i, (m, d) => `Vital signs: ${formatVitals(readings, settings)}; ${d}`);
    }
    n++;
  });
  await saveDay(day);
  toast(`Vitals added for ${n} patient${n === 1 ? '' : 's'}`);
  history.back();
}

// ---------- patient ----------

const current = () => day.patients[view.i];
let saveTimer;
let refreshPreview = () => {};
let redrawDetails = () => {};

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushNote, 400);
}

async function flushNote() {
  clearTimeout(saveTimer);
  const ta = document.getElementById('note');
  const p = current();
  if (!ta || !p) return;
  if (p.text !== ta.value) {
    p.text = ta.value;
    p.updatedAt = Date.now();
    if (p.status !== 'done') p.status = p.text ? 'progress' : 'new';
  }
  await saveDay(day);
  const s = document.getElementById('saved');
  if (s) s.textContent = 'Saved';
}

// This patient's most recent note from an earlier day (any building, same MRN), or null.
async function findLastNote(p) {
  if (!p.mrn) return null;
  let best = null;
  const days = await listDays();
  // Rolled over from a chosen day: that day's note comes first.
  if (p.rollFrom) {
    const d = days.find((x) => x.date === p.rollFrom.date && x.building === p.rollFrom.building);
    const q = d?.patients.find((x) => x.mrn === p.mrn && x.text);
    if (q) return { date: d.date, building: d.building, note: fullNote(q), pain: q.pain, painSide: q.painSide, painSite: q.painSite, painType: q.painType, location: q.location, standing: standingState(q) };
  }
  for (const d of days) {
    if (d.date >= day.date) continue;
    const q = d.patients.find((x) => x.mrn === p.mrn && x.text);
    if (!q) continue;
    const better = !best || d.date > best.date || (d.date === best.date && d.building === day.building);
    if (better) best = { date: d.date, building: d.building, note: fullNote(q), pain: q.pain, painSide: q.painSide, painSite: q.painSite, painType: q.painType, location: q.location, standing: standingState(q) };
  }
  return best;
}

// ===== APP-11-26D  START: long-standing settings carried to today's note, to be confirmed =====
/** Copy the last note's oxygen set-up, catheter, ostomy and PEG tube into today's note as settings (never over
 *  something already set today) and remember which ones still need a look. */
function applyStanding(p, last) {
  const st = settings.carryStanding !== false ? last?.standing : null;
  if (!st) return;
  const took = { from: last.date, o2: [], gu: [] };
  for (const root of ['o2', 'gu']) {
    if (!st[root] || p[root]) continue;
    p[root] = { ...st[root] };
    took[root] = Object.keys(st[root]);
  }
  if (took.o2.length || took.gu.length) p.carriedSet = took;
}

function carriedSetHtml(p) {
  const st = pendingStanding(p);
  if (!st) return '';
  return `<div class="banner" id="carriedset" style="margin-bottom:8px;display:block"><div>Carried from ${esc(formatDate(p.carriedSet.from))}, not confirmed today: <b>${esc(standingText(st))}</b></div>
    <div class="row" style="margin-top:6px"><button class="primary" data-act="standing-ok">Still right</button><button class="ghost" data-act="standing-drop">Remove</button></div></div>`;
}

function carriedSetRedraw(p) {
  const host = document.getElementById('carriedhost');
  if (host) host.innerHTML = carriedSetHtml(p);
}
// ===== APP-11-26D  END =====

function lastNoteLabel(last) {
  return `${formatDate(last.date)}${last.building && last.building !== day.building ? ` at ${bname(last.building)}` : ''}`;
}

function renderPatient() {
  const p = current();
  const header = `
    <div class="top">
      <button class="ghost" data-act="back">‹ List</button>
      <div class="grow"><h1 class="mono" style="font-size:1rem">${esc(listLabel(p, view.i))}</h1></div>
      <span id="saved" class="pill p-good">${p.text ? 'Saved' : ''}</span>
      <button class="ghost small" data-act="edit-pt">Edit name</button>
      ${settings.buildings.length > 1 ? `<button class="bchip on small" data-act="pick-building" aria-haspopup="true">${esc(bname(day.building))} ▾</button>` : ''}
    </div>
    <div id="bpicker" class="bpicker" hidden></div>
    <div id="edit-pt-form" class="card" style="display:grid;gap:8px;margin-bottom:14px" hidden>
      <div class="small muted">Correct this patient's name or MRN. The note is kept.</div>
      <div class="row">
        <input id="ep-last" value="${esc(p.last)}" placeholder="Last name" autocomplete="off" autocapitalize="words" style="flex:1;min-width:0">
        <input id="ep-first" value="${esc(p.first)}" placeholder="First name" autocomplete="off" autocapitalize="words" style="flex:1;min-width:0">
      </div>
      <div class="row"><input id="ep-mrn" value="${esc(p.mrn)}" placeholder="MRN" autocomplete="off" inputmode="numeric" style="flex:1;min-width:0"></div>
      <div id="ep-msg" class="small" style="color:var(--bad)"></div>
      <div class="row"><span class="grow"></span>
        <button class="ghost" data-act="edit-pt-cancel">Cancel</button>
        <button class="primary" data-act="edit-pt-save">Save name</button></div>
    </div>`; // APP-11-22: Edit name

  const last = view.last;
  if (!p.text && p.location == null) {
    app.innerHTML = `${header}
      ${last ? `<div class="card" style="margin-bottom:14px">
        <div class="small muted">Last note, ${esc(lastNoteLabel(last))}</div>
        <div style="margin:6px 0 10px">${esc(last.note.length > 220 ? `${last.note.slice(0, 220)}…` : last.note)}</div>
        <button class="primary" data-act="carry" style="width:100%">Start from last note</button>
        <div class="small muted" style="margin-top:6px">Vitals are replaced with today's. Check pain and anything new.</div>
      </div>` : ''}
      <div class="prompt-title">Where was the patient assessed?</div>
      <div class="loc-grid">${settings.locations.map((l, i) => `
        <button data-act="loc" data-i="${i}"><b>${esc(l.key)}</b><span>${esc(l.label)}</span></button>`).join('')}</div>`;
    return;
  }
  if (!p.text && p.pain === undefined) {
    const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const pick = view.painPick;
    const key = (k) => `<button data-act="pain-pick" data-v="${k}" ${pick === k ? 'style="background:var(--accent);color:var(--accent-ink);border-color:transparent"' : ''}>${k}</button>`;
    app.innerHTML = `${header}<div class="prompt-title">Pain today, out of 10</div>
      <div class="keypad">
        ${keys.map(key).join('')}
        <button class="skip" data-act="pain" data-v="">Skip</button>
        ${key(0)}${key(10)}
      </div>
      ${painExtras(p)}
      <button class="primary" data-act="pain" data-v="${pick ?? ''}" ${pick == null ? 'disabled' : ''} style="width:100%;margin-top:14px;min-height:52px">
        ${pick == null ? 'Tap a number' : `Continue with ${esc(painPhrase({ ...p, pain: pick }))}`}</button>`;
    return;
  }
  if (!p.text) {
    const loc = settings.locations[p.location];
    p.text = renderTemplate(settings, { locationText: loc?.text, pain: p.pain, vitals: p.vitals, painText: painPhrase(p) }) + ' ';
    if (settings.varyWording !== false) p.text = varyWording(p.text, last?.note); // APP-11-11
    p.status = 'progress';
    p.fresh = true;
    applyStanding(p, last); // APP-11-26D
    saveDay(day);
  }

  const highPain = p.pain != null && p.pain >= settings.highPain && /pain(?: remains| level| is)? within acceptable limits/i.test(p.text); // APP-11-11: any of the wordings
  app.innerHTML = `${header}
    <div class="editor-wrap">
      ${p.vitals ? `<div class="vitals-line">Vitals: ${esc(formatVitals(p.vitals, settings))}</div>` : ''}
      ${highPain ? `<div class="banner" id="painbanner">Pain is ${p.pain}/10. Is "pain within acceptable limits" still right?
        <button class="ghost" data-act="drop-pain-sentence">Remove that sentence</button></div>` : ''}
      ${p.carriedFrom && p.status !== 'done' ? `<div class="banner" style="margin-bottom:8px">Started from the ${esc(formatDate(p.carriedFrom))} note. Check pain, vitals and anything new.</div>` : ''}
      <div id="carriedhost">${carriedSetHtml(p)}</div>
      <div class="details" id="details"></div>
      <textarea id="note" spellcheck="true" autocapitalize="sentences" aria-label="Subjective note">${esc(p.text)}</textarea>
      <div class="detail-preview small" id="detail-preview"></div>
      <div id="clashbox"></div>
      ${last ? `<details class="card" id="compare" style="margin-bottom:10px"><summary>Compare with last note (${esc(lastNoteLabel(last))})</summary>
        <div class="small muted" style="margin:6px 0">
          <span style="background:var(--accent-soft);color:var(--accent);padding:0 3px">added today</span>
          <span style="color:var(--bad);text-decoration:line-through">not in today's note</span></div>
        <div id="compare-body" style="line-height:1.5"></div></details>` : ''}
      <div class="row">
        <button class="primary grow" data-act="done">${p.status === 'done' ? 'Save and back to list' : 'Done with patient'}</button>
        <button data-act="copy">Copy</button>
        <button class="ghost danger" data-act="restart">Start over</button>
        <button class="ghost danger" data-act="del-pt">Delete patient</button>
      </div>
      <div id="del-pt-confirm" class="banner" hidden>Remove ${esc(p.last)}, ${esc(p.first)} and their note from this day? The list will renumber.
        <button class="danger" data-act="del-pt-yes">Delete patient</button><button data-act="del-pt-no">Keep</button></div>
      <div id="restart-confirm" class="banner" hidden>Replace this note with a fresh template?
        <button class="danger" data-act="restart-yes">Replace</button><button data-act="restart-no">Keep</button></div>
    </div>`;
  mountPhraseBar();
  // A fresh note opens the first detail so they can be stepped through; all are optional.
  mountDetails(p, p.fresh ? DETAILS[0].key : null);
  if (p.fresh) { delete p.fresh; saveDay(day); }

  const ta = app.querySelector('#note');
  ta.addEventListener('input', (e) => {
    document.getElementById('saved').textContent = '…';
    if (e.inputType === 'insertText' || e.inputType === 'insertCompositionText' || e.inputType === undefined) {
      const pos = ta.selectionStart;
      const hit = expandShortcut(ta.value.slice(0, pos), settings.phrases);
      if (hit) {
        ta.setRangeText(hit.text, hit.start, hit.end, 'end');
      }
    }
    scheduleSave();
  });
  ta.addEventListener('blur', () => { flushNote(); refreshPreview(); });
  ta.addEventListener('input', showBlankChip); // APP-11-11
  showBlankChip();
  const cmp = app.querySelector('#compare');
  if (cmp) {
    const draw = () => {
      if (!cmp.open) return;
      app.querySelector('#compare-body').innerHTML = wordDiff(last.note, fullNote({ ...p, text: ta.value })).map(({ t, w }) => (t === 'same' ? esc(w)
        : t === 'add' ? `<span style="background:var(--accent-soft);color:var(--accent)">${esc(w)}</span>`
          : `<span style="color:var(--bad);text-decoration:line-through">${esc(w)}</span>`)).join(' ');
    };
    cmp.addEventListener('toggle', draw);
    ta.addEventListener('input', () => { clearTimeout(cmp._t); cmp._t = setTimeout(draw, 400); });
  }
}

// Quick details: a row of buttons above the note. Tap one to fill it in, tap again to close it.
// Filled details are shown under the note and added to the end of it when sent or copied.
function mountDetails(p, openKey) {
  const box = app.querySelector('#details');
  p.fields ??= {};
  let open = openKey;
  const filled = (d) => (d.key === 'pain' ? p.pain != null : d.key === 'abx' ? activeAbx(p.mrn, day.date).length > 0
    : d.key === 'o2' ? !!o2Sentence(p) // APP-11-25
    : d.key === 'ordered' ? orderedItems(p).length > 0 // APP-11-25B
    : d.key === 'bm' ? !!(p.bm?.date || guSentence(p)) : d.key === 'exam' ? (examLines(p).length > 0 || !!incisionSubjective(p)) // APP-11-20; APP-11-25C
      : d.key === 'dx' ? (p.tapDx || []).length > 0 : d.key === 'meds' ? (p.tapMeds || []).length > 0 // APP-11-22-CHART
      : String(p.fields[d.key] ?? '').trim() !== '');
  const filledAbx = () => activeAbx(p.mrn, day.date).length;
  const shown = (d) => {
    if (d.key === 'pain') return p.pain != null ? `${p.pain}/10` : '';
    if (d.key === 'abx') return String(filledAbx() || '');
    if (d.key === 'ordered') return String(orderedItems(p).length || ''); // APP-11-25B
    if (d.key === 'o2') return [p.o2?.room ? 'RA' : '', o2Liters(p.o2?.liters) ? `${o2Liters(p.o2.liters)} L` : '', p.o2?.sob === 'denies' ? 'no SOB' : p.o2?.sob === 'reports' ? 'SOB' : '', p.o2?.tx ? 'tx' : ''].filter(Boolean).join(', '); // APP-11-25
    if (d.key === 'bm') return [guSentence(p) ? 'GU' : '', bmSentence(p).replace(/^Last BM |\.$/g, '')].filter(Boolean).join(', '); // APP-11-20; APP-11-25
    if (d.key === 'exam') return String(examLines(p).length || '');
    if (d.key === 'dx') return String((p.tapDx || []).length || ''); // APP-11-22-CHART
    if (d.key === 'meds') return String((p.tapMeds || []).length || '');
    const v = String(p.fields[d.key] ?? '');
    return d.unit === '%' && /\d$/.test(v) ? `${v}%` : v;
  };

  const preview = () => {
    if (!box.isConnected) return;
    // Show the whole note as it will be sent, with the details in their places.
    const ex = [...examLines(p), ...tapLines(p)]; // APP-11-20, APP-11-22-CHART: these lines are shown under the note, as they will be sent
    const ta = document.getElementById('note');
    const shown = ta ? { ...p, text: ta.value } : p;
    const cbox = app.querySelector('#clashbox'); // APP-11-26B: things in this note that do not fit together
    if (cbox) cbox.innerHTML = clashHtml(noteClashes(shown));
    if (!detailSentences(p).length && !ex.length) { app.querySelector('#detail-preview').innerHTML = ''; return; }
    app.querySelector('#detail-preview').innerHTML = `<div class="muted">As it will be sent:</div>${esc(fullNote(shown))}${ex.map((x) => `<div>${esc(x)}</div>`).join('')}`;
  };
  const save = async () => {
    p.updatedAt = Date.now();
    await saveDay(day);
    preview();
  };

  const panel = (d) => {
    const idx = DETAILS.indexOf(d);
    const next = DETAILS[idx + 1];
    if (d.key === 'abx') return `<div class="dpanel">${abxPanel(p)}${panelNav(next, false)}</div>`;
    if (d.key === 'o2') return `<div class="dpanel">${o2Panel(p)}${panelNav(next)}</div>`; // APP-11-25
    if (d.key === 'ordered') return `<div class="dpanel">${orderedPanel(p)}${panelNav(next)}</div>`; // APP-11-25B
    if (d.key === 'bm') return `<div class="dpanel">${bmPanel(p)}${guPanel(p)}${panelNav(next)}</div>`; // APP-11-20; APP-11-25
    if (d.key === 'exam') return `<div class="dpanel">${examPanel(p)}${panelNav(next)}</div>`;
    if (d.key === 'dx' || d.key === 'meds') return `<div class="dpanel">${chartPanel(p, d.key)}${panelNav(next)}</div>`; // APP-11-22-CHART
    if (d.key === 'pain') {
      return `<div class="dpanel"><div class="dkeys">
        ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => `<button data-dv="${k}" class="${p.pain === k ? 'on' : ''}">${k}</button>`).join('')}
        </div>${painExtras(p)}${panelNav(next)}</div>`;
    }
    return `<div class="dpanel">
      ${d.quick ? `<div class="dkeys">${d.quick.map((q) => `<button data-dv="${esc(q)}" class="${p.fields[d.key] === q ? 'on' : ''}">${esc(q)}${d.unit === '%' ? '%' : ''}</button>`).join('')}</div>` : ''}
      ${d.presets.map((q) => `<button class="dpreset ${p.fields[d.key] === q ? 'on' : ''}" data-dv="${esc(q)}">${esc(q)}</button>`).join('')}
      <div class="row"><input id="dinput" value="${esc(p.fields[d.key] ?? '')}" placeholder="${d.unit ? `Number (${d.unit}) or type…` : 'Type…'}" autocomplete="off" style="flex:1" ${d.unit ? 'inputmode="text"' : ''}></div>
      ${panelNav(next)}</div>`;
  };
  const panelNav = (next, clear = true) => `<div class="row dnav">
      ${clear ? '<button class="ghost" data-dclear>Clear</button>' : '<span class="grow"></span>'}
      ${next ? `<button data-dnext="${next.key}">Next: ${esc(next.label)} ›</button>` : ''}
      <button class="primary" data-dclose>Done</button></div>`;

  const draw = () => {
    const d = DETAILS.find((x) => x.key === open);
    // APP-11-26E: the row of detail buttons folds to one line that says which are filled; remembered on this phone
    const chipsShut = !!settings.folded?.chips;
    const set = DETAILS.filter(filled).map((x) => x.label);
    box.innerHTML = `<button class="ghost" data-chipsfold aria-expanded="${!chipsShut}" style="text-align:left;min-height:36px;padding:2px 0;width:100%">
        <b>${chipsShut ? '▸' : '▾'} Details</b>${chipsShut ? `<span class="small muted"> - ${set.length ? esc(set.join(', ')) : 'none filled'}</span>` : ''}</button>
      <div class="dchips" ${chipsShut ? 'hidden' : ''}>${DETAILS.map((x) => `
      <button class="dchip ${filled(x) ? 'filled' : ''} ${x.key === open ? 'open' : ''}" data-dkey="${x.key}" aria-expanded="${x.key === open}">
        ${esc(x.label)}${filled(x) ? ` <small>${esc(shown(x).slice(0, 14))}${shown(x).length > 14 ? '…' : ''}</small>` : ''}</button>`).join('')}</div>
      ${d && !chipsShut ? panel(d) : ''}`;
    if (MU_PANELS.includes(open)) muFill(box, open); // APP-11-26C
    wireAbxForm(box);
    box.querySelector('#dinput')?.addEventListener('input', (e) => {
      p.fields[open] = e.target.value;
      clearTimeout(box._t);
      box._t = setTimeout(save, 300);
    });
  };

  // APP-11-20: typing in the BM date box or in an exam box
  box.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'bmdate') {
      const iso = parseBmDate(t.value, day.date);
      const hint = box.querySelector('#bmhint');
      if (iso) p.bm = { date: iso, dos: day.date, how: p.bm?.how || settings.bmHow || 'both', kind: p.bm?.kind };
      else if (!t.value.trim()) delete p.bm;
      if (hint) hint.textContent = iso ? bmSentence(p) : t.value.trim() ? 'Type the date as 11/15 or 11/15/26. It cannot be after the date of service.' : '';
      if (!iso && t.value.trim()) return;
    } else if (t.id === 'o2other') { // APP-11-25: liters typed instead of tapped
      p.o2 ??= {};
      if (t.value.trim()) { p.o2.liters = t.value.trim(); delete p.o2.room; } else delete p.o2.liters;
      const hint = box.querySelector('#o2hint');
      if (hint) hint.textContent = t.value.trim() && !o2Liters(t.value) ? 'Type the liters as a number, for example 2 or 2.5.' : o2Sentence(p);
    } else if (t.id === 'incother') { // APP-11-25C: the incision's site, typed
      p.incision ??= {};
      if (t.value.trim()) { p.incision.siteOther = t.value; delete p.incision.site; } else delete p.incision.siteOther;
      const hint = box.querySelector('#inchint');
      if (hint) hint.textContent = [incisionExam(p), incisionSubjective(p)].filter(Boolean).join(' ');
    } else if (t.id === 'ordus' || t.id === 'ordother') { // APP-11-25B: an ultrasound area or another order, typed
      p.ordered ??= {};
      const k = t.id === 'ordus' ? 'usOther' : 'other';
      if (t.value.trim()) p.ordered[k] = t.value; else delete p.ordered[k];
      const hint = box.querySelector('#ordhint');
      if (hint) hint.textContent = orderedSentence(p);
    } else if (t.dataset.exinput) {
      p.exam ??= {};
      if (t.value.trim()) p.exam[t.dataset.exinput] = t.value; else delete p.exam[t.dataset.exinput];
    } else return;
    clearTimeout(box._t2);
    box._t2 = setTimeout(save, 300);
  });

  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (MU_PANELS.includes(open) && b.closest('.dpanel') && muCounts(b)) { // APP-11-26C: count the tap for "Most used"
      settings.used ??= {};
      const u = (settings.used[open] ??= {});
      u[muSig(b)] = (u[muSig(b)] || 0) + 1;
      saveSettings(settings);
    }
    if (p.carriedSet && (open === 'o2' || open === 'bm') && b.closest('.dpanel') && muCounts(b)) { // APP-11-26D: you are setting it yourself now
      p.carriedSet[open === 'o2' ? 'o2' : 'gu'] = [];
      if (!p.carriedSet.o2.length && !p.carriedSet.gu.length) delete p.carriedSet;
      carriedSetRedraw(p);
    }
    if ('chipsfold' in b.dataset) { // APP-11-26E: fold or open the row of detail buttons; an open panel closes with it
      settings.folded = { ...(settings.folded || {}), chips: !settings.folded?.chips };
      if (settings.folded.chips) open = null;
      await saveSettings(settings);
    } else if (b.dataset.sfold) { // APP-11-26C: fold or open one section; remembered
      settings.folded = { ...(settings.folded || {}), [`s.${b.dataset.sfold}`]: !secShut(b.dataset.sfold) };
      await saveSettings(settings);
    } else if (b.dataset.sfoldall) {
      const next = { ...(settings.folded || {}) };
      for (const id of PANEL_SECS[b.dataset.sfoldall] || []) next[`s.${id}`] = b.dataset.to === 'shut';
      settings.folded = next;
      await saveSettings(settings);
    }
    else if (b.dataset.abx) { await abxAction(p, b); if (!box.isConnected) return; await save(); }
    else if (b.dataset.dkey) {
      open = open === b.dataset.dkey ? null : b.dataset.dkey; abxMode = null;
      // APP-11-22-CHART: opening Dx or Meds asks the computer again when the chart on the phone is over 10 minutes old
      if ((open === 'dx' || open === 'meds') && Date.now() - (charts[day.building]?.at || 0) > 600000) pullChart();
    }
    else if (b.dataset.dnext) open = b.dataset.dnext;
    else if ('dclose' in b.dataset) open = null;
    else if ('dclear' in b.dataset) {
      if (open === 'pain') setPain(p, null);
      else if (open === 'o2') delete p.o2; // APP-11-25
      else if (open === 'ordered') delete p.ordered; // APP-11-25B
      else if (open === 'bm') { delete p.bm; delete p.gu; } // APP-11-20; APP-11-25
      else if (open === 'exam') { delete p.exam; delete p.incision; delete p.edema; delete p.exn; } // APP-11-25C, APP-11-25D, APP-11-25E: the incision is part of the exam
      else if (open === 'dx') delete p.tapDx; // APP-11-22-CHART
      else if (open === 'meds') delete p.tapMeds;
      else delete p.fields[open];
      await save();
    } else if (b.dataset.bm) { // APP-11-20: Yesterday / Today, counted from the date of service
      const date = b.dataset.bm === 'today' ? day.date : addDays(day.date, -1);
      if (p.bm?.date === date) delete p.bm; else p.bm = { date, dos: day.date, how: p.bm?.how || settings.bmHow || 'both', kind: p.bm?.kind };
      await save();
    } else if (b.dataset.bmkind) { // APP-11-22: firm / loose / diarrhea, once a day is picked
      if (p.bm) { p.bm.kind = p.bm.kind === b.dataset.bmkind ? undefined : b.dataset.bmkind; await save(); }
    } else if (b.dataset.bmhow) {
      settings.bmHow = b.dataset.bmhow;
      await saveSettings(settings);
      if (p.bm) { p.bm.how = b.dataset.bmhow; await save(); }
    } else if (b.dataset.o2l) { // APP-11-25: liters; tap the same number again to take it off
      p.o2 ??= {};
      if (o2Liters(p.o2.liters) === b.dataset.o2l) delete p.o2.liters; else { p.o2.liters = b.dataset.o2l; delete p.o2.room; }
      await save();
    } else if (b.dataset.o2sob) {
      p.o2 ??= {};
      if (p.o2.sob === b.dataset.o2sob) delete p.o2.sob; else p.o2.sob = b.dataset.o2sob;
      await save();
    } else if ('o2tx' in b.dataset) {
      p.o2 ??= {};
      if (p.o2.tx) delete p.o2.tx; else p.o2.tx = true;
      await save();
    } else if ('gudenies' in b.dataset) { // APP-11-25: denies and a complaint are never both on
      p.gu ??= {};
      if (p.gu.denies) delete p.gu.denies; else { p.gu.denies = true; delete p.gu.sx; }
      await save();
    } else if (b.dataset.gusx) {
      p.gu ??= {};
      const list = p.gu.sx || [];
      p.gu.sx = list.includes(b.dataset.gusx) ? list.filter((x) => x !== b.dataset.gusx) : [...list, b.dataset.gusx];
      if (p.gu.sx.length) delete p.gu.denies; else delete p.gu.sx;
      await save();
    } else if (b.dataset.gucath) { // picking Foley or Suprapubic also turns on "denies any complications"; tap that to take it off
      p.gu ??= {};
      if (p.gu.cath === b.dataset.gucath) { delete p.gu.cath; delete p.gu.cathOk; } else { p.gu.cath = b.dataset.gucath; if (!(p.gu.cathSx || []).length) p.gu.cathOk = true; }
      tidyPicks(p, '');
      await save();
    } else if ('gucathok' in b.dataset) {
      if (p.gu?.cath) { p.gu.cathOk = !p.gu.cathOk; if (p.gu.cathOk) delete p.gu.cathSx; await save(); }
    } else if (b.dataset.guost) {
      p.gu ??= {};
      if (p.gu.ostomy === b.dataset.guost) delete p.gu.ostomy; else p.gu.ostomy = b.dataset.guost;
      tidyPicks(p, '');
      await save();
    } else if (b.dataset.pick) { // APP-11-25B: one handler for the added choices - data-pick="o2.via" data-v="mask"
      const [root, key] = b.dataset.pick.split('.');
      const o = (p[root] ??= {});
      const v = b.dataset.v;
      if (b.dataset.kind === 'multi') {
        const list = o[key] || [];
        o[key] = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
        if (!o[key].length) delete o[key];
      } else if (v == null) { if (o[key]) delete o[key]; else o[key] = true; }
      else if (o[key] === v) delete o[key]; else o[key] = v;
      tidyPicks(p, b.dataset.pick);
      await save();
    } else if (b.dataset.tap) { // APP-11-22-CHART: tap a diagnosis or a medication to add it, tap it again to take it off
      const k = b.dataset.tap === 'dx' ? 'tapDx' : 'tapMeds';
      const list = p[k] || [];
      p[k] = list.includes(b.dataset.v) ? list.filter((x) => x !== b.dataset.v) : [...list, b.dataset.v];
      if (!p[k].length) delete p[k];
      await save();
    } else if (b.dataset.chart === 'refresh') {
      b.disabled = true;
      b.textContent = 'Asking the computer…';
      await pullChart(day.building, { loud: true });
      if (!box.isConnected) return;
    } else if (b.dataset.exsys) { // APP-11-20: tap an exam finding to use it, tap it again to clear it
      p.exam ??= {};
      if (p.exam[b.dataset.exsys] === b.dataset.exv) delete p.exam[b.dataset.exsys]; else p.exam[b.dataset.exsys] = b.dataset.exv;
      if (b.dataset.exsys === 'Ext' && EDEMA_PRESET_RE.test(p.exam.Ext || '')) delete p.edema; // APP-11-25D: an edema choice replaces the by-leg grades
      await save();
    } else if (b.dataset.dv != null) {
      if (open === 'pain') setPain(p, +b.dataset.dv);
      else p.fields[open] = p.fields[open] === b.dataset.dv ? '' : b.dataset.dv;
      await save();
    }
    draw();
  });
  draw();
  preview();
  refreshPreview = preview;
  redrawDetails = () => { if (box.isConnected) { draw(); preview(); } };
  chartRedraw = () => { if (box.isConnected && (open === 'dx' || open === 'meds')) draw(); }; // APP-11-22-CHART: never redraws a panel being typed in
}

// ===== APP-11-20  START: BM and Exam panels =====
// BM: Yesterday and Today are counted from the date of service; any other day is typed as a date.
function bmPanel(p) {
  const b = p.bm;
  const yest = addDays(day.date, -1);
  const how = b?.how || settings.bmHow || 'both';
  const typed = b?.date && b.date !== day.date && b.date !== yest ? (() => { const [y, m, d] = b.date.split('-').map(Number); return `${m}/${d}/${String(y).slice(-2)}`; })() : '';
  return foldAllRow('bm') + sect('bm.bm', 'Last BM', bmSentence(p), `
    <div class="row">
      <button class="dpreset ${b?.date === yest ? 'on' : ''}" data-bm="yesterday">Yesterday</button>
      <button class="dpreset ${b?.date === day.date ? 'on' : ''}" data-bm="today">Today</button>
      <input id="bmdate" value="${esc(typed)}" placeholder="or date: 11/15" inputmode="text" autocomplete="off" style="flex:1;min-width:9rem">
    </div>
    <div class="small muted">Stool (optional${b ? '' : '; pick the day first'})</div>
    <div class="row">${BM_KINDS.map((k) => `<button class="dpreset ${b?.kind === k ? 'on' : ''}" data-bmkind="${k}" ${b ? '' : 'disabled'}>${k[0].toUpperCase()}${k.slice(1)}</button>`).join('')}</div>
    <div class="small muted">How it is written</div>
    <div class="row">${BM_HOW.map(([k, label]) => `<button class="dpreset ${how === k ? 'on' : ''}" data-bmhow="${k}">${esc(label)}</button>`).join('')}</div>
    <div class="small" id="bmhint">${esc(bmSentence(p))}</div>`);
}

// ===== APP-11-25  START: O2 panel; urinary, catheter and ostomy inside the BM panel =====
function o2Panel(p) {
  const o = p.o2 || {};
  const cur = o2Liters(o.liters);
  const typed = o.liters && !O2_LITERS.includes(cur) ? o.liters : '';
  const noteText = document.getElementById('note')?.value ?? p.text;
  const clash = o.sob === 'reports' && saysNoBreathingTrouble(noteText);
  const part = (x) => o2Sentence({ o2: x }); // what is set in one section, for its heading when folded
  return foldAllRow('o2') + sect('o2.oxygen', 'Oxygen', part({ liters: o.liters, via: o.via, when: o.when, room: o.room, pap: o.pap, wean: o.wean }), `
    <div class="small muted">Liters of O2</div>
    <div class="dkeys">${O2_LITERS.map((l) => `<button data-o2l="${l}" class="${cur === l ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="row"><input id="o2other" value="${esc(typed)}" placeholder="or type: 2.5" inputmode="decimal" autocomplete="off" style="flex:1;min-width:9rem">
      ${pk('o2.room', null, 'Room air', !!o.room)}</div>
    <div class="small muted">Given by</div>
    <div class="row">${O2_DELIVERY.map((v) => pk('o2.via', v, cap(v), o.via === v)).join('')}</div>
    <div class="small muted">When</div>
    <div class="row">${O2_WHEN.map((v) => pk('o2.when', v, cap(v), o.when === v)).join('')}</div>
    <div class="row">${O2_PAP.map((v) => pk('o2.pap', v, v, o.pap === v)).join('')}${pk('o2.wean', null, 'Weaning O2 as tolerated', !!o.wean)}</div>`)
    + sect('o2.symptoms', 'Breathing symptoms', part({ sob: o.sob, cough: o.cough, wheeze: o.wheeze, tx: o.tx }), `
    <div class="small muted">Shortness of breath</div>
    <div class="row">
      <button class="dpreset ${o.sob === 'denies' ? 'on' : ''}" data-o2sob="denies">Denies shortness of breath</button>
      <button class="dpreset ${o.sob === 'reports' ? 'on' : ''}" data-o2sob="reports">Has shortness of breath</button>
    </div>
    <div class="small muted">Cough</div>
    <div class="row">${pk('o2.cough', 'denies', 'Denies cough', o.cough === 'denies')}${COUGH_KINDS.map((v) => pk('o2.cough', v, `${cap(v)} cough`, o.cough === v)).join('')}</div>
    <div class="small muted">Wheezing</div>
    <div class="row">${pk('o2.wheeze', 'denies', 'Denies wheezing', o.wheeze === 'denies')}${pk('o2.wheeze', 'reports', 'Has wheezing', o.wheeze === 'reports')}</div>
    <div class="row"><button class="dpreset ${o.tx ? 'on' : ''}" data-o2tx>Continues breathing treatments as ordered</button></div>`)
    + `${clash ? '<div class="small" id="o2clash"><b>Check the note:</b> it still says the patient denies breathing complications. Change that sentence if it no longer fits.</div>' : ''}
    <div class="small" id="o2hint">${esc(o2Sentence(p))}</div>`;
}

function guPanel(p) {
  const g = p.gu || {};
  const sx = g.sx || [];
  const noCath = g.cath ? '' : 'disabled';
  const noOst = g.ostomy ? '' : 'disabled';
  const part = (o) => guSentence({ gu: o }); // what is set in one section, for its heading when folded
  return sect('bm.bowel', 'Bowel complaints', part({ gi: g.gi }), `
    <div class="small muted">Bowel - pt complains of (tap any)</div>
    <div class="row">${GI_SYMPTOMS.map((s) => pk('gu.gi', s, cap(s), (g.gi || []).includes(s), 'data-kind="multi"')).join('')}</div>`)
    + sect('bm.urinary', 'Urinary', part({ denies: g.denies, sx: g.sx, urine: g.urine }), `
    <div class="row"><button class="dpreset ${g.denies && !sx.length ? 'on' : ''}" data-gudenies>Pt denies urinary complications</button></div>
    <div class="small muted">Pt complains of (tap any)</div>
    <div class="row">${GU_SYMPTOMS.map((s) => `<button class="dpreset ${sx.includes(s) ? 'on' : ''}" data-gusx="${esc(s)}">${esc(cap(s))}</button>`).join('')}</div>
    <div class="small muted">Urine</div>
    <div class="row">${URINE_LOOKS.map((v) => pk('gu.urine', v, cap(v), g.urine === v)).join('')}</div>`)
    + sect('bm.cath', 'Catheter', part({ cath: g.cath, cathOk: g.cathOk, cathSx: g.cathSx, drain: g.drain, trial: g.trial }), `
    <div class="row">${CATHETERS.map((c) => `<button class="dpreset ${g.cath === c ? 'on' : ''}" data-gucath="${c}">${c}</button>`).join('')}</div>
    <div class="row"><button class="dpreset ${g.cath && g.cathOk ? 'on' : ''}" data-gucathok ${noCath}>Denies any complications</button></div>
    <div class="small muted">Complains of${g.cath ? '' : ' (pick the catheter first)'}</div>
    <div class="row">${CATH_SYMPTOMS.map((s) => pk('gu.cathSx', s, cap(s), (g.cathSx || []).includes(s), `data-kind="multi" ${noCath}`)).join('')}</div>
    <div class="row">${pk('gu.drain', null, 'Draining clear yellow urine', !!g.drain, noCath)}${pk('gu.trial', null, 'Voiding trial planned', !!g.trial, noCath)}</div>`)
    + sect('bm.ostomy', 'Ostomy', part({ ostomy: g.ostomy, ostOk: g.ostOk, stoma: g.stoma, output: g.output, skin: g.skin }), `
    <div class="row">${OSTOMIES.map((c) => `<button class="dpreset ${g.ostomy === c ? 'on' : ''}" data-guost="${c}">${c}</button>`).join('')}</div>
    <div class="row">${pk('gu.ostOk', null, 'Denies any complications', !!g.ostOk, noOst)}${pk('gu.stoma', null, 'Stoma pink and moist', !!g.stoma, noOst)}</div>
    <div class="small muted">Output${g.ostomy ? '' : ' (pick the ostomy first)'}</div>
    <div class="row">${OSTOMY_OUTPUT.map(([k]) => pk('gu.output', k, cap(k), g.output === k, noOst)).join('')}</div>
    <div class="small muted">Skin around stoma</div>
    <div class="row">${STOMA_SKIN.map((v) => pk('gu.skin', v, cap(v), g.skin === v, noOst)).join('')}</div>`)
    + sect('bm.peg', 'PEG tube', part({ peg: g.peg, pegOk: g.pegOk }), `
    <div class="row">${pk('gu.peg', null, 'PEG tube', !!g.peg)}${pk('gu.pegOk', null, 'Site clean and dry', !!g.pegOk, g.peg ? '' : 'disabled')}</div>`)
    + `<div class="small" id="guhint">${esc(guSentence(p))}</div>`;
}
// ===== APP-11-25  END =====

// ===== APP-11-25B  START: shared button maker, the rules between choices, the Ordered panel =====
const cap = (t) => t[0].toUpperCase() + t.slice(1);
// One choice button. data-pick="o2.via" names where it is kept; with a value it is one-of, without it is on/off.
const pk = (path, v, label, on, extra = '') => `<button class="dpreset ${on ? 'on' : ''}" data-pick="${path}"${v != null ? ` data-v="${esc(v)}"` : ''} ${extra}>${esc(label)}</button>`;

// ===== APP-11-26C  START: sections that fold inside the long panels, and a "Most used" row =====
// A folded section is still in the page (hidden), so what is set in it keeps working and its heading says what is set.
// Which sections are folded is remembered on this phone (settings.folded['s.<id>']).
const PANEL_SECS = {
  o2: ['o2.oxygen', 'o2.symptoms'],
  bm: ['bm.bm', 'bm.bowel', 'bm.urinary', 'bm.cath', 'bm.ostomy', 'bm.peg'],
  ordered: ['ord.labs', 'ord.imaging', 'ord.other'],
  exam: EXAM_SYSTEMS.map((x) => `exam.${x.key}`),
};
const secShut = (id) => !!settings.folded?.[`s.${id}`];
/** One folding section: heading (with what is set when folded), optional extra controls on the heading row, body. */
function sect(id, title, summary, inner, extra = '') {
  const shut = secShut(id);
  return `<div class="psec" data-sec="${id}" style="border-top:1px solid var(--line, #d8dde6);padding-top:4px;margin-top:6px">
    <div class="row" style="align-items:center"><button class="ghost grow" data-sfold="${id}" aria-expanded="${!shut}" style="text-align:left;min-height:38px;padding:4px 0"><b>${shut ? '▸' : '▾'} ${esc(title)}</b>${shut && summary ? `<span class="small muted"> - ${esc(summary)}</span>` : ''}</button>${extra}</div>
    <div class="psec-body" ${shut ? 'hidden' : ''}>${inner}</div></div>`;
}
const foldAllRow = (panel) => {
  const all = PANEL_SECS[panel].every(secShut);
  return `<div class="row" style="justify-content:flex-end"><button class="ghost" data-sfoldall="${panel}" data-to="${all ? 'open' : 'shut'}" style="min-height:34px;padding:2px 6px">${all ? 'Open all' : 'Fold all'}</button></div><div id="mostused"></div>`;
};
// "Most used": the choices tapped 3 times or more in this panel, the six most tapped, as a row at the top.
// Each is a copy of the real button, so it does exactly the same thing and shows the same on / off state.
const MU_PANELS = ['o2', 'bm', 'exam', 'ordered'];
const MU_MIN = 3;
const MU_SHOWN = 6;
const muSig = (b) => JSON.stringify(Object.entries(b.dataset).filter(([k]) => k !== 'mu').sort());
const muCounts = (b) => !['sfold', 'sfoldall', 'dclear', 'dnext', 'dclose', 'dkey', 'chart'].some((k) => k in b.dataset) && !b.disabled;
function muFill(box, panel) {
  const host = box.querySelector('#mostused');
  if (!host) return;
  const top = Object.entries(settings.used?.[panel] || {}).filter(([, n]) => n >= MU_MIN).sort((a, b) => b[1] - a[1]).slice(0, MU_SHOWN);
  const real = [...box.querySelectorAll('.dpanel button')].filter((x) => !x.closest('#mostused'));
  const rows = [];
  for (const [sig] of top) {
    const el = real.find((x) => muSig(x) === sig);
    if (!el) continue;
    const copy = el.cloneNode(true);
    copy.dataset.mu = '1';
    copy.removeAttribute('style');
    const label = el.closest('.row, .dkeys')?.previousElementSibling;
    const text = el.textContent.trim();
    if (text.length <= 9 && label && label.classList.contains('muted')) copy.textContent = `${label.textContent.split('(')[0].trim()}: ${text}`;
    rows.push(copy);
  }
  if (!rows.length) return;
  host.innerHTML = '<div class="small muted">Most used</div><div class="row" id="murow"></div>';
  rows.forEach((x) => host.querySelector('#murow').appendChild(x));
}
// ===== APP-11-26C  END =====

/** Choices that cannot stand together, and extras that need their main choice. Called after every tap. */
function tidyPicks(p, what) {
  const o = p.o2;
  if (o) {
    if (what === 'o2.room' && o.room) { delete o.liters; delete o.via; delete o.when; delete o.wean; }
    else if ((what === 'o2.via' || what === 'o2.when' || what === 'o2.wean') && (o.via || o.when || o.wean)) delete o.room;
  }
  const g = p.gu;
  if (g) {
    if (what === 'gu.cathSx' && (g.cathSx || []).length) delete g.cathOk;
    if (!g.cath) { delete g.cathOk; delete g.cathSx; delete g.drain; delete g.trial; }
    if (!g.ostomy) { delete g.ostOk; delete g.stoma; delete g.output; delete g.skin; }
    if (!g.peg) delete g.pegOk;
  }
  const r = p.ordered;
  if (r && Object.keys(r).length === 0) delete p.ordered;
  const ed = p.edema; // APP-11-25D: a grade by leg replaces an edema choice picked above it; the kind needs a leg with edema
  if (ed) {
    if ((what === 'edema.left' || what === 'edema.right') && (ed.left || ed.right) && EDEMA_PRESET_RE.test(p.exam?.Ext || '')) delete p.exam.Ext;
    if (![ed.left, ed.right].some((g) => g && g !== 'none')) delete ed.kind;
    if (Object.keys(ed).length === 0) delete p.edema;
  }
  if (p.exn && !(p.exn.sys || []).length) delete p.exn; // APP-11-25E
  const c = p.incision; // APP-11-25C: a tapped site replaces a typed one
  if (c) { if (what === 'incision.site' && c.site) delete c.siteOther; if (Object.keys(c).length === 0) delete p.incision; }
}

// Ordered: labs and tests ordered today -> "Ordered CBC, BMP and CXR." at the end of the note.
function orderedPanel(p) {
  const r = p.ordered || {};
  const has = (k, v) => (r[k] || []).includes(v);
  const part = (x) => orderedItems({ ordered: x }).join(', '); // what is set in one section, for its heading when folded
  return foldAllRow('ordered') + sect('ord.labs', 'Labs', part({ labs: r.labs }), `
    <div class="row">${ORDER_LABS.map((v) => pk('ordered.labs', v, v, has('labs', v), 'data-kind="multi"')).join('')}</div>`)
    + sect('ord.imaging', 'Imaging and tests', part({ tests: r.tests, us: r.us, usOther: r.usOther, dopSide: r.dopSide, dopLimb: r.dopLimb }), `
    <div class="small muted">Tests</div>
    <div class="row">${ORDER_TESTS.map((v) => pk('ordered.tests', v, v, has('tests', v), 'data-kind="multi"')).join('')}</div>
    <div class="small muted">Ultrasound of</div>
    <div class="row">${US_AREAS.map((v) => pk('ordered.us', v, cap(v), has('us', v), 'data-kind="multi"')).join('')}
      <input id="ordus" value="${esc(r.usOther ?? '')}" placeholder="or type the area" autocomplete="off" style="flex:1;min-width:9rem"></div>
    <div class="small muted">Ultrasound doppler of extremity (pick the side and upper or lower)</div>
    <div class="row">${DOPPLER_SIDES.map((v) => pk('ordered.dopSide', v, cap(v), r.dopSide === v)).join('')}</div>
    <div class="row">${DOPPLER_LIMBS.map((v) => pk('ordered.dopLimb', v, `${cap(v)} extremity`, r.dopLimb === v)).join('')}</div>`)
    + sect('ord.other', 'Anything else ordered', part({ other: r.other }), `
    <div class="row"><input id="ordother" value="${esc(r.other ?? '')}" placeholder="Type…" autocomplete="off" style="flex:1"></div>`)
    + `<div class="small" id="ordhint">${esc(orderedSentence(p))}</div>`;
}
// ===== APP-11-25B  END =====

// Exam: one box per body system. Only the systems filled in are sent, as "Exam: Resp: ..." lines under the patient.
function examPanel(p) {
  const e = p.exam || {};
  const lines = Object.fromEntries(examLines(p).map((ln) => ln.match(/^Exam: ([^:]+): (.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  return `<div class="small muted">Fill in only what you examined or what changed. The rest of the note's exam is left as it is. "Put in note" also writes that system's finding in the note text, as "On exam: ...".</div>`
    + foldAllRow('exam')
    + EXAM_SYSTEMS.map((s) => sect(`exam.${s.key}`, s.key, lines[s.key] || '', `<div>
      ${s.presets.map((q) => `<button class="dpreset ${e[s.key] === q ? 'on' : ''}" data-exsys="${esc(s.key)}" data-exv="${esc(q)}" style="margin:0 6px 6px 0">${esc(q)}</button>`).join('')}
      <input data-exinput="${esc(s.key)}" value="${esc(e[s.key] ?? '')}" placeholder="Type or edit ${esc(s.key)}…" autocomplete="off" style="width:100%">
      ${s.key === 'Skin' ? incisionPanel(p) : ''}${s.key === 'Ext' ? edemaPanel(p) : ''}
    </div>`, pk('exn.sys', s.key, (p.exn?.sys || []).includes(s.key) ? 'In note' : 'Put in note', (p.exn?.sys || []).includes(s.key), 'data-kind="multi" style="min-height:36px;padding:4px 10px"') /* APP-11-26E: the label says which state it is in */)).join('');
}

// ===== APP-11-25D  START: edema for each leg, under Ext =====
function edemaPanel(p) {
  const e = p.edema || {};
  const any = [e.left, e.right].some((g) => g && g !== 'none');
  const row = (side) => `<div class="small muted">${cap(side)} leg</div>
    <div class="row">${EDEMA_GRADES.map((g) => pk(`edema.${side}`, g, cap(g), e[side] === g)).join('')}</div>`;
  return `<div style="border:1px solid var(--line, #d8dde6);border-radius:10px;padding:8px;margin-top:8px">
    <div class="small" style="font-weight:700">Edema by leg</div>
    ${row('left')}${row('right')}
    <div class="small muted">Kind (optional)</div>
    <div class="row">${EDEMA_KINDS.map((k) => pk('edema.kind', k, cap(k), e.kind === k, any ? '' : 'disabled')).join('')}</div>
    <div class="small" id="edhint">${esc(edemaExam(p))}</div>
  </div>`;
}
// ===== APP-11-25D  END =====

// ===== APP-11-25C  START: surgical incision, under Skin =====
// Where it is, what was found (goes into the exam's Skin line), and what you did (goes into the note text).
function incisionPanel(p) {
  const c = p.incision || {};
  const clash = c.act === 'Visualized incision' && c.state === 'dressing';
  return `<div style="border:1px solid var(--line, #d8dde6);border-radius:10px;padding:8px;margin-top:8px">
    <div class="small" style="font-weight:700">Surgical incision</div>
    <div class="small muted">Where</div>
    <div class="row">${INCISION_SIDES.map((v) => pk('incision.side', v, cap(v), c.side === v)).join('')}</div>
    <div class="row">${INCISION_SITES.map((v) => pk('incision.site', v, cap(v), c.site === v && !c.siteOther)).join('')}
      <input id="incother" value="${esc(c.siteOther ?? '')}" placeholder="or type the site" autocomplete="off" style="flex:1;min-width:9rem"></div>
    <div class="small muted">Finding (goes in the exam, under Skin)</div>
    <div class="row">${INCISION_STATES.map(([k, label]) => pk('incision.state', k, label, c.state === k)).join('')}</div>
    <div class="small muted">Add to the note text</div>
    <div class="row">${INCISION_ACTS.map((v) => pk('incision.act', v, v, c.act === v)).join('')}</div>
    ${clash ? '<div class="small" id="incclash"><b>Check:</b> "Visualized incision" is picked with "Covered with dressing".</div>' : ''}
    <div class="small" id="inchint">${esc([incisionExam(p), incisionSubjective(p)].filter(Boolean).join(' '))}</div>
  </div>`;
}
// ===== APP-11-25C  END =====
// ===== APP-11-20  END =====

// ===== APP-11-24  START: time clock =====
// His request: "a time clock when starting at a facility on a certain day that I can use or edit. Editing is important."
// One list of in/out times for each building and date. Clock in and Clock out stamp the time now; every time is an
// ordinary time box that can be changed, a stretch can be added by hand or removed, and a day can hold several
// stretches (leave and come back). Nothing here goes into the daily summary or a note.
let timeclock = {}; // "<date>|<building id>" -> [{ in, out }]
const clockKey = (d = day) => `${d.date}|${d.building || ''}`;
const nowHM = () => { const n = new Date(); return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`; };

async function clockChange(fn) {
  const segs = (timeclock[clockKey()] ||= []);
  fn(segs);
  if (!segs.length) delete timeclock[clockKey()];
  await saveClock(timeclock);
  const box = app.querySelector('#clock');
  if (box) { box.innerHTML = clockHtml(); wireClock(); }
}

function clockHtml() {
  if (!day.building && settings.buildings.length) return '';
  const segs = timeclock[clockKey()] || [];
  const open = segs.find((s) => s.in && !s.out);
  const total = clockTotal(segs);
  const bn = bname(day.building);
  const rows = segs.map((s, i) => {
    const mins = clockMinutes(s.in, s.out);
    const bad = s.in && s.out && mins == null;
    return `<div style="display:grid;gap:4px;border-top:1px solid var(--line, #d8dde6);padding-top:8px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label style="min-width:0">In<input type="time" data-clock="in" data-i="${i}" value="${esc(s.in)}" style="width:100%;min-width:0;box-sizing:border-box"></label>
        <label style="min-width:0">Out<input type="time" data-clock="out" data-i="${i}" value="${esc(s.out)}" style="width:100%;min-width:0;box-sizing:border-box"></label>
      </div>
      <div class="row">
        <div class="grow small ${bad ? '' : 'muted'}"${bad ? ' style="color:var(--bad)"' : ''}>${bad ? 'out is before in' : mins != null ? esc(clockSpan(mins)) : s.in ? 'still in' : ''}</div>
        <button class="ghost small" data-act="clock-del" data-i="${i}" aria-label="Remove this time" style="min-height:40px">Remove</button>
      </div>
    </div>`;
  }).join('');
  const shut = !!settings.folded?.clock; // APP-11-25B: the card folds up to its heading
  const head = `<div class="row"><button class="ghost grow" data-act="fold" data-k="clock" aria-expanded="${!shut}" style="text-align:left;min-height:40px;padding-left:0"><b>${shut ? '▸' : '▾'} Time${bn ? ` at ${esc(bn)}` : ''}</b></button>
      <span class="small muted">${segs.length ? `Total ${esc(clockSpan(total))}${open ? ' + current' : ''}` : 'Not clocked in'}</span></div>
    ${open ? `<div class="small">Clocked in at <b>${esc(clock12(open.in))}</b>.</div>` : ''}`;
  if (shut) return `<div class="card" style="display:grid;gap:8px;margin-bottom:14px">${head}</div>`;
  return `<div class="card" style="display:grid;gap:8px;margin-bottom:14px">
    ${head}
    ${rows}
    <div class="row" style="flex-wrap:wrap">
      ${open ? '<button class="primary grow" data-act="clock-out">Clock out now</button>'
    : `<button class="primary grow" data-act="clock-in">${segs.length ? 'Clock in again' : 'Clock in now'}</button>`}
      <button class="grow" data-act="clock-add">Add a time by hand</button>
    </div>
    ${segs.length ? '<div class="small muted">Tap any time to change it. These times stay on the phone; they are not sent with the notes.</div>' : ''}
  </div>`;
}

// A time box that was changed: save it as typed (an emptied box clears that time).
function wireClock() {
  app.querySelectorAll('#clock input[data-clock]').forEach((el) => el.addEventListener('change', async (e) => {
    const { clock: field, i } = e.target.dataset;
    await clockChange((segs) => { if (segs[+i]) segs[+i][field] = e.target.value || ''; });
  }));
}

function timeLogRows() {
  return Object.entries(timeclock)
    .map(([key, segs]) => { const [date, building] = key.split('|'); return { date, building, segs }; })
    .filter((r) => r.segs.length)
    .sort((a, b) => (a.date === b.date ? bname(a.building).localeCompare(bname(b.building)) : a.date < b.date ? 1 : -1));
}

const segText = (s) => `${clock12(s.in) || '?'} - ${s.out ? clock12(s.out) : 'still in'}`;

function timeLogText() {
  return ['Date\tBuilding\tIn - Out\tTotal', ...timeLogRows().map((r) => `${formatDate(r.date)}\t${bname(r.building) || '(no building)'}\t${r.segs.map(segText).join('; ')}\t${clockSpan(clockTotal(r.segs))}`)].join('\n');
}

function renderTimeLog() {
  const rows = timeLogRows();
  app.innerHTML = `
    <div class="top">
      <button class="ghost" data-act="back">‹ Back</button>
      <div class="grow"><h1>Time log</h1></div>
      ${rows.length ? '<button class="primary" data-act="timelog-copy">Copy</button>' : ''}
    </div>
    ${rows.length ? `<div class="stack">${rows.map((r) => `
      <button class="card" data-act="timelog-open" data-date="${esc(r.date)}" data-b="${esc(r.building)}" style="text-align:left;display:grid;gap:2px">
        <div class="row"><b class="grow">${esc(formatDate(r.date))} · ${esc(bname(r.building) || '(no building)')}</b><span>${esc(clockSpan(clockTotal(r.segs)))}</span></div>
        <div class="small muted">${esc(r.segs.map(segText).join('; '))}</div>
      </button>`).join('')}</div>
      <p class="small muted">Tap a day to open it and change its times. Copy puts the whole log on the clipboard to paste into a spreadsheet.</p>`
    : '<div class="empty card"><p><b>No times yet.</b></p><p>On the list screen, tap <b>Clock in now</b> when you start at a building.</p></div>'}`;
}
// ===== APP-11-24  END =====

// ===== APP-11-22-CHART  START: Dx and Meds buttons =====
// Note Updater (version 85) writes each building's chart on the computer: every current patient's diagnoses (from
// the newest note) and medications (from the newest Medications file, else the note). The receiver hands it over
// with the token. It is kept on this phone so the buttons work with no signal, and each list shows its date.
let charts = {}; // building id -> { chart, modified, at }
const chartNote = {}; // building id -> why the last pull brought nothing, in words
let chartBusy = false;
let chartRedraw = () => {};
const chartTime = (ms) => new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ===== APP-11-25F  START: a chart request that does not give up on the first miss =====
// A phone on Tailscale often misses the first request after it wakes or changes network. Each try is given 8 seconds;
// a try that gets no answer is repeated after 1 and then 3 seconds (3 tries). Only this read-only request is repeated.
const CHART_TRIES = [0, 1000, 3000];
const CHART_WAIT_MS = 8000;
async function fetchPatient(url, opts) {
  let last;
  for (const pause of CHART_TRIES) {
    if (pause) await new Promise((r) => setTimeout(r, pause));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CHART_WAIT_MS);
    try {
      return await fetch(url, { ...opts, signal: ctl.signal });
    } catch (err) {
      last = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new TypeError(last?.name === 'AbortError' ? 'timeout' : String(last?.message || last));
}
// ===== APP-11-25F  END =====

async function pullChart(id = day?.building, { loud = false } = {}) {
  if (!id || chartBusy) return false;
  if (!settings.receiverUrl && !/ts\.net$|^127\.|^localhost$/.test(location.hostname)) {
    chartNote[id] = 'No computer address is set in Settings.';
    if (loud) toast(chartNote[id], 4000);
    return false;
  }
  chartBusy = true;
  let ok = false;
  try {
    const res = await fetchPatient(`${receiverBase()}api/chart?building=${encodeURIComponent(bname(id))}`, { headers: { 'X-Token': settings.receiverToken || '' }, cache: 'no-store' }); // APP-11-25F
    if (res.status === 401) throw new Error('The receiver rejected the token. Check Settings.');
    if (res.status === 404) throw new Error('The receiver on the computer is an older one with no chart. Update the receiver.');
    if (!res.ok) throw new Error(`Receiver error ${res.status}`);
    const info = await res.json();
    if (info.found && Array.isArray(info.chart?.patients)) {
      charts[id] = { chart: info.chart, modified: info.modified || '', at: Date.now() };
      delete chartNote[id];
      await saveCharts(charts);
      ok = true;
    } else chartNote[id] = info.why || 'The computer has no chart for this building.';
  } catch (err) {
    chartNote[id] = err instanceof TypeError ? `The computer could not be reached after ${CHART_TRIES.length} tries${err.message === 'timeout' ? ' (no answer)' : ''}. Check that Tailscale is on in this phone, and that the computer is awake with the receiver running.` : err.message; // APP-11-25F
  } finally {
    chartBusy = false;
  }
  if (loud) toast(ok ? `Chart updated: ${charts[id].chart.patients.length} patients` : chartNote[id], 4000);
  if (id === day?.building) chartRedraw();
  chartsRedraw(); // APP-11-25H
  return ok;
}

// ===== APP-11-25H  START: every building's chart at once, and what the phone holds =====
// His request (11/25/2026): "I think it should pull all and send to each person's chart." One request already brings a
// whole building; this asks for every building in turn - when the app opens and from "Get all charts" - so the Dx and
// Meds buttons work all day from the phone's own copy. The list screen shows what the phone holds for each building.
let chartsAll = null; // while a pull of every building runs: { done, total }
async function pullAllCharts({ loud = false } = {}) {
  if (chartsAll || chartBusy || !settings.buildings.length) return;
  chartsAll = { done: 0, total: settings.buildings.length };
  chartsRedraw();
  let got = 0;
  let stopped = '';
  try {
    for (const id of settings.buildings) {
      const ok = await pullChart(id);
      chartsAll.done += 1;
      if (ok) got += 1;
      else if (/could not be reached|No computer address/.test(chartNote[id] || '')) { stopped = chartNote[id]; break; } // no point asking for the rest
      await pullRoster(id, day.date); // APP-11-26F: and that building's roster for the day on screen
      chartsRedraw();
    }
  } finally {
    chartsAll = null;
    chartsRedraw();
  }
  if (loud) toast(stopped || `Charts on this phone: ${got} of ${settings.buildings.length} buildings updated`, 5000);
}

function chartsRedraw() {
  const box = document.getElementById('chartsbox');
  if (box) box.innerHTML = chartsHtml();
}

function chartsHtml() {
  if (!settings.buildings.length) return '';
  const shut = !!settings.folded?.charts;
  const have = settings.buildings.filter((b) => charts[b]?.chart?.patients).length;
  const dayMs = 86400000;
  const rows = settings.buildings.map((b) => {
    const c = charts[b];
    const note = chartNote[b];
    if (!c?.chart?.patients) return `<div class="small"><b>${esc(bname(b))}</b>: no chart on this phone${note ? ` - ${esc(note)}` : ''}</div>`;
    const age = Math.floor((Date.now() - (c.at || 0)) / dayMs);
    const ro = rosters[rosterKey(b)];
    return `<div class="small"><b>${esc(bname(b))}</b>: ${ro ? `roster for ${esc(formatDate(day.date))}: ${ro.n} patients · ` : ''}${c.chart.patients.length} patients in the chart · chart made ${esc(c.chart.made || c.modified)} · pulled ${esc(chartTime(c.at))}${age >= 1 ? ` <b>(${age} day${age === 1 ? '' : 's'} ago)</b>` : ''}${note ? `<div class="muted">last try: ${esc(note)}</div>` : ''}</div>`;
  }).join('');
  const head = `<div class="row"><button class="ghost grow" data-act="fold" data-k="charts" aria-expanded="${!shut}" style="text-align:left;min-height:40px;padding-left:0"><b>${shut ? '▸' : '▾'} Dx and Meds on this phone</b></button>
      <span class="small muted">${chartsAll ? `Asking the computer… ${chartsAll.done}/${chartsAll.total}` : `${have} of ${settings.buildings.length} buildings`}</span></div>`;
  if (shut) return `<div class="card" style="display:grid;gap:8px;margin-bottom:14px">${head}</div>`;
  return `<div class="card" style="display:grid;gap:8px;margin-bottom:14px">${head}
    ${rows}
    <div class="row"><button class="grow" data-act="charts-all" ${chartsAll ? 'disabled' : ''}>${chartsAll ? 'Asking the computer…' : 'Get all charts'}</button></div>
    <div class="small muted">Each chart holds every current patient of that building. It is as new as the last Note Updater run for the building.</div>
  </div>`;
}
// ===== APP-11-25H  END =====

// ===== APP-11-26F  START: the day's roster from the computer's roster folder =====
// He saves the list from PCC into F:\_Daily Rosters\<Building> with the date in the file's name. The receiver hands
// the file over; this phone reads it with the same reader as "Choose file" (a PDF's own text - nothing is photographed)
// and keeps the text, so it can be loaded later with no connection. The file on the computer is never changed.
let rosters = {}; // "<date>|<building id>" -> { file, modified, at, text, n }
const rosterNote = {}; // same key -> why the last look found nothing, in words
const rosterKey = (id = day?.building, date = day?.date) => `${date}|${id}`;

async function pullRoster(id = day?.building, date = day?.date, { loud = false } = {}) {
  if (!id || !date) return false;
  const key = rosterKey(id, date);
  let ok = false;
  try {
    if (!settings.receiverUrl && !/ts\.net$|^127\.|^localhost$/.test(location.hostname)) throw new Error('No computer address set (Settings).');
    const res = await fetchPatient(`${receiverBase()}api/roster?building=${encodeURIComponent(bname(id))}&date=${encodeURIComponent(date)}`, { headers: { 'X-Token': settings.receiverToken || '' }, cache: 'no-store' });
    if (res.status === 404) throw new Error('The receiver on the computer is an older one - it needs the 11/26/2026 version for rosters.');
    if (!res.ok) throw new Error(res.status === 401 ? 'The receiver rejected the token. Check Settings.' : `Receiver error ${res.status}`);
    const info = await res.json();
    if (!info.found) rosterNote[key] = info.why || 'no roster in the folder';
    else {
      const bytes = Uint8Array.from(atob(info.data), (ch) => ch.charCodeAt(0));
      const text = await fileToText(new File([bytes], info.file, { type: /\.pdf$/i.test(info.file) ? 'application/pdf' : '' }));
      rosters[key] = { file: info.file, modified: info.modified, at: Date.now(), text, n: parseRoster(text).length, others: info.others || [] };
      delete rosterNote[key];
      await saveRosters(rosters);
      ok = true;
    }
  } catch (err) {
    rosterNote[key] = err instanceof TypeError ? 'The computer could not be reached.' : err.message;
  }
  if (loud) toast(ok ? `Roster ${rosters[key].file}: ${rosters[key].n} patients` : rosterNote[key], 4000);
  const box = document.getElementById('rosterbox');
  if (box && key === rosterKey()) box.innerHTML = rosterBoxHtml();
  chartsRedraw();
  return ok;
}

function rosterBoxHtml() {
  const key = rosterKey();
  const r = rosters[key];
  const note = rosterNote[key];
  const who = `${bname(day.building) || 'this building'}, ${formatDate(day.date)}`;
  if (!r) {
    return `<div class="card" style="display:grid;gap:8px;margin-bottom:6px"><div><b>Roster folder on the computer</b></div>
      <div class="small">${note ? `No roster for ${esc(who)}: ${esc(note)}` : `Looking for the roster for ${esc(who)}…`}</div>
      <div class="row"><button class="grow" data-act="roster-check">Check the folder again</button></div></div>`;
  }
  return `<div class="card" style="display:grid;gap:8px;margin-bottom:6px"><div><b>Roster folder on the computer</b></div>
    <div class="small"><b>${esc(r.file)}</b> · ${r.n} patient${r.n === 1 ? '' : 's'} · saved ${esc(r.modified)} · pulled ${esc(chartTime(r.at))}${r.others?.length ? ` · also in the folder for this date: ${esc(r.others.join(', '))}` : ''}</div>
    ${note ? `<div class="small muted">Using the copy on this phone. Last look: ${esc(note)}</div>` : ''}
    <div class="row"><button class="primary grow" data-act="roster-load" ${r.n ? '' : 'disabled'}>Load this roster</button><button data-act="roster-check">Check again</button></div>
    ${r.n ? '' : '<div class="small" style="color:var(--amber)">No patients could be read from this file. Each patient needs a "LAST, FIRST (MRN)" entry.</div>'}</div>`;
}
// ===== APP-11-26F  END =====

// APP-11-25G (11/25/2026): each row of the Dx / Meds list keeps the height of its own text. The list was a grid with a
// height limit, which squeezed every row to the button's minimum height, so a long diagnosis or a medication's directions
// ran over the row below it and looked as if it belonged to the next medication.
function chartPanel(p, kind) {
  const c = charts[day.building];
  const e = chartEntry(c?.chart, p);
  const what = kind === 'dx' ? 'diagnoses' : 'medications';
  const tapped = (kind === 'dx' ? p.tapDx : p.tapMeds) || [];
  const items = !e ? [] : kind === 'dx'
    ? (e.dx || []).map((x) => ({ v: String(x), more: '' }))
    : (e.meds || []).map((m) => ({ v: String(m.name), more: String(m.text || '').startsWith(m.name) ? String(m.text).slice(String(m.name).length).replace(/^\s*[–—-]\s*/, '') : '' }));
  const extra = tapped.filter((t) => !items.some((i) => i.v === t));
  const btn = (i) => `<button class="dpreset ${tapped.includes(i.v) ? 'on' : ''}" data-tap="${kind}" data-v="${esc(i.v)}" style="width:100%;flex:0 0 auto;height:auto;white-space:normal;overflow-wrap:anywhere">
      <b>${esc(i.v)}</b>${i.more ? `<div class="small" style="font-weight:400;opacity:.85">${esc(i.more)}</div>` : ''}</button>`;
  const note = chartNote[day.building];
  let head;
  if (!c) head = `<div class="small">No chart from the computer on this phone yet.${note ? ` ${esc(note)}` : ''}</div>`;
  else if (!e) head = `<div class="small">${esc(p.last)}, ${esc(p.first)} (${esc(p.mrn)}) is not in the chart made ${esc(c.chart.made || c.modified)}. A patient is added after Note Updater has made a note for them.</div>`;
  else {
    head = `<div class="small"><b>${what[0].toUpperCase()}${what.slice(1)} from the ${esc(kind === 'dx' ? e.dx_from : e.meds_from)}</b></div>
      ${items.length ? `<div class="small muted">Tap one to add it to today's note, under the therapy section. Tap it again to take it off.</div>`
    : `<div class="small">No ${what} were found there.</div>`}`;
  }
  return `${c && note ? `<div class="small" id="chartsaved" style="border:1px solid var(--line, #d8dde6);border-radius:8px;padding:6px 8px"><b>Using the chart saved on this phone</b> (pulled ${esc(chartTime(c.at))}). ${esc(note)}</div>` : ''}${head}
    ${items.length ? `<div id="chartlist" style="display:flex;flex-direction:column;gap:6px;max-height:48vh;overflow:auto">${items.map(btn).join('')}</div>` : ''}
    ${extra.length ? `<div class="small muted">Tapped earlier, not in this chart:</div><div style="display:flex;flex-direction:column;gap:6px">${extra.map((v) => btn({ v, more: '' })).join('')}</div>` : ''}
    <div class="row"><span class="small muted grow">${c ? `Chart made ${esc(c.chart.made || c.modified)} · pulled ${esc(chartTime(c.at))}` : ''}</span>
      <button class="ghost" data-chart="refresh">Refresh</button></div>`;
}
// ===== APP-11-22-CHART  END =====

// ---------- antibiotics (the ABX detail) ----------

let abxMode = null; // null = list; or { kind: 'add' | 'edit' | 'stop', ... } while a form is open
const shortDate = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${m}/${d}`; };
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const STOP_REASONS = [
  ['discontinued', 'Discontinued', 'stopped early'],
  ['completed', 'Completed', 'course finished'],
  ['changed', 'Changed to oral', 'then add the oral one'],
];

function abxMatches(q) {
  const t = q.trim().toLowerCase();
  const list = settings.abxList || [];
  const hits = t ? list.filter((x) => x.toLowerCase().includes(t)) : list;
  return hits.slice(0, t ? 8 : 40).map((x) => `<button class="opt ${abxMode?.drug === x ? 'on' : ''}" data-abx="pick" data-v="${esc(x)}">${esc(x)}</button>`).join('')
    || '<p class="small muted" style="margin:0">Not on the list. What you typed will be used as the name.</p>';
}

function abxPanel(p) {
  const date = day.date;
  const m = abxMode;
  if (m && (m.kind === 'add' || m.kind === 'edit')) {
    const end = m.days ? addDays(m.start, m.days - 1) : '';
    return `<div class="abx-form">
      <label>Antibiotic<input id="abx-q" value="${esc(m.drug)}" placeholder="Type a few letters, e.g. ceph" autocomplete="off"></label>
      <div id="abx-matches" class="abx-matches">${abxMatches(m.drug)}</div>
      <div class="small muted">Route</div>
      <div class="dkeys" style="grid-template-columns:1fr 1fr">${['oral', 'IV'].map((r) => `<button data-abx="route" data-v="${r}" class="${m.route === r ? 'on' : ''}">${r === 'oral' ? 'Oral' : 'IV'}</button>`).join('')}</div>
      <div class="row">
        <label class="grow">Start (day 1)<input id="abx-start" type="date" value="${esc(m.start)}"></label>
        <label class="grow">Total days<input id="abx-days" type="number" min="1" max="365" inputmode="numeric" value="${esc(m.days || '')}"></label>
      </div>
      <div class="dkeys">${[5, 7, 10, 14, 21].map((n) => `<button data-abx="days" data-v="${n}" class="${+m.days === n ? 'on' : ''}">${n}</button>`).join('')}</div>
      <label>Or last day<input id="abx-end" type="date" value="${esc(end)}"></label>
      <div id="abx-msg" class="small" style="color:var(--bad)"></div>
      <div class="row">
        ${m.kind === 'edit' ? '<button class="ghost danger" data-abx="delete">Delete</button>' : ''}
        <span class="grow"></span>
        <button class="ghost" data-abx="cancel">Cancel</button>
        <button class="primary" data-abx="save">${m.kind === 'add' ? 'Start monitoring' : 'Save'}</button>
      </div></div>`;
  }
  if (m?.kind === 'stop') {
    const c = (abx[p.mrn] || []).find((x) => x.id === m.id);
    const sent = abxSentences([{ ...c, added: '', stopped: { date: m.date, reason: m.reason } }], m.date)[0] || '';
    return `<div class="abx-form">
      <b>Stop ${esc(c.route)} ${esc(abxName(c.drug))}</b>
      ${STOP_REASONS.map(([k, label, hint]) => `<button class="opt ${m.reason === k ? 'on' : ''}" data-abx="reason" data-v="${k}"><b>${label}</b> <span class="small muted">${hint}</span></button>`).join('')}
      <label>Stopped on<input id="abx-stopdate" type="date" value="${esc(m.date)}"></label>
      <div class="small muted">That day's note says: ${esc(sent)}</div>
      <div class="row"><span class="grow"></span><button class="ghost" data-abx="cancel">Cancel</button>
        <button class="primary" data-abx="stop-yes">Stop monitoring</button></div></div>`;
  }
  const all = abx[p.mrn] || [];
  const shown = all.filter((c) => abxState(c, date) !== 'ended');
  const ended = all.filter((c) => abxState(c, date) === 'ended');
  const line = (c) => {
    const st = abxState(c, date);
    const n = abxDayNumber(c, date);
    const end = abxEndDate(c);
    const status = st === 'before' ? `starts ${shortDate(c.start)}`
      : st === 'stopping' ? `<b style="color:var(--bad)">${c.stopped.reason === 'completed' ? 'completed' : c.stopped.reason === 'changed' ? 'changed to oral' : 'discontinued'} today</b>`
        : `<b style="color:var(--ink)">Day ${n}${c.days ? ` of ${c.days}` : ''}</b>${end ? ` · ends ${shortDate(end)}` : ''}`;
    return `<div class="abx-row">
      <div class="grow"><b>${esc(abxName(c.drug))}</b> · ${esc(c.route)}<div class="small muted">Started ${shortDate(c.start)} · ${status}</div></div>
      <button class="small" data-abx="edit" data-id="${esc(c.id)}">Edit</button>
      ${st === 'stopping' ? `<button class="small" data-abx="unstop" data-id="${esc(c.id)}">Undo stop</button>`
        : `<button class="small danger" data-abx="stop" data-id="${esc(c.id)}">Stop</button>`}
    </div>`;
  };
  return `${shown.length ? shown.map(line).join('') : '<p class="small muted" style="margin:0">No antibiotics being monitored for this patient.</p>'}
    <button class="primary" data-abx="add">+ Add abx</button>
    ${ended.length ? `<details class="small muted"><summary>${ended.length} finished or stopped</summary>${ended.map((c) => `<div>${esc(abxName(c.drug))} · ${esc(c.route)} · ${shortDate(c.start)} to ${shortDate(c.stopped?.date || abxEndDate(c))}${c.stopped ? ` (${c.stopped.reason})` : ''}
      <button class="ghost small" data-abx="edit" data-id="${esc(c.id)}">Edit</button></div>`).join('')}</details>` : ''}`;
}

// Keep what is typed in the ABX form in abxMode, so redraws don't lose it.
function wireAbxForm(box) {
  const m = abxMode;
  if (!m) return;
  const q = box.querySelector('#abx-q');
  q?.addEventListener('input', () => {
    m.drug = q.value;
    box.querySelector('#abx-matches').innerHTML = abxMatches(q.value);
  });
  const start = box.querySelector('#abx-start');
  const days = box.querySelector('#abx-days');
  const end = box.querySelector('#abx-end');
  const syncEnd = () => { end.value = m.days && m.start ? addDays(m.start, m.days - 1) : ''; };
  start?.addEventListener('change', () => { m.start = start.value || day.date; syncEnd(); });
  days?.addEventListener('input', () => {
    m.days = Math.max(0, Math.round(+days.value || 0));
    syncEnd();
    box.querySelectorAll('[data-abx="days"]').forEach((b) => b.classList.toggle('on', +b.dataset.v === m.days));
  });
  end?.addEventListener('change', () => {
    if (!end.value || !m.start) return;
    const n = Math.round((Date.parse(end.value) - Date.parse(m.start)) / 86400000) + 1;
    if (n >= 1) { m.days = n; days.value = n; }
  });
  const stopDate = box.querySelector('#abx-stopdate');
  stopDate?.addEventListener('change', () => { m.date = stopDate.value || day.date; });
}

async function abxAction(p, b) {
  const list = abx[p.mrn] || [];
  const find = () => list.find((x) => x.id === b.dataset.id);
  const v = b.dataset.v;
  const persist = async () => {
    abx[p.mrn] = list;
    if (!list.length) delete abx[p.mrn];
    await saveAbx(abx);
    const next = abxSentences(abx[p.mrn], day.date);
    if (next.length) p.abx = next; else delete p.abx;
  };
  switch (b.dataset.abx) {
    case 'add': abxMode = { kind: 'add', drug: '', route: 'oral', start: day.date, days: 0 }; break;
    case 'edit': {
      const c = find();
      abxMode = { kind: 'edit', id: c.id, drug: c.drug, route: c.route, start: c.start, days: c.days || 0 };
      break;
    }
    case 'pick': abxMode.drug = v; break;
    case 'route': abxMode.route = v; break;
    case 'days': abxMode.days = +v; break;
    case 'cancel': abxMode = null; break;
    case 'save': {
      const m = abxMode;
      const drug = m.drug.trim();
      if (!drug) { app.querySelector('#abx-msg').textContent = 'Pick or type the antibiotic.'; return; }
      if (m.kind === 'add') {
        list.push({ id: Date.now().toString(36), drug, route: m.route, start: m.start || day.date, days: m.days || 0, added: day.date });
      } else {
        Object.assign(list.find((x) => x.id === m.id), { drug, route: m.route, start: m.start || day.date, days: m.days || 0 });
      }
      await persist();
      toast(m.kind === 'add' ? `Monitoring ${m.route} ${abxName(drug)}` : 'Antibiotic updated');
      abxMode = null;
      break;
    }
    case 'delete':
      list.splice(list.findIndex((x) => x.id === abxMode.id), 1);
      await persist();
      toast('Antibiotic deleted');
      abxMode = null;
      break;
    case 'stop': abxMode = { kind: 'stop', id: b.dataset.id, reason: 'discontinued', date: day.date }; break;
    case 'reason': abxMode.reason = v; break;
    case 'stop-yes': {
      const m = abxMode;
      const c = list.find((x) => x.id === m.id);
      c.stopped = { date: m.date, reason: m.reason };
      await persist();
      abxMode = m.reason === 'changed' ? { kind: 'add', drug: c.drug, route: 'oral', start: m.date, days: 0 } : null;
      toast(m.reason === 'changed' ? 'Stopped. Now add the oral antibiotic.' : `Stopped ${abxName(c.drug)}`);
      break;
    }
    case 'unstop': delete find().stopped; await persist(); break;
    default: break;
  }
}

// Change the pain score, and the pain sentence in the note if there is one.
function setPain(p, v) {
  p.pain = v;
  syncPainSentence(p);
}

// Rewrite "Pain N/10 ..." in the open note from the current score, area and type.
function syncPainSentence(p) {
  const ta = document.getElementById('note');
  if (!ta) return;
  const next = p.pain == null
    ? ta.value.replace(/Pain \d+\/10[^.]*\.\s*/, '')
    : ta.value.replace(/Pain \d+\/10[^.]*/, painPhrase(p));
  if (next !== ta.value) { ta.value = next; p.text = next; }
}

// Optional area (side + site) and type buttons, shared by the pain screen and the Pain detail.
// APP-11-22: the back entry among the pain sites ("back", "lower back", "mid back", "upper back"), or null
function backSite(p) {
  return (p.painSite || []).find((x) => /(?:^| )back$/.test(x)) ?? null;
}

function painExtras(p) {
  const grid = (extra = '') => `style="grid-template-columns:repeat(auto-fill,minmax(96px,1fr));${extra}"`;
  const chips = (act, list, on) => list.map((x) => `<button data-act="${act}" data-v="${esc(x)}" class="${on(x) ? 'on' : ''}">${esc(x)}</button>`).join('');
  return `<div class="pain-extras">
    <div class="small muted" style="margin:14px 0 6px">Area (optional)</div>
    <div class="dkeys" ${grid()}>${chips('pain-side', PAIN_SIDES, (x) => p.painSide === x)}</div>
    <div class="dkeys" ${grid('margin-top:6px')}>${chips('pain-site', PAIN_SITES, (x) => (x === 'back' ? backSite(p) != null : (p.painSite || []).includes(x)))}</div>
    ${backSite(p) != null ? `<div class="small muted" style="margin:8px 0 6px">Which part of the back?</div>
    <div class="dkeys" ${grid()}>${chips('pain-back', BACK_PARTS, (x) => backSite(p) === `${x} back`)}</div>` : ''}
    <div class="small muted" style="margin:12px 0 6px">Type (optional)</div>
    <div class="dkeys" ${grid()}>${chips('pain-type', PAIN_TYPES, (x) => (p.painType || []).includes(x))}</div>
  </div>`;
}

function insertAtCursor(text) {
  const ta = document.getElementById('note');
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  const before = ta.value.slice(0, start);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  ta.setRangeText(`${lead}${text} `, start, end, 'end');
  ta.focus();
  // APP-11-11: a sentence with ___ in it: the first ___ is selected, so typing replaces it.
  const b = nextBlank(text);
  if (b) ta.setSelectionRange(start + lead.length + b[0], start + lead.length + b[1]);
  showBlankChip();
  scheduleSave();
}

// APP-11-11: the "Next ___" button on the phrase bar, shown while the note has a ___ left to fill.
function showBlankChip() {
  const chip = document.getElementById('blank-chip');
  const ta = document.getElementById('note');
  if (!chip || !ta) return;
  const n = blankCount(ta.value);
  chip.hidden = !n;
  chip.textContent = `Next ___ (${n})`;
}
function gotoBlank() {
  const ta = document.getElementById('note');
  if (!ta) return;
  const b = nextBlank(ta.value, ta.selectionEnd ?? 0);
  if (!b) return;
  ta.focus();
  ta.setSelectionRange(b[0], b[1]);
}

// The phrase bar sits on top of the on-screen keyboard.
function mountPhraseBar() {
  const groups = [...new Set(settings.phrases.map((p) => p.group || 'Other'))];
  const pinned = settings.pinned.filter((g) => groups.includes(g));
  const rest = groups.filter((g) => !pinned.includes(g));
  const bar = document.createElement('div');
  bar.className = 'phrase-bar';
  bar.innerHTML = `<div class="sheet" id="sheet" hidden></div>
    <div class="chips">
      <button class="chip" id="blank-chip" data-blank hidden></button>
      ${pinned.map((g) => `<button class="chip group" data-group="${esc(g)}">${esc(g)} ▾</button>`).join('')}
      ${rest.map((g) => `<button class="chip group" data-group="${esc(g)}">${esc(g)} ▾</button>`).join('')}
      <button class="chip group" data-group="*">All ▾</button>
    </div>`;
  document.body.appendChild(bar);

  // Keep the keyboard open: don't let taps on the bar take focus from the note.
  bar.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  bar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const sheet = bar.querySelector('#sheet');
    if ('blank' in b.dataset) { gotoBlank(); return; } // APP-11-11
    if (b.dataset.group) {
      const g = b.dataset.group;
      if (!sheet.hidden && sheet.dataset.group === g) { sheet.hidden = true; return; }
      const list = settings.phrases.filter((p) => g === '*' || (p.group || 'Other') === g);
      sheet.dataset.group = g;
      sheet.innerHTML = list.map((p) => `<button data-key="${esc(p.key)}"><span class="k">${esc(p.key)}</span>${esc(p.text)}</button>`).join('')
        || '<p class="small muted">No phrases in this group yet. Add them in Settings.</p>';
      sheet.hidden = false;
    } else if (b.dataset.key) {
      const p = settings.phrases.find((x) => x.key === b.dataset.key);
      if (p) insertAtCursor(p.text);
      sheet.hidden = true;
    }
  });

  const vv = window.visualViewport;
  if (vv) {
    const place = () => {
      if (!bar.isConnected) { vv.removeEventListener('resize', place); vv.removeEventListener('scroll', place); return; }
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      bar.style.transform = offset > 0 ? `translateY(${-offset}px)` : '';
    };
    vv.addEventListener('resize', place);
    vv.addEventListener('scroll', place);
    place();
  }
}

// ---------- send ----------

// The day's Word file, plus its plain text (shown in the app and kept as the archive copy).
function dayFile() {
  const d = named();
  const filename = summaryFilename(d);
  return { filename, content: buildSummary(d), bytes: makeDocx(summaryLines(d), { title: filename.replace(/\.docx$/, '') }) };
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// APP-11-11: `quiet` = a retry made without a tap (no screen change when it fails again);
// `allowBlanks` = send even though a note still has a ___ in it.
// APP-11-26B: one amber box listing the pairs; nothing is changed for you.
function clashHtml(list, who = '') {
  if (!list.length) return '';
  return `<div class="small clash" style="border:1px solid var(--amber);border-radius:8px;padding:6px 8px;margin:6px 0">
    <b>Check${who ? ` ${esc(who)}` : ''}:</b>
    ${list.map((c) => (c.b ? `<div>${esc(c.what)} - these do not fit together: "${esc(c.a)}" and "${esc(c.b)}"</div>` : `<div>${esc(c.what)}: "${esc(c.a)}"</div>`)).join('')}</div>`;
}

// `allowClashes` = send even though a note says two things that do not fit together (APP-11-26B).
async function sendDay({ overwrite = false, quiet = false, allowBlanks = false, allowClashes = false } = {}) {
  if (view.name === 'patient') await flushNote();
  const blanks = day.patients.map((p, i) => (blankCount(p.text) ? `${i + 1}. ${p.last}, ${p.first}` : '')).filter(Boolean);
  if (blanks.length && !allowBlanks && !overwrite) {
    go({ name: 'log', blanks });
    return;
  }
  if (!allowClashes && !overwrite && !quiet) { // APP-11-26B: shown once before the day goes; "Send anyway" sends it as it is
    const clashes = day.patients.map((p, i) => {
      const st = pendingStanding(p); // APP-11-26D: carried settings nobody has confirmed today are listed too
      const carried = st ? [{ what: `carried from ${formatDate(p.carriedSet.from)}, not confirmed today`, a: standingText(st), b: '' }] : [];
      return { who: `${i + 1}. ${p.last}, ${p.first}`, list: [...noteClashes(p), ...carried] };
    }).filter((x) => x.list.length);
    if (clashes.length) {
      go({ name: 'log', clashes });
      return;
    }
  }
  const send = nextSend(day);
  const { filename, content, bytes } = dayFile();
  const logLine = logLines(day, [send])[0];
  try {
    // Opened from GitHub Pages with no computer address: the request would go to GitHub (405).
    if (!settings.receiverUrl && !/ts\.net$|^127\.|^localhost$/.test(location.hostname)) {
      throw new Error('No computer address set. Open Settings and enter your computer\'s Tailscale address and token.');
    }
    const res = await fetch(`${receiverBase()}api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': settings.receiverToken || '' },
      body: JSON.stringify({ date: day.date, building: bname(day.building), formerNames: formerNames(day.building), sendNo: send.n, filename, content, docx: toBase64(bytes), logLine, overwrite }),
    });
    if (res.status === 409) {
      // A file with this name is in the Daily folder and wasn't made by this app: ask before replacing it.
      if (!quiet) go({ name: 'log', conflict: { filename } });
      return;
    }
    if (!res.ok) {
      // APP-11-11: the computer says in words what went wrong (file open in Word, notes drive not plugged in).
      const why = await res.json().catch(() => ({}));
      throw Object.assign(new Error(res.status === 401 ? 'The receiver rejected the token. Check Settings.' : why.message || `Receiver error ${res.status}`), { answered: true });
    }
    const info = await res.json().catch(() => ({}));
    if (info.renamed?.length) toast(`Renamed ${info.renamed.join(', ')} to ${bname(day.building)} on the computer`, 4000);
    // APP-11-11: keep the computer's receipt with the send, and show it on the list.
    if (info.receiptText) {
      send.receipt = String(info.receiptText);
      send.receiptOk = !(info.receipt?.problems?.length || info.receipt?.notFound?.length);
      lastReceipt = { id: day.id, n: send.n, text: send.receipt, ok: send.receiptOk };
    } else lastReceipt = null;
    delete day.pending;
    day.sends.push(send);
    await saveDay(day);
    if (!info.renamed?.length) toast(`Sent ${info.file || filename} (send #${send.n})`);
    render();
    pullChart(); // APP-11-22-CHART
  } catch (err) {
    // APP-11-11: remember that this day still has to be sent.
    // `answered` = the computer was reached and said no (file open in Word, drive missing, wrong token): that is not
    // tried again by itself, because the computer keeps a copy of every send it could not save.
    day.pending = { at: Date.now(), error: err.message, answered: !!err.answered || /^No computer address/.test(err.message) };
    await saveDay(day);
    if (!quiet) go({ name: 'log', fallback: { send, error: err.message } });
  }
}

async function deleteFileOnComputer() {
  try {
    const res = await fetch(`${receiverBase()}api/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': settings.receiverToken || '' },
      body: JSON.stringify({ date: day.date, building: bname(day.building), formerNames: formerNames(day.building) }),
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'The receiver rejected the token.' : `Receiver error ${res.status}`);
    const { removed } = await res.json();
    day.sends.push({ kind: 'deleted', at: Date.now() });
    await saveDay(day);
    toast(removed ? `Deleted ${removed} file${removed === 1 ? '' : 's'} from your computer` : 'No file for this day was on the computer');
    render();
  } catch (err) {
    toast(err.message.startsWith('Receiver') || err.message.startsWith('The') ? err.message : 'Computer not reachable. Is Tailscale on and the receiver running?');
  }
}

// ---------- log ----------

function renderLog() {
  const fb = view.fallback;
  const conflict = view.conflict;
  const lines = logLines(day, day.sends);
  const changed = changedSinceSend(day);
  const filename = summaryFilename(named());
  app.innerHTML = `
    <div class="top">
      <button class="ghost" data-act="back">‹ List</button>
      <div class="grow"><h1>${fb ? 'Send didn\'t reach the computer' : conflict ? 'File already there' : view.blanks ? 'Blanks left to fill' : view.clashes ? 'Check before sending' : 'Send log'}</h1></div>
    </div>
    ${view.clashes ? `<div class="banner" style="margin-bottom:12px;display:block"><div>${view.clashes.length} note${view.clashes.length === 1 ? ' needs' : 's need'} a look before the day goes. <b>Nothing was sent.</b></div>
      ${view.clashes.map((x) => clashHtml(x.list, x.who)).join('')}
      <div class="row" style="margin-top:8px"><button class="primary" data-act="back">Go back and fix them</button><button data-act="send-clashes">Send anyway</button></div></div>` : ''}
    ${view.blanks ? `<div class="banner" style="margin-bottom:12px"><div>These notes still have a ___ that was not filled in: <b>${esc(view.blanks.join('; '))}</b>. Nothing was sent.</div>
      <button class="primary" data-act="back">Go back and fill them</button><button data-act="send-blanks">Send anyway</button></div>` : ''}
    ${fb ? `<div class="banner" style="margin-bottom:12px">${esc(fb.error.startsWith('Failed') || fb.error.includes('NetworkError') ? 'The computer could not be reached. Check that Tailscale is on and the receiver is running. You can also save the Word file and put it in the building\'s Daily folder yourself.' : fb.error)}</div>
      <div class="row" style="margin-bottom:12px"><button class="primary grow" data-act="retry">Try again</button></div>` : ''}
    ${conflict ? `<div class="banner" style="margin-bottom:12px">${esc(conflict.filename)} is already in the Daily folder and was not made by this app. Replace it?
      <button class="danger" data-act="send-overwrite">Replace it</button><button data-act="back">Cancel</button></div>` : ''}
    <div class="row" style="margin-bottom:12px">
      ${navigator.canShare ? '<button class="grow" data-act="share">Share Word file</button>' : ''}
      <button class="grow" data-act="download">Save Word file</button>
      <button class="grow" data-act="copy-summary">Copy text</button>
    </div>
    <h2>${esc(day.building ? `${bname(day.building)} · ` : '')}${esc(formatDate(day.date))}</h2>
    ${lines.length ? `<pre class="summary">${esc(lines.join('\n'))}</pre>` : '<p class="muted">Nothing sent yet for this day.</p>'}
    ${day.sends.filter((x) => x.receipt).slice(-3).reverse().map((x) => `<div class="card" style="margin:8px 0;border-left:4px solid var(${x.receiptOk ? '--good' : '--amber'})">
      <b class="small">Computer's receipt for send #${x.n}</b><div class="small" style="white-space:pre-wrap">${esc(x.receipt)}</div></div>`).join('')}
    ${day.sends.length && changed.length ? `<p class="small" style="color:var(--amber)">${changed.length} patient(s) changed since the last send.</p>` : ''}
    ${!fb && !conflict && day.sends.some((s) => s.kind !== 'deleted') ? `<div style="margin:10px 0">
      <button class="ghost danger" data-act="del-file">Delete this day's file from computer</button>
      <div id="del-file-confirm" class="banner" hidden>Delete ${esc(filename)} from the computer? This can't be undone. Notes on this phone are kept.
        <button class="danger" data-act="del-file-yes">Delete file</button><button data-act="del-file-no">Keep</button></div>
    </div>` : ''}
    <h2>${esc(filename)}</h2>
    <pre class="summary">${esc(buildSummary(named()))}</pre>`;
}

// Save the Word file to the phone (Downloads), for moving to the computer by hand.
function downloadDayFile() {
  const { filename, bytes } = dayFile();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: DOCX_TYPE }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function shareDayFile() {
  const { filename, bytes } = dayFile();
  const file = new File([bytes], filename, { type: DOCX_TYPE });
  // Some phones (Chrome on Android) won't share Word files; save to Downloads instead.
  if (!navigator.canShare?.({ files: [file] })) {
    downloadDayFile();
    toast('This phone can\'t share Word files directly, so it was saved to Downloads.');
    return;
  }
  try {
    await navigator.share({ files: [file], title: filename });
  } catch (err) {
    if (err.name === 'AbortError') return; // cancelled
    downloadDayFile();
    toast('Sharing didn\'t work, so the file was saved to Downloads.');
    return;
  }
  // A share after a failed send counts as that send, so the log stays complete.
  if (view.fallback) {
    const { send } = view.fallback;
    send.via = 'share';
    delete day.pending; // APP-11-11
    day.sends.push(send);
    await saveDay(day);
    toast('Shared. Logged as sent.');
    history.back();
  }
}

// ---------- buildings ----------

// Saved days per building id, for the Manage and Rename screens.
async function dayCounts() {
  const out = {};
  for (const d of await listDays()) {
    if (!d.patients.length) continue;
    const c = (out[d.building] ??= { days: 0, patients: 0 });
    c.days++;
    c.patients += d.patients.length;
  }
  return out;
}

async function renderBuildings() {
  const counts = await dayCounts();
  if (view.name !== 'buildings') return;
  const list = settings.buildings;
  app.innerHTML = `
    <div class="top">
      <button class="ghost" data-act="back">‹ Back</button>
      <div class="grow"><h1>Manage buildings</h1></div>
    </div>
    <p class="small muted">The order here is the order of the building buttons. Renaming keeps every patient and note.</p>
    <div class="stack">${list.map((id, i) => `
      <div class="card brow">
        <div class="grow"><b>${esc(bname(id))}</b><div class="small muted">${counts[id] ? `${counts[id].days} day${counts[id].days === 1 ? '' : 's'} saved on this phone` : 'No days saved yet'}</div></div>
        <button data-act="b-up" data-i="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>↑</button>
        <button data-act="b-down" data-i="${i}" aria-label="Move down" ${i < list.length - 1 ? '' : 'disabled'}>↓</button>
        <button data-act="b-rename" data-b="${esc(id)}">Rename</button>
      </div>`).join('') || '<p class="muted">No buildings yet.</p>'}
    </div>
    <div class="row" style="margin-top:14px">
      <input id="new-building" placeholder="New building name" autocomplete="off" style="flex:1">
      <button class="primary" data-act="save-building">Add</button>
    </div>
    <p class="small muted" style="margin-top:14px">Remove is on each building's Rename screen.</p>`;
}

async function renderRename() {
  const id = view.id;
  const counts = (await dayCounts())[id];
  if (view.name !== 'rename') return;
  const old = bname(id);
  app.innerHTML = `
    <div class="top">
      <button class="ghost" data-act="back">‹ Cancel</button>
      <div class="grow"><h1>Rename ${esc(old)}</h1></div>
    </div>
    <div class="stack">
      <label>New name<input id="rn-name" value="${esc(old)}" autocomplete="off"></label>
      <div id="rn-msg" class="small" style="color:var(--bad)"></div>
      <div class="card"><b>On this phone</b><div class="small">${counts ? `${counts.days} day${counts.days === 1 ? '' : 's'} and ${counts.patients} patient visits keep their notes and show under the new name.` : 'No saved days yet.'}</div></div>
      <div class="card"><b>On your computers</b>
        <div class="small mono" style="margin-top:4px">…\\${esc(old)}\\Daily\\${esc(old)} Daily notes …docx</div>
        <div class="small" style="color:var(--accent);font-weight:700">↓</div>
        <div class="small mono" id="rn-new">…\\${esc(old)}\\Daily\\${esc(old)} Daily notes …docx</div>
        <div class="small muted" style="margin-top:6px">Done on each computer the next time you send a day to it. Nothing is deleted. If a folder with the new name is already there, the files are moved into it without replacing any.</div>
      </div>
      <label class="check"><input type="checkbox" id="rn-pc" checked> Also rename the folder and files on my computers</label>
      <button class="primary" data-act="rename-yes">Rename</button>
      <h2>Remove</h2>
      <p class="small muted">Takes ${esc(old)} off the building buttons. Its saved days stay on this phone until they age out, and come back if you add a building with this name again.</p>
      <button class="danger" data-act="b-remove">Remove ${esc(old)} from the buttons</button>
      <div id="b-remove-confirm" class="banner" hidden>Remove ${esc(old)}?
        <button class="danger" data-act="b-remove-yes">Remove</button><button data-act="b-remove-no">Keep</button></div>
    </div>`;
  const input = app.querySelector('#rn-name');
  const show = () => {
    const n = cleanBuilding(input.value) || old;
    app.querySelector('#rn-new').textContent = `…\\${n}\\Daily\\${n} Daily notes …docx`;
  };
  input.addEventListener('input', show);
}

async function renameBuilding(id, name, onComputer) {
  const old = bname(id);
  settings.buildingNames = { ...(settings.buildingNames || {}), [id]: name };
  if (name === id) delete settings.buildingNames[id];
  const former = (settings.buildingFormer?.[id] || []).filter((n) => n !== name);
  if (onComputer && old !== name && !former.includes(old)) former.push(old);
  settings.buildingFormer = { ...(settings.buildingFormer || {}), [id]: former };
  await saveSettings(settings);
}

// Add a building, or go to it if one with that name is already there. Returns its id.
function addBuilding(name) {
  const have = settings.buildings.find((id) => bname(id).toLowerCase() === name.toLowerCase());
  if (have) return have;
  // A renamed building keeps its first name as its id, so a new one may need a different id.
  const taken = (x) => settings.buildings.includes(x) || Object.keys(settings.buildingNames || {}).includes(x);
  let id = name;
  if (taken(id)) id = `${name}~${Date.now().toString(36)}`;
  if (id !== name) settings.buildingNames = { ...(settings.buildingNames || {}), [id]: name };
  settings.buildings = [...settings.buildings, id];
  return id;
}

// ---------- roll over ----------

async function renderRollover() {
  const days = (await listDays())
    .filter((d) => d.building === day.building && d.date !== day.date && d.patients.length)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (view.name !== 'rollover') return;
  view.from ??= days.find((d) => d.date < day.date)?.date || days[0]?.date;
  const src = days.find((d) => d.date === view.from);
  const have = new Set(day.patients.map((p) => p.mrn));
  app.innerHTML = `
    <div class="top">
      <button class="ghost" data-act="back">‹ List</button>
      <div class="grow"><h1>Roll over patients</h1></div>
    </div>
    ${days.length ? `<div class="stack">
      <label>Bring patients from this ${esc(bname(day.building) || '')} day
        <select id="ro-from">${days.map((d) => `<option value="${d.date}" ${d.date === view.from ? 'selected' : ''}>${esc(formatDate(d.date))} · ${d.patients.length} patients</option>`).join('')}</select></label>
      <p class="small muted" style="margin:0">Everyone is checked. Uncheck anyone who discharged.${day.patients.length ? ' Patients already on this day are skipped.' : ''}</p>
      <div class="review">${src.patients.map((p, i) => `
        <label class="ro-row ${have.has(p.mrn) ? 'muted' : ''}"><input type="checkbox" data-i="${i}" ${have.has(p.mrn) ? 'disabled' : 'checked'}>
          <span class="mono">${esc(p.last)}, ${esc(p.first)} (${esc(p.mrn)})</span>${have.has(p.mrn) ? '<span class="small"> already here</span>' : ''}</label>`).join('')}</div>
      <button class="primary" data-act="ro-add" style="width:100%">Add to ${esc(formatDate(day.date))}</button>
      <p class="small muted">Each patient's <b>Start from last note</b> will offer their ${esc(formatDate(src.date))} note.</p>
    </div>` : `<p class="card">No other saved days for ${esc(bname(day.building) || 'this list')} on this phone yet. Days are kept for ${settings.retentionDays} days after they're sent (change this in Settings).</p>`}`;
  app.querySelector('#ro-from')?.addEventListener('change', (e) => { view.from = e.target.value; renderRollover(); });
  view.src = src;
}

async function addRollover() {
  const src = view.src;
  const have = new Set(day.patients.map((p) => p.mrn));
  let added = 0;
  app.querySelectorAll('.ro-row input:checked').forEach((cb) => {
    const q = src.patients[+cb.dataset.i];
    if (have.has(q.mrn)) return;
    have.add(q.mrn);
    day.patients.push({ last: q.last, first: q.first, mrn: q.mrn, room: q.room, status: 'new', text: '', rollFrom: { date: src.date, building: src.building } });
    added++;
  });
  await saveDay(day);
  day = await loadDay(day.date, day.building);
  toast(`Added ${added} patient${added === 1 ? '' : 's'} from ${formatDate(src.date)}`);
  history.back();
}

// ---------- settings ----------

function renderSettings() {
  const s = settings;
  app.innerHTML = `
    <div class="top">
      <button class="ghost" data-act="back">‹ List</button>
      <div class="grow"><h1>Settings</h1></div>
      <button class="primary" data-act="save-settings">Save</button>
    </div>
    <div class="stack">
      <div class="row"><div class="grow small muted">Buildings: ${esc(s.buildings.map(bname).join(', ') || 'none yet')}</div><button data-act="manage-buildings">Manage buildings</button></div>
      <label>Your name<input id="s-provider" value="${esc(s.providerName)}"></label>
      <div class="row"><div class="grow small muted">Time clock: your in and out times for each building and day.</div><button data-act="timelog">Time log</button></div>

      <h2>Note template</h2>
      <p class="small muted">{location} is filled by the location button, {pain} by the keypad, {vitals} by loaded vitals (left blank otherwise).</p>
      <textarea id="s-template" rows="6">${esc(s.template)}</textarea>
      <label class="check"><input type="checkbox" id="s-standing" ${s.carryStanding !== false ? 'checked' : ''}> Carry the oxygen set-up, catheter, ostomy and PEG tube to the next day's note, for you to confirm</label>
      <label class="check"><input type="checkbox" id="s-vary" ${s.varyWording !== false ? 'checked' : ''}> Vary the wording of the routine sentences from day to day (same meaning, nothing added)</label>

      <h2>Location buttons</h2>
      <div class="stack" id="s-locs">${s.locations.map((l) => `
        <div class="phrase-row"><input class="k mono" value="${esc(l.key)}" aria-label="Button"><input class="t" value="${esc(l.text)}" aria-label="Sentence"><input class="grp" value="${esc(l.label)}" aria-label="Label"><span></span></div>`).join('')}</div>

      <h2>Smart phrases and shortcuts</h2>
      <p class="small muted">Type a shortcut then a space to expand it, or tap its group on the phrase bar. Pinned groups show first.</p>
      <label>Pinned groups (comma separated)<input id="s-pinned" value="${esc(s.pinned.join(', '))}"></label>
      <input id="s-filter" type="search" placeholder="Search phrases">
      <div class="stack" id="s-phrases">${s.phrases.map(phraseRow).join('')}</div>
      <div class="row">
        <button data-act="add-phrase">Add phrase</button>
        <button data-act="export-phrases">Export</button>
        <label class="btn" style="display:flex;align-items:center;color:var(--ink)">Import<input type="file" id="s-import" accept=".json,.txt" hidden></label>
      </div>

      <h2>Antibiotics list</h2>
      <p class="small muted">One per line. These show when you add an antibiotic on the ABX button. A name in brackets helps the search and is left out of the note.</p>
      <textarea id="s-abx" rows="6">${esc((s.abxList || []).join('\n'))}</textarea>

      <h2>Clinical rules</h2>
      <div class="row">
        <label class="grow">Flag pain at or above<input id="s-highpain" type="number" min="0" max="10" value="${esc(s.highPain)}"></label>
        <label class="grow">Fasting BS from<input id="s-fs" type="time" value="${esc(s.fastingStart)}"></label>
        <label class="grow">until<input id="s-fe" type="time" value="${esc(s.fastingEnd)}"></label>
      </div>

      <h2>Privacy</h2>
      <label>Delete a day from this device this many days after it's sent (Roll over can only use days still on the phone)<input id="s-ret" type="number" min="1" value="${esc(s.retentionDays)}"></label>

      <h2>Computer</h2>
      <label>Computer address (leave blank if this app was opened from your computer)<input id="s-url" class="mono" value="${esc(s.receiverUrl)}" placeholder="https://your-pc.tail1234.ts.net" autocomplete="off" inputmode="url"></label>
      <label>Receiver token (shown when you start the receiver)<input id="s-token" class="mono" value="${esc(s.receiverToken)}" autocomplete="off"></label>
      <button data-act="test-receiver">Test connection</button>

      <h2>Backup</h2>
      <p class="small muted">Saves every day, note and antibiotic course on this phone into one file in Downloads. The file holds patient notes, so keep it on the phone or your own computer. Restore only adds days that are not on this phone; it never replaces a day that is here.</p>
      <div class="row">
        <button data-act="backup">Save a backup file</button>
        <label class="btn" style="display:flex;align-items:center;color:var(--ink)">Restore from a backup<input type="file" id="s-restore" accept=".json,application/json" hidden></label>
      </div>

      <h2>Reset</h2>
      <button class="danger" data-act="reset-phrases">Restore starter phrases</button>
      <p class="small muted">App version ${APP_VERSION} · opened from ${esc(location.origin + location.pathname)}</p>
    </div>`;

  app.querySelector('#s-filter').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    app.querySelectorAll('#s-phrases .phrase-row').forEach((r) => {
      r.hidden = q && !r.textContent.toLowerCase().includes(q) && ![...r.querySelectorAll('input,textarea')].some((i) => i.value.toLowerCase().includes(q));
    });
  });
  // APP-11-11
  app.querySelector('#s-restore').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = await importAll(JSON.parse(await f.text()));
      abx = await getAbx();
      day = await loadDay(day.date, day.building);
      toast(`Restored ${r.days} day${r.days === 1 ? '' : 's'}${r.skipped ? `; ${r.skipped} already on this phone were left as they are` : ''}`, 5000);
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file could not be read as a backup.' : err.message, 5000);
    }
    e.target.value = '';
  });
  app.querySelector('#s-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    let list;
    try {
      list = JSON.parse(text);
    } catch {
      // "key = text" or "key<TAB>text" per line
      list = text.split(/\r?\n/).map((l) => l.match(/^\s*(\S+)\s*(?:=|\t|:)\s*(.+)$/)).filter(Boolean).map((m) => ({ key: m[1], text: m[2], group: 'Imported' }));
    }
    const box = app.querySelector('#s-phrases');
    list.forEach((p) => box.insertAdjacentHTML('beforeend', phraseRow(p)));
    toast(`Imported ${list.length} phrases. Tap Save to keep them.`);
  });
}

function phraseRow(p = { key: '', text: '', group: '' }) {
  return `<div class="phrase-row">
    <input class="k mono" value="${esc(p.key)}" placeholder=".x" aria-label="Shortcut">
    <textarea class="t" rows="1" aria-label="Phrase">${esc(p.text)}</textarea>
    <input class="grp" value="${esc(p.group)}" placeholder="Group" aria-label="Group">
    <button class="ghost danger" data-act="del-phrase" aria-label="Delete">✕</button>
  </div>`;
}

function readSettingsForm() {
  const q = (id) => app.querySelector(id);
  return {
    ...settings,
    providerName: q('#s-provider').value.trim(),
    abxList: [...new Set(q('#s-abx').value.split('\n').map((x) => x.trim()).filter(Boolean))],
    template: q('#s-template').value,
    varyWording: q('#s-vary').checked, // APP-11-11
    carryStanding: q('#s-standing').checked, // APP-11-26D
    locations: [...app.querySelectorAll('#s-locs .phrase-row')].map((r) => ({
      key: r.querySelector('.k').value.trim(), text: r.querySelector('.t').value.trim(), label: r.querySelector('.grp').value.trim(),
    })),
    pinned: q('#s-pinned').value.split(',').map((x) => x.trim()).filter(Boolean),
    phrases: [...app.querySelectorAll('#s-phrases .phrase-row')].map((r) => ({
      key: r.querySelector('.k').value.trim(), text: r.querySelector('.t').value.trim(), group: r.querySelector('.grp').value.trim() || 'Other',
    })).filter((p) => p.key && p.text),
    highPain: +q('#s-highpain').value || 7,
    fastingStart: q('#s-fs').value || '04:00',
    fastingEnd: q('#s-fe').value || '09:00',
    retentionDays: +q('#s-ret').value || 7,
    receiverToken: q('#s-token').value.trim(),
    receiverUrl: q('#s-url').value.trim(),
  };
}

// ===== APP-11-27A  START: "Make patient list" under the loaded patients =====
// His request: "at the bottom of the loaded patient section I want a button that makes a list of the loaded patients.
// Makes it into a docx or pdf file that I can copy and paste. Tap the button it make, then once it's made have a copy button".
// The list is the patients on screen, in the order on screen, exactly as stored. Nothing is sent anywhere.
const ptListLines = () => patientListLines(day, bname(day.building), ptList.room);
const ptListName = () => `Patient list ${bname(day.building) || 'no building'} ${day.date}.docx`.replace(/[\\/:*?"<>|]/g, '_');

function ptListHtml() {
  if (!day.patients.length) return '';
  if (!ptList.open) return '<button class="grow" data-act="ptlist-make" style="width:100%">Make patient list</button>';
  const lines = ptListLines();
  return `<div class="card" style="display:grid;gap:8px">
    <div class="row" style="align-items:center"><b class="grow">Patient list</b><button class="ghost small" data-act="ptlist-close">Close</button></div>
    <div class="row" style="align-items:center;flex-wrap:wrap"><span class="small muted">Lines:</span>
      <button class="dpreset ${ptList.room ? 'on' : ''}" data-act="ptlist-room" data-v="1" style="min-height:36px;padding:4px 10px">With room</button>
      <button class="dpreset ${ptList.room ? '' : 'on'}" data-act="ptlist-room" data-v="0" style="min-height:36px;padding:4px 10px">Without room</button></div>
    <textarea id="ptlist-text" readonly rows="${Math.min(lines.length + 1, 14)}" class="mono" style="width:100%;font-size:.85rem;white-space:pre;overflow:auto">${esc(lines.join('\n'))}</textarea>
    <div class="row" style="flex-wrap:wrap">
      <button class="primary grow" data-act="ptlist-copy">Copy list</button>
      <button class="grow" data-act="ptlist-docx">Save Word file</button>
      ${navigator.canShare ? '<button class="grow" data-act="ptlist-share">Share Word file</button>' : ''}
    </div>
    <div class="small muted">${lines.length - 1} patient${lines.length === 2 ? '' : 's'}, in the order shown above. Copy puts the list on the clipboard so you can paste it anywhere.</div>
  </div>`;
}

function ptListRedraw() {
  const box = document.getElementById('ptlist');
  if (box) box.innerHTML = ptListHtml();
}

async function ptListCopy() {
  const text = ptListLines().join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast(`Patient list copied (${day.patients.length})`);
  } catch {
    const ta = document.getElementById('ptlist-text'); // no clipboard permission: select it so a long-press Copy works
    if (ta) { ta.focus(); ta.select(); }
    toast('Could not copy by itself. The list is selected - press and hold, then Copy.', 5000);
  }
}

function ptListFile() {
  const filename = ptListName();
  return new File([makeDocx(ptListLines(), { title: filename.replace(/\.docx$/, '') })], filename, { type: DOCX_TYPE });
}
// ===== APP-11-27A  END =====

function downloadText(filename, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    toast('Copy failed. Select the text and copy it manually.');
  }
}

// ---------- events ----------

app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const p = view.name === 'patient' ? current() : null;
  switch (act) {
    case 'back': history.back(); break;
    case 'settings': go({ name: 'settings' }); break;
    case 'log': go({ name: 'log' }); break;
    case 'import': go({ name: 'import', kind: b.dataset.kind }); break;
    case 'parse': showParsed(app.querySelector('#raw').value); break;
    case 'add-roster': await addRoster(); break;
    case 'apply-vitals': await applyVitals(); break;
    case 'open': {
      const i = +b.dataset.i;
      abxMode = null;
      go({ name: 'patient', i, last: await findLastNote(day.patients[i]) });
      break;
    }
    case 'carry': {
      const last = view.last;
      Object.assign(p, {
        text: settings.varyWording !== false ? varyWording(carryForward(last.note, p.vitals, settings), last.note) : carryForward(last.note, p.vitals, settings), // APP-11-11
        location: last.location ?? null,
        pain: last.pain ?? null,
        painSide: last.painSide || '',
        painSite: [...(last.painSite || [])],
        painType: [...(last.painType || [])],
        fields: {}, // the last note already contains its details
        carriedFrom: last.date,
        status: 'progress',
        updatedAt: Date.now(),
      });
      applyStanding(p, last); // APP-11-26D
      await saveDay(day);
      render();
      break;
    }
    case 'loc': p.location = +b.dataset.i; await saveDay(day); render(); break;
    case 'pain': p.pain = b.dataset.v === '' ? null : +b.dataset.v; delete view.painPick; await saveDay(day); render(); break;
    case 'pain-pick': view.painPick = +b.dataset.v; render(); break;
    case 'pain-side': case 'pain-site': case 'pain-type': case 'pain-back': {
      const v = b.dataset.v;
      if (act === 'pain-side') p.painSide = p.painSide === v ? '' : v;
      else if (act === 'pain-back' || (act === 'pain-site' && v === 'back')) { // APP-11-22
        const cur = backSite(p);
        const rest = (p.painSite || []).filter((x) => x !== cur);
        if (act === 'pain-site') p.painSite = cur != null ? rest : [...rest, 'back']; // tap "back": on, or off with its part
        else p.painSite = [...rest, cur === `${v} back` ? 'back' : `${v} back`]; // tap a part: set it, or back to plain "back"
      } else {
        const field = act === 'pain-site' ? 'painSite' : 'painType';
        const list = p[field] || [];
        p[field] = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
      }
      syncPainSentence(p);
      await saveDay(day);
      if (document.getElementById('note')) redrawDetails(); else render();
      break;
    }
    case 'done':
      await flushNote();
      p.status = 'done';
      await saveDay(day);
      history.back();
      break;
    case 'copy': await flushNote(); copyText(fullNote(current())); break;
    case 'del-day': case 'del-pt': case 'del-file': app.querySelector(`#${act}-confirm`).hidden = false; break;
    case 'del-day-no': case 'del-pt-no': case 'del-file-no': app.querySelector(`#${act.slice(0, -3)}-confirm`).hidden = true; break;
    case 'del-day-yes': {
      const { date, building } = day;
      await deleteDay(day);
      day = await loadDay(date, building);
      toast(`Deleted ${building ? `${bname(building)}, ` : ''}${formatDate(date)} from this phone`);
      render();
      break;
    }
    case 'del-day-empty': { // APP-11-26F: a change of plans - drop the patients not seen yet, keep every note written
      const n = day.patients.length;
      day.patients = day.patients.filter((x) => String(x.text || '').trim());
      await saveDay(day);
      toast(`Removed ${n - day.patients.length} patient${n - day.patients.length === 1 ? '' : 's'} with no note`);
      render();
      break;
    }
    case 'ptlist-make': ptList.open = true; ptListRedraw(); document.getElementById('ptlist')?.scrollIntoView({ block: 'nearest' }); break; // APP-11-27A
    case 'ptlist-close': ptList.open = false; ptListRedraw(); break;
    case 'ptlist-room': ptList.room = b.dataset.v === '1'; ptListRedraw(); break;
    case 'ptlist-copy': await ptListCopy(); break;
    case 'ptlist-docx': {
      const f = ptListFile();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast(`Saved to Downloads: ${f.name}`, 4000);
      break;
    }
    case 'ptlist-share': {
      const f = ptListFile();
      if (!navigator.canShare?.({ files: [f] })) { toast('This phone cannot share a file from here. Use Save Word file.', 4500); break; }
      try { await navigator.share({ files: [f], title: f.name }); } catch { /* closed the share sheet */ }
      break;
    }
    case 'sort': { // APP-11-26F: put the list in this order; the numbers follow. Tap the same one again to stop keeping it sorted.
      settings.sortBy = settings.sortBy === b.dataset.by ? '' : b.dataset.by;
      await saveSettings(settings);
      if (settings.sortBy) { day.patients = sortPatients(day.patients, settings.sortBy); await saveDay(day); }
      render();
      break;
    }
    case 'roster-load': { // APP-11-26F: the roster pulled from the computer's folder goes through the same review as a chosen file
      const r = rosters[rosterKey()];
      if (r?.text) { view.ocr = false; app.querySelector('#raw').value = r.text; showParsed(r.text); }
      break;
    }
    case 'roster-check': await pullRoster(day.building, day.date, { loud: true }); break;
    case 'del-day-bld': {
      const { date, building } = day;
      await deleteDay(day);
      const bn = bname(building);
      await removeBuilding(building, date);
      toast(`Deleted ${bn}, ${formatDate(date)} and removed ${bn}`);
      render();
      break;
    }
    case 'del-bld': {
      const { building } = day;
      await removeBuilding(building, day.date);
      toast(`Removed ${bname(building)}. Add it again any time with + Building.`);
      render();
      break;
    }
    case 'del-pt-yes': {
      clearTimeout(saveTimer);
      document.getElementById('note')?.remove(); // so leaving the screen can't save this text onto the next patient
      const [gone] = day.patients.splice(view.i, 1);
      await saveDay(day);
      toast(`Deleted ${gone.last}, ${gone.first}`);
      history.back();
      break;
    }
    case 'del-file-yes': await deleteFileOnComputer(); break;
    case 'building':
      await switchBuilding(b.dataset.b);
      render();
      break;
    case 'pick-building': {
      const box = app.querySelector('#bpicker');
      if (!box.hidden) { box.hidden = true; break; }
      box.innerHTML = `<div class="small muted">Switch building. This note is saved first.</div>
        ${settings.buildings.map((id) => `<button class="opt ${id === day.building ? 'on' : ''}" data-act="pick-b" data-b="${esc(id)}"><b>${esc(bname(id))}</b>${countHtml(id)}</button>`).join('')}`;
      box.hidden = false;
      updateCounts();
      break;
    }
    case 'pick-b': {
      app.querySelector('#bpicker').hidden = true;
      if (b.dataset.b === day.building) break;
      await flushNote();
      clearTimeout(saveTimer);
      document.getElementById('note')?.remove(); // so leaving the screen can't save this text onto another patient
      await switchBuilding(b.dataset.b);
      history.back(); // back to the list, now for the other building
      break;
    }
    case 'manage-buildings': go({ name: 'buildings' }); break;
    case 'b-up': case 'b-down': {
      const i = +b.dataset.i;
      const j = act === 'b-up' ? i - 1 : i + 1;
      const list = [...settings.buildings];
      [list[i], list[j]] = [list[j], list[i]];
      settings.buildings = list;
      await saveSettings(settings);
      render();
      break;
    }
    case 'b-rename': go({ name: 'rename', id: b.dataset.b }); break;
    case 'rename-yes': {
      const name = cleanBuilding(app.querySelector('#rn-name').value);
      const msg = app.querySelector('#rn-msg');
      if (!name) { msg.textContent = 'Type a name (letters, numbers, spaces, - _ .).'; break; }
      const clash = settings.buildings.find((id) => id !== view.id && bname(id).toLowerCase() === name.toLowerCase());
      if (clash) { msg.textContent = `${bname(clash)} is already a building. Pick another name.`; break; }
      const old = bname(view.id);
      await renameBuilding(view.id, name, app.querySelector('#rn-pc').checked);
      toast(`Renamed ${old} to ${name}`);
      view = { name: 'buildings' };
      render();
      break;
    }
    case 'b-remove': app.querySelector('#b-remove-confirm').hidden = false; break;
    case 'b-remove-no': app.querySelector('#b-remove-confirm').hidden = true; break;
    case 'b-remove-yes': {
      const old = bname(view.id);
      await removeBuilding(view.id, day.date);
      toast(`Removed ${old}. Add it again any time with + Building.`);
      view = { name: 'buildings' };
      render();
      break;
    }
    case 'rollover': go({ name: 'rollover' }); break;
    case 'ro-add': await addRollover(); break;
    // APP-11-22: correct a patient's name or MRN after the visit was started
    case 'edit-pt': {
      const f = app.querySelector('#edit-pt-form');
      f.hidden = !f.hidden;
      if (!f.hidden) app.querySelector('#ep-last').focus();
      break;
    }
    case 'edit-pt-cancel': app.querySelector('#edit-pt-form').hidden = true; break;
    case 'edit-pt-save': {
      const val = (id) => app.querySelector(id).value.trim();
      const next = { last: val('#ep-last'), first: val('#ep-first'), mrn: val('#ep-mrn') };
      const msg = app.querySelector('#ep-msg');
      if (!next.last || !next.mrn) { msg.textContent = 'Last name and MRN are needed.'; break; }
      const dupe = day.patients.findIndex((x) => x !== p && x.mrn === next.mrn);
      if (dupe >= 0) { msg.textContent = `MRN ${next.mrn} is already on the list as #${dupe + 1}.`; break; }
      if (document.getElementById('note')) await flushNote();
      const oldMrn = p.mrn;
      Object.assign(p, next);
      p.updatedAt = Date.now();
      if (oldMrn !== next.mrn && abx[oldMrn]?.length) { // the antibiotic courses follow the patient to the corrected MRN
        abx[next.mrn] = [...(abx[next.mrn] || []), ...abx[oldMrn]];
        delete abx[oldMrn];
        await saveAbx(abx);
      }
      await saveDay(day);
      toast(`Saved: ${next.last}, ${next.first} (${next.mrn})`);
      render();
      break;
    }
    case 'add-pt':
      app.querySelector('#add-pt-form').hidden = false;
      app.querySelector('#ap-last').focus();
      break;
    case 'add-pt-cancel': app.querySelector('#add-pt-form').hidden = true; break;
    case 'add-pt-save': {
      const val = (id) => app.querySelector(id).value.trim();
      const np = { last: val('#ap-last'), first: val('#ap-first'), mrn: val('#ap-mrn'), room: val('#ap-room'), status: 'new', text: '' };
      const msg = app.querySelector('#ap-msg');
      if (!np.last || !np.mrn) { msg.textContent = 'Last name and MRN are needed.'; break; }
      const dupe = day.patients.findIndex((x) => x.mrn === np.mrn);
      if (dupe >= 0) { msg.textContent = `MRN ${np.mrn} is already on the list as #${dupe + 1}.`; break; }
      day.patients.push(np);
      if (settings.sortBy) day.patients = sortPatients(day.patients, settings.sortBy); // APP-11-26F
      await saveDay(day);
      toast(`Added ${np.last}, ${np.first}`);
      render();
      break;
    }
    case 'add-building':
      app.querySelector('#add-building-form').hidden = false;
      app.querySelector('#new-building').focus();
      break;
    case 'save-building': {
      const name = cleanBuilding(app.querySelector('#new-building').value);
      if (!name) break;
      const id = addBuilding(name);
      settings.currentBuilding = id;
      await saveSettings(settings);
      day = await loadDay(day.date, id);
      if (view.name === 'buildings') toast(`Added ${name}`);
      render();
      break;
    }
    case 'restart': app.querySelector('#restart-confirm').hidden = false; break;
    case 'restart-no': app.querySelector('#restart-confirm').hidden = true; break;
    case 'restart-yes':
      p.text = '';
      p.location = undefined;
      p.pain = undefined;
      p.fields = {};
      delete p.carriedFrom;
      delete p.carriedSet; // APP-11-26D
      p.painSite = [];
      p.painType = [];
      p.painSide = '';
      p.status = 'new';
      await saveDay(day);
      render();
      break;
    case 'drop-pain-sentence': {
      const ta = app.querySelector('#note');
      ta.value = ta.value.replace(/\s*(?:Pt's pain|Pain(?: remains| level| is)?) within acceptable limits\./i, ''); // APP-11-11: any of the wordings
      app.querySelector('#painbanner')?.remove();
      await flushNote();
      break;
    }
    case 'send': await sendDay(); break;
    // APP-11-24: time clock
    case 'fold': { // APP-11-25B: fold or unfold the Time card or the Not sent card; remembered on this phone
      settings.folded = { ...(settings.folded || {}), [b.dataset.k]: !settings.folded?.[b.dataset.k] };
      await saveSettings(settings);
      const cbox = app.querySelector('#clock');
      if (cbox) { cbox.innerHTML = clockHtml(); wireClock(); }
      const ubox = document.getElementById('unsent');
      if (ubox) ubox.innerHTML = unsentHtml();
      chartsRedraw(); // APP-11-25H
      break;
    }
    case 'charts-all': await pullAllCharts({ loud: true }); break; // APP-11-25H
    case 'clock-in': await clockChange((segs) => segs.push({ in: nowHM(), out: '' })); break;
    case 'clock-out': await clockChange((segs) => { const open = segs.find((s) => s.in && !s.out); if (open) open.out = nowHM(); }); break;
    case 'clock-add': await clockChange((segs) => segs.push({ in: '', out: '' })); break;
    case 'clock-del': await clockChange((segs) => segs.splice(+b.dataset.i, 1)); break;
    case 'timelog': go({ name: 'timelog' }); break;
    case 'timelog-open': {
      const b2 = b.dataset.b;
      if (b2 && settings.buildings.includes(b2)) { settings.currentBuilding = b2; await saveSettings(settings); }
      day = await loadDay(b.dataset.date, b2);
      try { sessionStorage.setItem('date', day.date); } catch { /* ignore */ }
      history.back(); // back to the list, which now shows that day
      break;
    }
    case 'timelog-copy': {
      const text = timeLogText();
      try { await navigator.clipboard.writeText(text); toast('Time log copied'); } catch { downloadText(`Bedside time log ${todayIso()}.txt`, text); toast('Time log saved to Downloads'); }
      break;
    }
    // APP-11-11
    case 'send-blanks': history.back(); setTimeout(() => sendDay({ allowBlanks: true }), 50); break;
    case 'standing-ok': delete p.carriedSet; p.updatedAt = Date.now(); await saveDay(day); render(); break; // APP-11-26D
    case 'standing-drop': {
      await flushNote();
      p.text = stripRetapped(p.text, p).trim(); // the sentences yesterday's note carried for these settings go too
      for (const root of ['o2', 'gu']) {
        for (const k of p.carriedSet?.[root] || []) delete p[root]?.[k];
        if (p[root] && !Object.keys(p[root]).length) delete p[root];
      }
      delete p.carriedSet;
      p.updatedAt = Date.now();
      await saveDay(day);
      render();
      break;
    }
    case 'send-clashes': history.back(); setTimeout(() => sendDay({ allowBlanks: true, allowClashes: true }), 50); break; // APP-11-26B
    case 'receipt-ok': lastReceipt = null; render(); break;
    case 'goto-day': {
      const b2 = b.dataset.b;
      if (b2 && settings.buildings.includes(b2)) { settings.currentBuilding = b2; await saveSettings(settings); }
      day = await loadDay(b.dataset.date, b2);
      try { sessionStorage.setItem('date', day.date); } catch { /* ignore */ }
      render();
      break;
    }
    case 'backup': {
      const data = await exportAll();
      downloadText(`Bedside backup ${todayIso()}.json`, JSON.stringify(data), 'application/json');
      toast(`Backup saved to Downloads: ${data.days.filter((d) => d.patients.length).length} days`, 4000);
      break;
    }
    case 'install':
      if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; render(); }
      break;
    case 'retry': history.back(); setTimeout(() => sendDay({ allowBlanks: true, allowClashes: true }), 50); break;
    case 'share': await shareDayFile(); break;
    case 'download': downloadDayFile(); break;
    case 'send-overwrite': history.back(); setTimeout(() => sendDay({ overwrite: true, allowBlanks: true }), 50); break;
    case 'copy-summary': copyText(buildSummary(named())); break;
    case 'save-settings':
      settings = readSettingsForm();
      await saveSettings(settings);
      toast('Settings saved');
      break;
    case 'add-phrase':
      app.querySelector('#s-phrases').insertAdjacentHTML('afterbegin', phraseRow());
      app.querySelector('#s-phrases .k').focus();
      break;
    case 'del-phrase': b.closest('.phrase-row').remove(); break;
    case 'export-phrases':
      downloadText('phrases.json', JSON.stringify(readSettingsForm().phrases, null, 2), 'application/json');
      break;
    case 'reset-phrases':
      app.querySelector('#s-phrases').innerHTML = DEFAULT_SETTINGS.phrases.map(phraseRow).join('');
      toast('Starter phrases restored. Tap Save to keep them.');
      break;
    case 'test-receiver':
      try {
        const r = await fetch(`${receiverBase(app.querySelector('#s-url').value.trim())}api/ping`, { headers: { 'X-Token': app.querySelector('#s-token').value.trim() } });
        toast(r.ok ? 'Connected to your computer' : r.status === 401 ? 'Wrong token' : `Receiver error ${r.status}`);
      } catch {
        toast('Computer not reachable. Is Tailscale on and the receiver running?');
      }
      break;
    default: break;
  }
});

document.addEventListener('visibilitychange', () => { if (document.hidden) flushNote(); });

boot();
