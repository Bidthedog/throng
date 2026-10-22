/**
 * The different-copy notice (058 FR-018, research D5a; contracts/instance-lock.md), mounted once in
 * the main window by `app.tsx`.
 *
 * Starting a different copy of throng while this one runs opens nothing: main's instance guard brings
 * this window forward and pushes the facts here. The notice says which copy is running and that it
 * must be closed first — what is wrong, not what the user may not do.
 *
 * ══ ONE CONDITION, ONE NOTICE ══
 *
 * A second different-copy launch while the notice is up is the same condition again, so it makes the
 * one card louder (the window notice area's flash) and moves its `launchedRoot` to the latest launch,
 * rather than stacking a second card. It lives in the window's own notice area — the surface every
 * other notice uses, with its themed dismiss control — so there is no second idiom to keep in step.
 *
 * ══ IT STAYS UNTIL DISMISSED ══
 *
 * The display is pinned to `dismiss` rather than read from the user's per-severity mode: FR-018 says
 * the running instance MUST show it, and a launch that visibly did nothing — because the severity's
 * mode was *never*, or a timer took the card before it was read — is exactly the confusion it exists
 * to end. Dismissing it is one click.
 */
import { useEffect, useRef } from 'react';
import { differentCopyNoticeText, type DifferentCopyNotice as Payload } from '@throng/core';
import { useNotify, type NoticeInput } from './notification.js';

const TEST_ID = 'different-copy-notice';
const UNTIL_DISMISSED = { mode: 'dismiss', timeoutMs: 30_000 } as const;

function noticeInput(payload: Payload): NoticeInput {
  return {
    severity: 'info',
    subject: { kind: 'none' },
    message: differentCopyNoticeText(payload),
    testId: TEST_ID,
    display: UNTIL_DISMISSED,
  };
}

export function DifferentCopyNotice(): null {
  const { notify, update } = useNotify();
  const liveId = useRef('');

  useEffect(() => {
    const instance = window.throng?.instance;
    if (!instance) return undefined;
    const off = instance.onDifferentCopy((payload) => {
      const input = noticeInput(payload);
      // Already showing: bring its text up to date, then raise the identical notice — which the
      // notice area answers by flashing the card it has, not by adding one.
      if (liveId.current && update(liveId.current, { message: input.message })) {
        notify(input);
        return;
      }
      liveId.current = notify(input);
    });
    // Main holds a launch that arrived before this window could hear it, and delivers it now.
    instance.differentCopyReady();
    return off;
  }, [notify, update]);

  return null;
}
