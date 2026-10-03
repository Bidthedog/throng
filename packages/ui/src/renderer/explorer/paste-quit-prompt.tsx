/**
 * Quitting throng while a paste is running or queued (050 FR-019f, R11, contracts/ui-surfaces §4).
 *
 * Main's window-close handler asks the transfer engine whether it is busy BEFORE any other close prompt;
 * if so it pushes `quitPrompt` and waits for `quitChoice`. This is the question it pushes:
 *
 *   - Wait          — leave the pastes to finish; main quits when the queue drains;
 *   - Cancel pastes — cancel them all, then ask Keep finished / Roll back (FR-019a);
 *   - dismiss       — Escape: abandon the quit, the paste keeps running.
 *
 * Dismissal is the safe default on BOTH questions: it neither cancels a paste nor closes the window, so
 * a stray key can lose nothing. Same one-dialog confirmation model as the app-close prompt it sits
 * beside (`useChoose`), with its own test ids.
 */
import { useEffect, type ReactElement } from 'react';
import { formatGrouped } from '@throng/core';
import { useChoose } from '../confirm-dialog.js';

const TEST_IDS = {
  overlay: 'quit-paste-overlay',
  dialog: 'quit-paste-dialog',
  message: 'quit-paste-message',
} as const;

export function PasteQuitPrompt(): ReactElement | null {
  const choose = useChoose();

  useEffect(() => {
    const transfer = window.throng?.transfer;
    if (!transfer) return undefined;
    return transfer.onQuitPrompt(({ running, queued }) => {
      const parts = [
        `${formatGrouped(running)} running`,
        ...(queued > 0 ? [`${formatGrouped(queued)} queued`] : []),
      ];
      void (async () => {
        const first = await choose({
          title: 'A paste is still running',
          message: `Pasting is not finished (${parts.join(', ')}). Wait for it to finish before quitting, or cancel the pastes?`,
          testIds: TEST_IDS,
          choices: [
            { label: 'Cancel pastes', value: 'cancel', testId: 'quit-cancel-pastes' },
            { label: 'Wait', value: 'wait', testId: 'quit-wait' },
          ],
          initialFocusValue: 'wait',
        });
        if (first === 'wait') {
          transfer.quitChoice('wait');
          return;
        }
        if (first !== 'cancel') {
          transfer.quitChoice('dismiss'); // Escape: the quit is abandoned, the paste runs on
          return;
        }
        // The FR-019a choice, for the pastes just cancelled. Dismissing THIS one also abandons the
        // quit: the user has not said what to do with the finished items, and guessing is the one
        // thing a question like this must not do.
        const second = await choose({
          title: 'Cancel paste?',
          message: 'Keep the items already pasted, or roll the whole paste back?',
          testIds: TEST_IDS,
          choices: [
            { label: 'Keep finished', value: 'keep', testId: 'paste-keep' },
            { label: 'Roll back', value: 'rollback', testId: 'paste-rollback' },
          ],
          initialFocusValue: 'keep',
        });
        transfer.quitChoice(second === 'keep' || second === 'rollback' ? second : 'dismiss');
      })();
    });
  }, [choose]);

  return null;
}
