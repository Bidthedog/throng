import { useEffect, type ReactElement } from 'react';
import { formatGrouped } from '@throng/core';
import { useChoose } from '../confirm-dialog.js';
import { setReplaceAllChooser, type ReplaceAllChoice } from './search-store.js';

/**
 * The question Replace All asks when matches sit inside FOLDED sections (049 FR-007a, research R6).
 *
 * A confirmation, so it goes through the one confirmation model (`confirm-dialog.tsx`, 018 FR-048a) rather than
 * a dialog of its own — the same route `dirty-close-dialog.tsx` takes for its three choices. This component owns
 * the `useChoose` call because the search store is not a React module: it mounts once, beside the confirmation
 * provider, and registers itself as the store's chooser. Renders nothing.
 *
 * Text labels, because the label IS the consequence being consented to. Focus starts on "Replace and unfold" —
 * the choice that leaves the user seeing what was changed — and Escape is Cancel, the answer that loses nothing.
 */
export function ReplaceAllPrompt(): ReactElement | null {
  const choose = useChoose();
  useEffect(
    () =>
      setReplaceAllChooser(async ({ folded, total }): Promise<ReplaceAllChoice> => {
        const answer = await choose({
          title: 'Replace in folded sections',
          message: `${formatGrouped(folded)} of ${formatGrouped(total)} matches are inside folded sections.`,
          testIds: { dialog: 'replace-all-folded-dialog' },
          initialFocusValue: 'unfold',
          choices: [
            { label: 'Cancel', value: 'cancel', testId: 'replace-all-folded-cancel' },
            { label: 'Replace and keep folded', value: 'keep', testId: 'replace-all-folded-keep' },
            { label: 'Replace and unfold', value: 'unfold', testId: 'replace-all-folded-unfold' },
          ],
        });
        // A dismissal is a Cancel — never consent to rewrite text the user cannot see.
        return answer === 'keep' || answer === 'unfold' ? answer : 'cancel';
      }),
    [choose],
  );
  return null;
}
