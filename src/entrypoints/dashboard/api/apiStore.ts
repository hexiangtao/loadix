/**
 * Requests workspace storage: an IndexedDB-backed store for API requests,
 * collections, and send history.
 *
 * Mirrors the markdown docStore deliberately: raw IndexedDB (no wrapper),
 * promisified, self-contained, and the same "draft until named" lifecycle.
 */

import type { ApiCollection, ApiHistoryEntry, ApiRequest } from './apiTypes';
import type { ApiEnvironment } from './variables';

const DB_NAME = 'loadix-api';
const DB_VERSION = 2;
const HISTORY_CAP = 100;

let dbPromise: Promise<IDBDatabase> | null = null;

/** Small promisified request wrapper. */
function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('requests')) db.createObjectStore('requests', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('collections')) db.createObjectStore('collections', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('environments')) db.createObjectStore('environments', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
    });
  }
  return dbPromise;
}

/* ——— Requests ——— */

export async function getAllRequests(): Promise<ApiRequest[]> {
  const db = await open();
  return req(db.transaction('requests', 'readonly').objectStore('requests').getAll() as IDBRequest<ApiRequest[]>);
}

export async function saveRequest(request: ApiRequest): Promise<void> {
  const db = await open();
  await req(db.transaction('requests', 'readwrite').objectStore('requests').put(request));
}

export async function deleteRequest(id: string): Promise<void> {
  const db = await open();
  await req(db.transaction('requests', 'readwrite').objectStore('requests').delete(id));
}

/** Persists a batch of request updates (reorders / moves) in one transaction. */
export async function saveRequests(batch: ApiRequest[]): Promise<void> {
  const db = await open();
  const store = db.transaction('requests', 'readwrite').objectStore('requests');
  for (const r of batch) store.put(r);
}

/* ——— Collections ——— */

export async function getAllCollections(): Promise<ApiCollection[]> {
  const db = await open();
  return req(db.transaction('collections', 'readonly').objectStore('collections').getAll() as IDBRequest<ApiCollection[]>);
}

export async function saveCollection(collection: ApiCollection): Promise<void> {
  const db = await open();
  await req(db.transaction('collections', 'readwrite').objectStore('collections').put(collection));
}

/** Persists a batch of collection updates (reorders / reparents) in one transaction. */
export async function saveCollections(batch: ApiCollection[]): Promise<void> {
  const db = await open();
  const store = db.transaction('collections', 'readwrite').objectStore('collections');
  for (const c of batch) store.put(c);
}

/**
 * Deletes a collection and its whole subtree, together with every request
 * they held — deletion is recursive and total, nothing is left behind as
 * stray drafts.
 */
export async function deleteCollection(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(['requests', 'collections'], 'readwrite');
  const collectionStore = tx.objectStore('collections');
  const allCollections = await req(collectionStore.getAll() as IDBRequest<ApiCollection[]>);
  const doomed = new Set<string>();
  const walk = (cid: string) => {
    if (doomed.has(cid)) return;
    doomed.add(cid);
    for (const c of allCollections) if (c.parentId === cid) walk(c.id);
  };
  walk(id);
  for (const cid of doomed) await req(collectionStore.delete(cid));
  const requestStore = tx.objectStore('requests');
  const requests = await req(requestStore.getAll() as IDBRequest<ApiRequest[]>);
  for (const request of requests) {
    if (request.collectionId != null && doomed.has(request.collectionId)) {
      await req(requestStore.delete(request.id));
    }
  }
}

/* ——— History ——— */

export async function getAllHistory(): Promise<ApiHistoryEntry[]> {
  const db = await open();
  return req(db.transaction('history', 'readonly').objectStore('history').getAll() as IDBRequest<ApiHistoryEntry[]>);
}

/** Inserts a history entry and trims to the most recent HISTORY_CAP. */
export async function addHistoryEntry(entry: ApiHistoryEntry): Promise<void> {
  const db = await open();
  const tx = db.transaction('history', 'readwrite');
  const store = tx.objectStore('history');
  await req(store.put(entry));
  const all = await req(store.getAll() as IDBRequest<ApiHistoryEntry[]>);
  const sorted = [...all].sort((a, b) => b.sentAt - a.sentAt);
  for (const old of sorted.slice(HISTORY_CAP)) await req(store.delete(old.id));
}

export async function clearHistory(): Promise<void> {
  const db = await open();
  await req(db.transaction('history', 'readwrite').objectStore('history').clear());
}

/* ——— Environments ——— */

export async function getAllEnvironments(): Promise<ApiEnvironment[]> {
  const db = await open();
  return req(db.transaction('environments', 'readonly').objectStore('environments').getAll() as IDBRequest<ApiEnvironment[]>);
}

export async function saveEnvironment(environment: ApiEnvironment): Promise<void> {
  const db = await open();
  await req(db.transaction('environments', 'readwrite').objectStore('environments').put(environment));
}

export async function deleteEnvironment(id: string): Promise<void> {
  const db = await open();
  await req(db.transaction('environments', 'readwrite').objectStore('environments').delete(id));
}

/* ——— Workspace ——— */

export async function loadWorkspace(): Promise<{
  requests: ApiRequest[];
  collections: ApiCollection[];
  history: ApiHistoryEntry[];
  environments: ApiEnvironment[];
}> {
  const [requests, collections, history, environments] = await Promise.all([
    getAllRequests(),
    getAllCollections(),
    getAllHistory(),
    getAllEnvironments(),
  ]);
  return { requests, collections, history, environments };
}