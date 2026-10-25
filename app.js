// Bedside Subjective: screens and event handling.
// Screens: day (patient list), import (roster or vitals), patient (prompts + editor), settings, log.

import { parseRoster, parseVitals, matchVitals, formatVitals } from './parsers.js';
import { renderTemplate, expandShortcut, patientLabel, buildSummary, summaryFilename, nextSend, logLines, changedSinceSend, formatDate } from './note.js';
import { getDay, saveDay, deleteDay, getSettings, saveSettings, purgeOld, requestPersistence } from './store.js';
import { fileToText } from './importers.js';
import { DEFAULT_SETTINGS } from './defaults.js';

// Bump with every release so it's easy to confirm a phone has the latest copy.
const APP_VERSION = 4;

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

let settings;
let day;
let view = { name: 'day' };

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
  requestPersistence();
  purgeOld(settings.retentionDays);
  let date = todayIso();
  try { date = sessionStorage.getItem('date') || date; } catch { /* private mode */ }
  if (settings.buildings.length && !settings.buildings.includes(settings.currentBuilding)) settings.currentBuilding = settings.buildings[0];
  day = await getDay(date, settings.currentBuilding);
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

function render() {
  document.querySelector('.phrase-bar')?.remove();
  const screens = { day: renderDay, import: renderImport, patient: renderPatient, settings: renderSettings, log: renderLog };
  screens[view.name]();
  window.scrollTo(0, 0);
}

// ---------- day ----------

function statusPill(p) {
  if (p.status === 'done') return '<span class="pill p-good">Done</span>';
  if (p.text) return '<span class="pill p-amber">In progress</span>';
  return '<span class="pill p-acc">Not started</span>';
}

