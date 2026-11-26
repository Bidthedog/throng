/**
 * 080 FR-063, FR-070 — the prompt every external link shows before throng hands it to the OS, drawn INLINE in the
 * window the link was followed in, with the common confirm dialog every other throng dialog uses.
 *
 * Main asks the window on `throng:linkPrompt:ask` with a request id and the address; this host shows the whole
 * address with Change in Preferences, Cancel (focused) and Open, and answers with the id. Esc is Cancel. The dialog
 * covers and blocks only its own window; the rest of throng stays usable.
 *
 * It carries its own provider, so it mounts anywhere: every window kind renders one (`help-every-window.test.ts`).
 */
import { useEffect, type ReactElement } from 'react';
import { ConfirmProvider, useChoose } from '../confirm-dialog.js';
import './link-prompt.css';

type Reply = 'open' | 'cancel' | 'preferences';

const CHOICES = [
  { label: 'Change in Preferences', value: 'preferences', testId: 'link-prompt-preferences' },
  { label: 'Cancel', value: 'cancel', testId: 'link-prompt-cancel' },
  { label: 'Open', value: 'open', testId: 'link-prompt-open' },
] as const;

function Asker(): null {
  const choose = useChoose();
  useEffect(
    () =>
      window.throng?.linkPrompt?.onAsk(({ id, url }) => {
        void choose({
          title: 'Open this link outside throng?',
          message: (
            <span className="link-prompt__url" data-testid="link-prompt-url">
              {url}
            </span>
          ),
          choices: CHOICES,
          initialFocusValue: 'cancel',
          testIds: { overlay: 'link-prompt-overlay', dialog: 'link-prompt' },
        }).then((value) => window.throng?.linkPrompt?.answer(id, (value ?? 'cancel') as Reply));
      }),
    [choose],
  );
  return null;
}

export function LinkPromptHost(): ReactElement {
  return (
    <ConfirmProvider>
      <Asker />
    </ConfirmProvider>
  );
}
