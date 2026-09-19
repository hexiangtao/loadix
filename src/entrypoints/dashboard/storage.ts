/**
 * Storage abstraction that falls back to `localStorage` when the
 * `chrome.storage` API is unavailable (e.g. when the dashboard is opened
 * directly in a browser tab for UI preview during development).
 */

const isChrome = typeof chrome !== 'undefined' && !!chrome.storage?.local;

export async function storageGet<T>(key: string): Promise<T | undefined> {
  if (isChrome) {
    const data = await chrome.storage.local.get(key);
    return data[key] as T | undefined;
  }
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? undefined : (JSON.parse(raw) as T);
  } catch {
    // Private browsing and embedded webviews can expose storage but reject
    // access. Storage must never prevent a page from mounting.
    return undefined;
  }
}

export async function storageSet(key: string, value: unknown): Promise<void> {
  if (isChrome) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Persistence is optional; rendering and sharing must continue when the
    // browser blocks localStorage.
  }
}

export function onStorageChange(
  key: string,
  callback: (newValue: unknown) => void,
): () => void {
  if (isChrome) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[key]) callback(changes[key].newValue);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  const listener = (e: StorageEvent) => {
    if (e.key === key) callback(e.newValue == null ? undefined : JSON.parse(e.newValue));
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
