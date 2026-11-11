// Local storage in IndexedDB. Nothing here leaves the device.
// "visits" holds one record per building + date of service; "kv" holds settings.

import { DEFAULT_SETTINGS } from './defaults.js';

const DB_NAME = 'bedside-subjective';
let dbp;

export const visitId = (date, building = '') => (building ? `${building}|${date}` : date);

function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const d = req.result;
      if (e.oldVersion < 1) d.createObjectStore('kv');
      const visits = d.createObjectStore('visits', { keyPath: 'id' });
      // Version 1 kept one record per date with no building. Carry those over unchanged.
      if (e.oldVersion === 1) {
        const old = req.transaction.objectStore('days');
        old.openCursor().onsuccess = (ev) => {
          const cur = ev.target.result;
          if (!cur) { d.deleteObjectStore('days'); return; }
          visits.put({ ...cur.value, id: cur.value.date, building: '' });
          cur.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function getDay(date, building = '') {
  const id = visitId(date, building);
  return (await tx('visits', 'readonly', (s) => s.get(id))) || { id, date, building, patients: [], sends: [] };
}

export function saveDay(day) {
  return tx('visits', 'readwrite', (s) => s.put(day));
}

export function deleteDay(day) {
  return tx('visits', 'readwrite', (s) => s.delete(day.id));
}

export async function listDays() {
  return (await tx('visits', 'readonly', (s) => s.getAll())) || [];
}

export async function getSettings() {
  const saved = await tx('kv', 'readonly', (s) => s.get('settings'));
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}

export function saveSettings(settings) {
  return tx('kv', 'readwrite', (s) => s.put(settings, 'settings'));
}

/** Antibiotic courses by MRN: { [mrn]: [course, ...] }. Kept apart from days so they outlast the cleanup below. */
export async function getAbx() {
  return (await tx('kv', 'readonly', (s) => s.get('abx'))) || {};
}

export function saveAbx(abx) {
  return tx('kv', 'readwrite', (s) => s.put(abx, 'abx'));
}

/** Delete visits that were sent and are older than the retention window. */
export async function purgeOld(retentionDays, keep = () => false) {
  if (!retentionDays) return;
  const cutoff = Date.now() - retentionDays * 86400000;
  for (const day of await listDays()) {
    const last = [...(day.sends || [])].reverse().find((s) => s.hashes);
    // APP-11-11: a day that was changed after its last send is kept until it is sent again (or deleted by hand).
    if (last && last.at < cutoff && !keep(day)) await deleteDay(day);
  }
}

// ===== APP-11-11  START: backup =====

/** Everything on this phone as one object: days, antibiotic courses and settings (never the receiver token). */
export async function exportAll() {
  const { receiverToken, ...settings } = await getSettings();
  return { app: 'bedside-subjective', backup: 1, made: new Date().toISOString(), days: await listDays(), abx: await getAbx(), settings };
}

/**
 * Put a backup back. Only what is missing is added: a day already on this phone is left as it is,
 * an antibiotic course already here is left as it is, and settings are not touched.
 * Returns { days, skipped, abx } counts.
 */
export async function importAll(data) {
  if (data?.app !== 'bedside-subjective' || !Array.isArray(data.days)) throw new Error('That is not a Bedside backup file.');
  const have = new Set((await listDays()).filter((d) => d.patients.length).map((d) => d.id));
  let days = 0;
  let skipped = 0;
  for (const d of data.days) {
    if (!d?.id || !d.date || !Array.isArray(d.patients)) continue;
    if (have.has(d.id)) { skipped++; continue; }
    await saveDay({ ...d, sends: d.sends || [] });
    days++;
  }
  const abx = await getAbx();
  let added = 0;
  for (const [mrn, list] of Object.entries(data.abx || {})) {
    if (!Array.isArray(list)) continue;
    const mine = abx[mrn] || [];
    for (const c of list) if (c?.id && !mine.some((x) => x.id === c.id)) { mine.push(c); added++; }
    if (mine.length) abx[mrn] = mine;
  }
  if (added) await saveAbx(abx);
  return { days, skipped, abx: added };
}

// ===== APP-11-11  END =====

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    return await navigator.storage?.persist?.();
  } catch {
    return false;
  }
}
