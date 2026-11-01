// Bedside Subjective: screens and event handling.
// Screens: day (patient list), import (roster or vitals), patient (prompts + editor), settings, log.

import { parseRoster, parseVitals, matchVitals, formatVitals } from './parsers.js';
import { renderTemplate, expandShortcut, patientLabel, fullNote, detailSentences, painPhrase, buildSummary, summaryLines, summaryFilename, carryForward, wordDiff, abxSentences, abxDayNumber, abxEndDate, abxState, abxName, nextSend, logLines, changedSinceSend, formatDate } from './note.js';
import { getDay, saveDay, deleteDay, listDays, getSettings, saveSettings, purgeOld, requestPersistence, getAbx, saveAbx } from './store.js';
import { fileToText } from './importers.js';
import { makeDocx, DOCX_TYPE } from './docx.js';
import { DEFAULT_SETTINGS, DETAILS, PAIN_SIDES, PAIN_SITES, PAIN_TYPES } from './defaults.js';

// Bump with every release so it's easy to confirm a phone has the latest copy.
const APP_VERSION = 14;

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

let settings;
let day;
let view = { name: 'day' };
let abx = {}; // antibiotic courses by MRN
let bcounts = {}; // building id -> { done, total } for the date on screen
let focusNext = false; // after switching building, scroll to the next patient not done

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
  requestPersistence();
  purgeOld(settings.retentionDays);
  let date = todayIso();
  try { date = sessionStorage.getItem('date') || date; } catch { /* private mode */ }
  if (settings.buildings.length && !settings.buildings.includes(settings.currentBuilding)) settings.currentBuilding = settings.buildings[0];
  day = await loadDay(date, settings.currentBuilding);
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

