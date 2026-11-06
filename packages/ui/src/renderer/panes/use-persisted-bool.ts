import { useEffect, useState } from 'react';
import { logExpected } from '@throng/core';

/**
 * A boolean persisted to localStorage. Bridges pane-visibility persistence until
 * the user-scoped AppSettings config store + hot-reload (T033/T070) replace it;
 * mirrors how `useResize` already persists pane sizes (FR-008).
 */
export function usePersistedBool(
  key: string,
  initial: boolean,
): { value: boolean; toggle: () => void; set: (v: boolean) => void } {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : raw === 'true';
    } catch (error) {
      logExpected('use-persisted-bool: read a pane flag', 'localStorage may be unavailable; the default stands', error);
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, String(value));
    } catch (error) {
      /* storage unavailable — keep the in-memory value */
      logExpected('use-persisted-bool: persist a pane flag', 'localStorage may be full or unavailable; the in-memory value stands', error);
    }
  }, [key, value]);
  return { value, toggle: () => setValue((v) => !v), set: setValue };
}