function renderDay() {
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
      ${settings.buildings.map((b) => `<button class="bchip ${b === day.building ? 'on' : ''}" data-act="building" data-b="${esc(b)}" aria-pressed="${b === day.building}">${esc(b)}</button>`).join('')}
      <button class="bchip add" data-act="add-building">+ Building</button>
    </div>
    <div id="add-building-form" class="row" style="margin-bottom:12px" hidden>
      <input id="new-building" placeholder="Building name, e.g. Wellsprings" autocomplete="off" style="flex:1">
      <button class="primary" data-act="save-building">Add</button>
    </div>
    ${!settings.buildings.length ? '<p class="small muted" style="margin:0 0 12px">Add the buildings you see patients at. Each building keeps its own patient list and its own daily file.</p>' : ''}
    <div class="row" style="margin-bottom:12px">
      <label class="grow">Date of service<input type="date" id="date" value="${esc(day.date)}"></label>
    </div>
    <div class="row" style="margin-bottom:14px">
      <button class="grow" data-act="import" data-kind="roster">Load patients</button>
      <button class="grow" data-act="import" data-kind="vitals" ${day.patients.length ? '' : 'disabled'}>Load vitals</button>
    </div>
    ${day.patients.length ? `<div class="patients">${day.patients.map((p, i) => `
      <button class="pt-btn" data-act="open" data-i="${i}">
        <span class="name">${esc(patientLabel(p, i))}</span>
        <span class="meta">${[p.room, p.vitals ? 'vitals loaded' : ''].filter(Boolean).map(esc).join(' · ')}</span>
        <span class="status">${statusPill(p)}</span>
      </button>`).join('')}</div>
      <div style="margin-top:18px">
        <button class="ghost danger" data-act="del-day">Delete this day</button>
        <div id="del-day-confirm" class="banner" hidden>Delete all ${day.patients.length} patients and notes for ${esc(day.building ? `${day.building}, ` : '')}${esc(formatDate(day.date))} from this phone? Files already sent to your computer stay there.
          <button class="danger" data-act="del-day-yes">Delete day</button><button data-act="del-day-no">Keep</button></div>
      </div>`
      : `<div class="empty card"><p><b>No patients for ${esc(day.building ? `${day.building} on ` : '')}${esc(formatDate(day.date))} yet.</b></p><p>Tap <b>Load patients</b> and choose your PCC roster as a PDF, Word file or photo, or paste the text.</p></div>`}
    ${day.patients.length ? `<div class="bottom-bar"><div class="inner">
      <div class="grow small muted">${documented} of ${day.patients.length} documented${day.sends.length ? ` · sent ${day.sends.filter((s) => s.kind !== 'deleted').length}×${changed ? ` · <b style="color:var(--amber)">${changed} changed since</b>` : ''}` : ''}</div>
      ${day.sends.length ? '<button class="ghost" data-act="log">Log</button>' : ''}
      <button class="primary" data-act="send" ${documented ? '' : 'disabled'}>Send day</button>
    </div></div>` : ''}`;

  app.querySelector('#date').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    day = await getDay(e.target.value, day.building);
    try { sessionStorage.setItem('date', day.date); } catch { /* ignore */ }
    render();
  });
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
        ? 'A PDF exported from PCC reads exactly. Photos work too, and any MRN that might be misread is highlighted for you to check.'
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
      const text = await fileToText(file, (p) => { bar.style.width = `${Math.round(p * 100)}%`; });
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
      <button class="primary" data-act="add-roster" style="width:100%">Add to ${esc(day.building ? `${day.building} · ` : '')}${esc(formatDate(day.date))}</button>`;
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

function renderPatient() {
  const p = current();
  const header = `
    <div class="top">
      <button class="ghost" data-act="back">‹ List</button>
      <div class="grow"><h1 class="mono" style="font-size:1rem">${esc(patientLabel(p, view.i))}</h1></div>
      <span id="saved" class="pill p-good">${p.text ? 'Saved' : ''}</span>
    </div>`;

  if (!p.text && p.location == null) {
    app.innerHTML = `${header}<div class="prompt-title">Where was the patient assessed?</div>
      <div class="loc-grid">${settings.locations.map((l, i) => `
        <button data-act="loc" data-i="${i}"><b>${esc(l.key)}</b><span>${esc(l.label)}</span></button>`).join('')}</div>`;
    return;
  }
  if (!p.text && p.pain === undefined) {
    const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    app.innerHTML = `${header}<div class="prompt-title">Pain today, out of 10</div>
      <div class="keypad">
        ${keys.map((k) => `<button data-act="pain" data-v="${k}">${k}</button>`).join('')}
        <button class="skip" data-act="pain" data-v="">Skip</button>
        <button data-act="pain" data-v="0">0</button>
        <button data-act="pain" data-v="10">10</button>
      </div>`;
    return;
  }
  if (!p.text) {
    const loc = settings.locations[p.location];
    p.text = renderTemplate(settings, { locationText: loc?.text, pain: p.pain, vitals: p.vitals }) + ' ';
    p.status = 'progress';
    saveDay(day);
  }

  const highPain = p.pain != null && p.pain >= settings.highPain && /pain within acceptable limits/i.test(p.text);
  app.innerHTML = `${header}
    <div class="editor-wrap">
      ${p.vitals ? `<div class="vitals-line">Vitals: ${esc(formatVitals(p.vitals, settings))}</div>` : ''}
      ${highPain ? `<div class="banner" id="painbanner">Pain is ${p.pain}/10. Is "pain within acceptable limits" still right?
        <button class="ghost" data-act="drop-pain-sentence">Remove that sentence</button></div>` : ''}
      <textarea id="note" spellcheck="true" autocapitalize="sentences" aria-label="Subjective note">${esc(p.text)}</textarea>
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
  ta.addEventListener('blur', flushNote);
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

async function sendDay() {
  const send = nextSend(day);
  const content = buildSummary(day, send, settings);
  const filename = summaryFilename(day);
  const logLine = logLines(day, [send])[0];
  try {
    const res = await fetch(`${receiverBase()}api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': settings.receiverToken || '' },
      body: JSON.stringify({ date: day.date, building: day.building || '', sendNo: send.n, filename, content, logLine }),
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'The receiver rejected the token. Check Settings.' : `Receiver error ${res.status}`);
    day.sends.push(send);
    await saveDay(day);
    toast(`Sent to computer (send #${send.n})`);
    render();
  } catch (err) {
    view = { name: 'log', fallback: { content, filename, send, error: err.message } };
    render();
  }
}

