// Local storage in IndexedDB. Nothing here leaves the device.
// Two object stores: "days" (one record per date of service) and "kv" (settings).

import { DEFAULT_SETTINGS } from './defaults.js';

const DB_NAME = 'bedside-subjective';
let dbp;

function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('days', { keyPath: 'date' });
      req.result.createObjectStore('kv');
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

export async function getDay(date) {
  return (await tx('days', 'readonly', (s) => s.get(date))) || { date, patients: [], sends: [] };
}

export function saveDay(day) {
  return tx('days', 'readwrite', (s) => s.put(day));
}

export function deleteDay(date) {
  return tx('days', 'readwrite', (s) => s.delete(date));
}

export async function listDays() {
  return (await tx('days', 'readonly', (s) => s.getAllKeys())) || [];
}

export async function getSettings() {
  const saved = await tx('kv', 'readonly', (s) => s.get('settings'));
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}

export function saveSettings(settings) {
  return tx('kv', 'readwrite', (s) => s.put(settings, 'settings'));
}

/** Delete days that were sent and are older than the retention window. */
export async function purgeOld(retentionDays) {
  if (!retentionDays) return;
  const cutoff = Date.now() - retentionDays * 86400000;
  for (const date of await listDays()) {
    const day = await getDay(date);
    const last = day.sends?.[day.sends.length - 1];
    if (last && last.at < cutoff) await deleteDay(date);
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