function render() {
  document.querySelector('.phrase-bar')?.remove();
  const screens = { day: renderDay, import: renderImport, patient: renderPatient, settings: renderSettings, log: renderLog, buildings: renderBuildings, rename: renderRename, rollover: renderRollover };
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
    ${day.patients.length ? `<div class="patients">${day.patients.map((p, i) => `
      <button class="pt-btn ${i === nextIdx ? 'next' : ''}" data-act="open" data-i="${i}">
        <span class="name">${esc(patientLabel(p, i))}</span>
        <span class="meta">${[p.room, p.vitals ? 'vitals loaded' : ''].filter(Boolean).map(esc).join(' · ')}${activeAbx(p.mrn, day.date).length ? ' <span class="abx-tag">ABX</span>' : ''}</span>
        <span class="status">${statusPill(p)}</span>
      </button>`).join('')}</div>
      <div style="margin-top:18px">
        <button class="ghost danger" data-act="del-day">Delete this day</button>
        <div id="del-day-confirm" class="banner" hidden>Delete all ${day.patients.length} patients and notes for ${esc(bn ? `${bn}, ` : '')}${esc(formatDate(day.date))} from this phone? Files already sent to your computer stay there.
          <button class="danger" data-act="del-day-yes">Delete day</button><button data-act="del-day-no">Keep</button></div>
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
}

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
    const rows = parseRoster(text);
    view.rows = rows;
    if (!rows.length) {
      out.innerHTML = '<p class="card">No names with MRNs found. Check the text above, edit it if needed, and tap Read pasted text.</p>';
      return;
    }
    const flagged = rows.filter((r) => r.flag).length;
    out.innerHTML = `
      <h2>${rows.length} patients found${flagged ? ` · <span style="color:var(--amber)">${flagged} to check</span>` : ''}</h2>
      <div class="review">${rows.map((r, i) => `
        <div class="review-row ${r.flag ? 'flagged' : ''}" data-i="${i}">
          <input type="checkbox" checked aria-label="Include ${esc(r.last)}">
          <input class="last" value="${esc(r.last)}" aria-label="Last name">
          <input class="first" value="${esc(r.first)}" aria-label="First name">
          <input class="mrn mono" value="${esc(r.mrn)}" inputmode="numeric" aria-label="MRN">
          ${r.flag ? `<div class="flag">${esc(r.flag)}</div>` : ''}
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
      room: r.room,
      status: 'new',
      text: '',
    };
    if (!p.last || have.has(p.mrn)) return;
    have.add(p.mrn);
    day.patients.push(p);
    added++;
  });
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
    if (p.text && /Vital signs:\s+denies/.test(p.text)) {
      p.text = p.text.replace(/Vital signs:\s+denies/, `Vital signs: ${formatVitals(readings, settings)}; denies`);
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
    if (q) return { date: d.date, building: d.building, note: fullNote(q), pain: q.pain, painSide: q.painSide, painSite: q.painSite, painType: q.painType, location: q.location };
  }
  for (const d of days) {
    if (d.date >= day.date) continue;
    const q = d.patients.find((x) => x.mrn === p.mrn && x.text);
    if (!q) continue;
    const better = !best || d.date > best.date || (d.date === best.date && d.building === day.building);
    if (better) best = { date: d.date, building: d.building, note: fullNote(q), pain: q.pain, painSide: q.painSide, painSite: q.painSite, painType: q.painType, location: q.location };
  }
  return best;
}

function lastNoteLabel(last) {
  return `${formatDate(last.date)}${last.building && last.building !== day.building ? ` at ${bname(last.building)}` : ''}`;
}

function renderPatient() {
  const p = current();
  const header = `
    <div class="top">
      <button class="ghost" data-act="back">‹ List</button>
      <div class="grow"><h1 class="mono" style="font-size:1rem">${esc(patientLabel(p, view.i))}</h1></div>
      <span id="saved" class="pill p-good">${p.text ? 'Saved' : ''}</span>
      ${settings.buildings.length > 1 ? `<button class="bchip on small" data-act="pick-building" aria-haspopup="true">${esc(bname(day.building))} ▾</button>` : ''}
    </div>
    <div id="bpicker" class="bpicker" hidden></div>`;

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
    p.status = 'progress';
    p.fresh = true;
    saveDay(day);
  }

  const highPain = p.pain != null && p.pain >= settings.highPain && /pain within acceptable limits/i.test(p.text);
  app.innerHTML = `${header}
    <div class="editor-wrap">
      ${p.vitals ? `<div class="vitals-line">Vitals: ${esc(formatVitals(p.vitals, settings))}</div>` : ''}
      ${highPain ? `<div class="banner" id="painbanner">Pain is ${p.pain}/10. Is "pain within acceptable limits" still right?
        <button class="ghost" data-act="drop-pain-sentence">Remove that sentence</button></div>` : ''}
      ${p.carriedFrom && p.status !== 'done' ? `<div class="banner" style="margin-bottom:8px">Started from the ${esc(formatDate(p.carriedFrom))} note. Check pain, vitals and anything new.</div>` : ''}
      <div class="details" id="details"></div>
      <textarea id="note" spellcheck="true" autocapitalize="sentences" aria-label="Subjective note">${esc(p.text)}</textarea>
      <div class="detail-preview small" id="detail-preview"></div>
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
  const filled = (d) => (d.key === 'pain' ? p.pain != null : d.key === 'abx' ? activeAbx(p.mrn, day.date).length > 0 : String(p.fields[d.key] ?? '').trim() !== '');
  const filledAbx = () => activeAbx(p.mrn, day.date).length;
  const shown = (d) => {
    if (d.key === 'pain') return p.pain != null ? `${p.pain}/10` : '';
    if (d.key === 'abx') return String(filledAbx() || '');
    const v = String(p.fields[d.key] ?? '');
    return d.unit === '%' && /\d$/.test(v) ? `${v}%` : v;
  };

  const preview = () => {
    if (!box.isConnected) return;
    // Show the whole note as it will be sent, with the details in their places.
    if (!detailSentences(p).length) { app.querySelector('#detail-preview').innerHTML = ''; return; }
    const ta = document.getElementById('note');
    const shown = ta ? { ...p, text: ta.value } : p;
    app.querySelector('#detail-preview').innerHTML = `<div class="muted">As it will be sent:</div>${esc(fullNote(shown))}`;
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
    box.innerHTML = `<div class="dchips">${DETAILS.map((x) => `
      <button class="dchip ${filled(x) ? 'filled' : ''} ${x.key === open ? 'open' : ''}" data-dkey="${x.key}" aria-expanded="${x.key === open}">
        ${esc(x.label)}${filled(x) ? ` <small>${esc(shown(x).slice(0, 14))}${shown(x).length > 14 ? '…' : ''}</small>` : ''}</button>`).join('')}</div>
      ${d ? panel(d) : ''}`;
    wireAbxForm(box);
    box.querySelector('#dinput')?.addEventListener('input', (e) => {
      p.fields[open] = e.target.value;
      clearTimeout(box._t);
      box._t = setTimeout(save, 300);
    });
  };

  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.abx) { await abxAction(p, b); if (!box.isConnected) return; await save(); }
    else if (b.dataset.dkey) { open = open === b.dataset.dkey ? null : b.dataset.dkey; abxMode = null; }
    else if (b.dataset.dnext) open = b.dataset.dnext;
    else if ('dclose' in b.dataset) open = null;
    else if ('dclear' in b.dataset) {
      if (open === 'pain') setPain(p, null); else delete p.fields[open];
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
}

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
function painExtras(p) {
  const grid = (extra = '') => `style="grid-template-columns:repeat(auto-fill,minmax(96px,1fr));${extra}"`;
  const chips = (act, list, on) => list.map((x) => `<button data-act="${act}" data-v="${esc(x)}" class="${on(x) ? 'on' : ''}">${esc(x)}</button>`).join('');
  return `<div class="pain-extras">
    <div class="small muted" style="margin:14px 0 6px">Area (optional)</div>
    <div class="dkeys" ${grid()}>${chips('pain-side', PAIN_SIDES, (x) => p.painSide === x)}</div>
    <div class="dkeys" ${grid('margin-top:6px')}>${chips('pain-site', PAIN_SITES, (x) => (p.painSite || []).includes(x))}</div>
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
  scheduleSave();
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

async function sendDay({ overwrite = false } = {}) {
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
      go({ name: 'log', conflict: { filename } });
      return;
    }
    if (!res.ok) throw new Error(res.status === 401 ? 'The receiver rejected the token. Check Settings.' : `Receiver error ${res.status}`);
    const info = await res.json().catch(() => ({}));
    if (info.renamed?.length) toast(`Renamed ${info.renamed.join(', ')} to ${bname(day.building)} on the computer`, 4000);
    day.sends.push(send);
    await saveDay(day);
    if (!info.renamed?.length) toast(`Sent ${info.file || filename} (send #${send.n})`);
    render();
  } catch (err) {
    go({ name: 'log', fallback: { send, error: err.message } });
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
      <div class="grow"><h1>${fb ? 'Send didn\'t reach the computer' : conflict ? 'File already there' : 'Send log'}</h1></div>
    </div>
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

      <h2>Note template</h2>
      <p class="small muted">{location} is filled by the location button, {pain} by the keypad, {vitals} by loaded vitals (left blank otherwise).</p>
      <textarea id="s-template" rows="6">${esc(s.template)}</textarea>

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
        text: carryForward(last.note, p.vitals, settings),
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
      await saveDay(day);
      render();
      break;
    }
    case 'loc': p.location = +b.dataset.i; await saveDay(day); render(); break;
    case 'pain': p.pain = b.dataset.v === '' ? null : +b.dataset.v; delete view.painPick; await saveDay(day); render(); break;
    case 'pain-pick': view.painPick = +b.dataset.v; render(); break;
    case 'pain-side': case 'pain-site': case 'pain-type': {
      const v = b.dataset.v;
      if (act === 'pain-side') p.painSide = p.painSide === v ? '' : v;
      else {
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
      await saveDay(day);
      toast(`Added ${day.patients.length}. ${np.last}, ${np.first}`);
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
      p.painSite = [];
      p.painType = [];
      p.painSide = '';
      p.status = 'new';
      await saveDay(day);
      render();
      break;
    case 'drop-pain-sentence': {
      const ta = app.querySelector('#note');
      ta.value = ta.value.replace(/\s*Pt's pain within acceptable limits\./i, '');
      app.querySelector('#painbanner')?.remove();
      await flushNote();
      break;
    }
    case 'send': await sendDay(); break;
    case 'install':
      if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; render(); }
      break;
    case 'retry': history.back(); setTimeout(sendDay, 50); break;
    case 'share': await shareDayFile(); break;
    case 'download': downloadDayFile(); break;
    case 'send-overwrite': history.back(); setTimeout(() => sendDay({ overwrite: true }), 50); break;
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