async function deleteFileOnComputer() {
  try {
    const res = await fetch(`${receiverBase()}api/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': settings.receiverToken || '' },
      body: JSON.stringify({ date: day.date, building: day.building || '' }),
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
  const lines = logLines(day, day.sends);
  const changed = changedSinceSend(day);
  app.innerHTML = `
    <div class="top">
      <button class="ghost" data-act="back">‹ List</button>
      <div class="grow"><h1>${fb ? 'Send didn\'t reach the computer' : 'Send log'}</h1></div>
    </div>
    ${fb ? `<div class="banner" style="margin-bottom:12px">${esc(fb.error.startsWith('Failed') || fb.error.includes('NetworkError') ? 'The computer could not be reached. Check that Tailscale is on and the receiver is running.' : fb.error)}</div>
      <div class="row" style="margin-bottom:12px">
        <button class="primary grow" data-act="retry">Try again</button>
        ${navigator.canShare ? '<button class="grow" data-act="share">Share file (Taildrop)</button>' : ''}
        <button class="grow" data-act="copy-summary">Copy text</button>
      </div>` : ''}
    <h2>${esc(day.building ? `${day.building} · ` : '')}${esc(formatDate(day.date))}</h2>
    ${lines.length ? `<pre class="summary">${esc(lines.join('\n'))}</pre>` : '<p class="muted">Nothing sent yet for this day.</p>'}
    ${day.sends.length && changed.length ? `<p class="small" style="color:var(--amber)">${changed.length} patient(s) changed since the last send.</p>` : ''}
    ${!fb && day.sends.some((s) => s.kind !== 'deleted') ? `<div style="margin:10px 0">
      <button class="ghost danger" data-act="del-file">Delete this day's file from computer</button>
      <div id="del-file-confirm" class="banner" hidden>Delete ${esc(summaryFilename(day))} and its saved copies from your computer? This can't be undone. Notes on this phone are kept.
        <button class="danger" data-act="del-file-yes">Delete file</button><button data-act="del-file-no">Keep</button></div>
    </div>` : ''}
    <h2>${fb ? 'File to send' : 'Preview of next send'}</h2>
    <pre class="summary">${esc(fb ? fb.content : buildSummary(day, nextSend(day), settings))}</pre>`;
}

async function shareFallback() {
  const { content, filename, send } = view.fallback;
  const file = new File([content], filename, { type: 'text/plain' });
  try {
    await navigator.share({ files: [file], title: filename });
    send.via = 'share';
    day.sends.push(send);
    await saveDay(day);
    toast('Shared. Logged as sent.');
    history.back();
  } catch { /* cancelled */ }
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
      <label>Buildings, one per line (each gets its own patient list and daily file)<textarea id="s-buildings" rows="3">${esc(s.buildings.join('\n'))}</textarea></label>
      <label>Your name (printed on the daily file)<input id="s-provider" value="${esc(s.providerName)}"></label>

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

      <h2>Clinical rules</h2>
      <div class="row">
        <label class="grow">Flag pain at or above<input id="s-highpain" type="number" min="0" max="10" value="${esc(s.highPain)}"></label>
        <label class="grow">Fasting BS from<input id="s-fs" type="time" value="${esc(s.fastingStart)}"></label>
        <label class="grow">until<input id="s-fe" type="time" value="${esc(s.fastingEnd)}"></label>
      </div>

      <h2>Privacy</h2>
      <label>Delete a day from this device this many days after it's sent<input id="s-ret" type="number" min="1" value="${esc(s.retentionDays)}"></label>

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
    buildings: [...new Set(q('#s-buildings').value.split('\n').map(cleanBuilding).filter(Boolean))],
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
    case 'open': go({ name: 'patient', i: +b.dataset.i }); break;
    case 'loc': p.location = +b.dataset.i; await saveDay(day); render(); break;
    case 'pain': p.pain = b.dataset.v === '' ? null : +b.dataset.v; await saveDay(day); render(); break;
    case 'done':
      await flushNote();
      p.status = 'done';
      await saveDay(day);
      history.back();
      break;
    case 'copy': copyText(app.querySelector('#note').value); break;
    case 'del-day': case 'del-pt': case 'del-file': app.querySelector(`#${act}-confirm`).hidden = false; break;
    case 'del-day-no': case 'del-pt-no': case 'del-file-no': app.querySelector(`#${act.slice(0, -3)}-confirm`).hidden = true; break;
    case 'del-day-yes': {
      const { date, building } = day;
      await deleteDay(day);
      day = await getDay(date, building);
      toast(`Deleted ${building ? `${building}, ` : ''}${formatDate(date)} from this phone`);
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
      settings.currentBuilding = b.dataset.b;
      await saveSettings(settings);
      day = await getDay(day.date, settings.currentBuilding);
      render();
      break;
    case 'add-building':
      app.querySelector('#add-building-form').hidden = false;
      app.querySelector('#new-building').focus();
      break;
    case 'save-building': {
      const name = cleanBuilding(app.querySelector('#new-building').value);
      if (!name) break;
      if (!settings.buildings.includes(name)) settings.buildings = [...settings.buildings, name];
      settings.currentBuilding = name;
      await saveSettings(settings);
      day = await getDay(day.date, name);
      render();
      break;
    }
    case 'restart': app.querySelector('#restart-confirm').hidden = false; break;
    case 'restart-no': app.querySelector('#restart-confirm').hidden = true; break;
    case 'restart-yes':
      p.text = '';
      p.location = undefined;
      p.pain = undefined;
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
    case 'share': await shareFallback(); break;
    case 'copy-summary': copyText(view.fallback.content); break;
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
