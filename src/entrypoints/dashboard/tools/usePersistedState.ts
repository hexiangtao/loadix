import { useEffect, useState } from 'react';

const PREFIX = 'loadix-tool:';

/**
 * Local, auto-persisted state for tool inputs. Survives refresh / reopen so a
 * developer's half-finished input is never lost. Uses localStorage directly,
 * which works identically in the extension dashboard page and the web build.
 */
export function usePersistedState<T>(key: string, initial: T): [T, (v: T) => void] {
  const fullKey = PREFIX + key;
  const [value, setValue] = useState<T>(() => {
    // An explicit initial payload (e.g. routed from the smart-paste box)
    // always wins over the persisted value.
    if (initial) {
      try {
        localStorage.setItem(fullKey, JSON.stringify(initial));
      } catch {
        /* ignore */
      }
      return initial;
    }
    try {
      const raw = localStorage.getItem(fullKey);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(fullKey, JSON.stringify(value));
    } catch {
      /* storage full or unavailable — ignore, tool still works in-memory */
    }
  }, [fullKey, value]);

  return [value, setValue];
}
