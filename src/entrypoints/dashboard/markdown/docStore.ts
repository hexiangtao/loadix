/**
 * Document workspace storage: an IndexedDB-backed store for Markdown
 * documents and folders, plus the one-time migration of the legacy
 * single-document localStorage entry.
 *
 * Deliberately dependency-free (raw IndexedDB, no `idb` wrapper) — the surface
 * is small and promisified, and this keeps the module self-contained.
 */

export interface MarkdownDoc {
  id: string;
  /** Manual name override; '' means "derive from the first heading". */
  title: string;
  folderId: string | null;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface MarkdownFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

const DB_NAME = 'loadix-markdown';
const DB_VERSION = 1;
const MIGRATED_FLAG = 'loadix-docs:migrated-v1';
const LEGACY_INPUT_KEY = 'loadix-tool:markdown.input';

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
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
    });
  }
  return dbPromise;
}

async function getAll<T>(store: string): Promise<T[]> {
  const db = await open();
  return req(db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<T[]>);
}

async function getOne<T>(store: string, key: string): Promise<T | undefined> {
  const db = await open();
  return req(db.transaction(store, 'readonly').objectStore(store).get(key) as IDBRequest<T>);
}

async function putOne(store: string, value: unknown): Promise<void> {
  const db = await open();
  await req(db.transaction(store, 'readwrite').objectStore(store).put(value));
}

async function deleteOne(store: string, key: string): Promise<void> {
  const db = await open();
  await req(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

/** Collision-safe id: crypto UUID when available, else timestamp + random. */
export function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Document title extracted from content: the first H1 when there is one,
 * otherwise the first heading of any level, otherwise ''.
 */
export function firstHeading(content: string): string {
  const h1 = /^#\s+(.+?)\s*$/m.exec(content);
  if (h1) return h1[1]!.trim();
  const any = /^#{1,6}\s+(.+?)\s*$/m.exec(content);
  return any?.[1]?.trim() ?? '';
}

/**
 * The title shown in the document list: the manual name wins, otherwise the
 * first heading, otherwise the fallback (typically a localized "Untitled").
 */
export function docDisplayTitle(doc: Pick<MarkdownDoc, 'title' | 'content'>, fallback: string): string {
  return doc.title.trim() || firstHeading(doc.content) || fallback;
}

/* ——— Documents ——— */

export async function getAllDocs(): Promise<MarkdownDoc[]> {
  return getAll<MarkdownDoc>('docs');
}

export async function getDoc(id: string): Promise<MarkdownDoc | undefined> {
  return getOne<MarkdownDoc>('docs', id);
}

export async function createDoc(input: { title?: string; folderId?: string | null; content?: string } = {}): Promise<MarkdownDoc> {
  const now = Date.now();
  const doc: MarkdownDoc = {
    id: uid(),
    title: input.title ?? '',
    folderId: input.folderId ?? null,
    content: input.content ?? '',
    createdAt: now,
    updatedAt: now,
  };
  await putOne('docs', doc);
  return doc;
}

export async function saveDoc(doc: MarkdownDoc): Promise<void> {
  await putOne('docs', doc);
}

/** Updates title/folderId (and bumps updatedAt) without touching content. */
export async function patchDocMeta(
  id: string,
  patch: Partial<Pick<MarkdownDoc, 'title' | 'folderId'>>,
): Promise<MarkdownDoc | null> {
  const db = await open();
  const tx = db.transaction('docs', 'readwrite');
  const store = tx.objectStore('docs');
  const doc = await req(store.get(id) as IDBRequest<MarkdownDoc | undefined>);
  if (!doc) return null;
  const updated: MarkdownDoc = { ...doc, ...patch, updatedAt: Date.now() };
  await req(store.put(updated));
  return updated;
}

export async function deleteDoc(id: string): Promise<void> {
  await deleteOne('docs', id);
}

/* ——— Folders ——— */

export async function getAllFolders(): Promise<MarkdownFolder[]> {
  return getAll<MarkdownFolder>('folders');
}

export async function createFolder(name: string): Promise<MarkdownFolder> {
  const folder: MarkdownFolder = { id: uid(), name, parentId: null, createdAt: Date.now() };
  await putOne('folders', folder);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<MarkdownFolder | null> {
  const db = await open();
  const tx = db.transaction('folders', 'readwrite');
  const store = tx.objectStore('folders');
  const folder = await req(store.get(id) as IDBRequest<MarkdownFolder | undefined>);
  if (!folder) return null;
  const updated = { ...folder, name };
  await req(store.put(updated));
  return updated;
}

/** Deletes the folder and moves its documents back to the root. */
export async function deleteFolder(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(['docs', 'folders'], 'readwrite');
  await req(tx.objectStore('folders').delete(id));
  const docs = await req(tx.objectStore('docs').getAll() as IDBRequest<MarkdownDoc[]>);
  for (const doc of docs) {
    if (doc.folderId === id) await req(tx.objectStore('docs').put({ ...doc, folderId: null, updatedAt: Date.now() }));
  }
}

/* ——— One-time migration of the legacy single-document storage ——— */

/**
 * The pre-workspace build kept exactly one document in localStorage under
 * `loadix-tool:markdown.input`. On first run with the new store, that content
 * becomes a real document; afterwards the key is removed and a flag prevents
 * re-running.
 */
export async function migrateLegacyDoc(): Promise<MarkdownDoc | null> {
  try {
    if (localStorage.getItem(MIGRATED_FLAG)) return null;
    const raw = localStorage.getItem(LEGACY_INPUT_KEY);
    let content = '';
    if (raw != null) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed === 'string') content = parsed;
      } catch {
        content = raw; // tolerate plain (un-JSON'd) values
      }
    }
    localStorage.setItem(MIGRATED_FLAG, '1');
    if (content.trim()) {
      localStorage.removeItem(LEGACY_INPUT_KEY);
      return createDoc({ content });
    }
    return null;
  } catch {
    return null; // storage unavailable — the workspace still works, just empty
  }
}

/** Loads everything the workspace needs, running the legacy migration first. */
export async function loadWorkspace(): Promise<{ docs: MarkdownDoc[]; folders: MarkdownFolder[] }> {
  const migrated = await migrateLegacyDoc();
  const [docs, folders] = await Promise.all([getAllDocs(), getAllFolders()]);
  if (migrated) docs.unshift(migrated);
  return { docs, folders };
}