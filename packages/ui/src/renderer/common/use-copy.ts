import { useCallback } from 'react';
import type { NoticeSubject } from '@throng/core';

import { copyToClipboard } from './clipboard-copy.js';
import { useNotify } from './notification.js';

/**
 * The renderer's binding of {@link copyToClipboard} (030 US5, FR-054/FR-055).
 *
 * One hook for every copy control outside the notice card itself — today the failure banner's, and
 * the same commands in the panel menus (FR-042c) — so a copy that fails is reported in one wording,
 * from one place, whichever surface asked for it.
 *
 * Its own module, rather than sitting beside `copyToClipboard`: `notification.tsx` calls that
 * function from inside the provider, and a hook next to it reaching back for `useNotify` would make
 * the two modules import each other at run time.
 */
export function useCopyToClipboard(): (text: string, subject: NoticeSubject) => void {
  const { notify } = useNotify();
  return useCallback(
    (text: string, subject: NoticeSubject) => {
      void copyToClipboard(text, subject, { write: window.throng?.clipboard?.write, notify });
    },
    [notify],
  );
}
