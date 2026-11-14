/**
 * 067 FR-012, research D5 — the one notice for a condition throng cannot observe.
 *
 * Windows will not deliver a file drag from a program running at a lower integrity level to a window
 * running as administrator: the OS stops it before throng receives a single event, so a blocked drag
 * can never be detected. The only honest thing to do is say so, once per session, the first time the
 * tree mounts, and name the way in that does work.
 *
 * "Once per session" is the window's `sessionStorage`, not a module variable: a project switch
 * remounts the tree and must stay quiet, while a reload of the window starts a new session.
 */
import { logCaught, logExpected } from '@throng/core';
import { useEffect } from 'react';
import { useNotify } from '../common/notification.js';

const RAISED_KEY = 'throng:elevated-drop-notice';

function alreadyRaised(): boolean {
  try {
    return sessionStorage.getItem(RAISED_KEY) === '1';
  } catch (error) {
    logExpected('elevated-drop-notice: read session storage', 'with no storage the notice may repeat, which is better than never saying it', error);
    return false;
  }
}

function markRaised(): void {
  try {
    sessionStorage.setItem(RAISED_KEY, '1');
  } catch (error) {
    logExpected('elevated-drop-notice: write session storage', 'with no storage the notice may repeat, which is better than never saying it', error);
  }
}

export function useElevatedDropNotice(): void {
  const { notify } = useNotify();
  useEffect(() => {
    if (window.throng?.osName !== 'windows' || alreadyRaised()) return undefined;
    let active = true;
    void window.throng?.terminal
      ?.capabilities?.()
      .then((caps) => {
        if (!active || caps?.elevated !== true || alreadyRaised()) return;
        markRaised();
        notify({
          severity: 'info',
          message:
            'The OS blocks files dragged into throng while it runs as administrator. Paste still works: copy the files, then paste them into a folder here.',
          subject: { kind: 'none' },
          testId: 'explorer-elevated-drop',
        });
      })
      .catch((error: unknown) => logCaught('use-elevated-drop-notice: read the daemon capabilities', error));
    return () => {
      active = false;
    };
  }, [notify]);
}
