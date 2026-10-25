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

/** Delete visits that were sent and are older than the retention window. */
export async function purgeOld(retentionDays) {
  if (!retentionDays) return;
  const cutoff = Date.now() - retentionDays * 86400000;
  for (const day of await listDays()) {
    const last = [...(day.sends || [])].reverse().find((s) => s.hashes);
    if (last && last.at < cutoff) await deleteDay(day);
  }
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    return await navigator.storage?.persist?.();
  } catch {
    return false;
  }
}
