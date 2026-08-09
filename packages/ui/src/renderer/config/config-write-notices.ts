import { useEffect } from 'react';
import type { ConfigDocId } from '@throng/core';
import { onConfigWriteFailed } from './write-config.js';
import { useNotify } from '../common/notification.js';

/**
 * Turn a config write that could not land into a notice the user actually sees (#102).
 *
 * ══ WHY ONE SUBSCRIBER AND NOT SEVEN CALL SITES ══
 *
 * #99 made `writeConfig` return a truthful outcome, and every preferences caller then discarded it —
 * so the failure mode moved from "we lied and lost your edit" to "we know it failed and do not
 * mention it". Fixing that per caller was tried and is half-done: the settings tab's discrete
 * controls report, the reset path reports, and the JSON tab, the keybindings tab, the themes tab and
 * revert-all still do not.
 *
 * It could not have been finished that way. Every text and number edit fires through
 * `scheduleWrite`, whose timer does `void writeConfig(id, json)` — no caller holds that promise, and
 * the module owns the registry precisely so an orphaned write still settles after its component has
 * gone. There is nowhere at the call site left to put a `.then`.
 *
 * So this subscribes once, to the chokepoint every write already passes through. A writer added
 * tomorrow is covered without its author knowing this exists, which is the only version of this that
 * stays true.
 *
 * ══ WHY IT REUSES `prefs-notice` ══
 *
 * The reset path has always reported failures under that id, and `notify` replaces a live notice
 * carrying the same one. So a control that commits as you type reports ONE failure rather than one
 * per keystroke, and a call site with a better message than this one — the settings tab names the
 * individual setting — simply lands afterwards and wins. Two reporters, one notice, the more
 * specific wording surviving.
 */
export function useConfigWriteFailureNotices(): void {
  const { notify } = useNotify();

  useEffect(
    () =>
      onConfigWriteFailed((id) => {
        notify({
          // An error PERSISTS until dismissed. A preference that did not save is exactly the kind of
          // thing a user must not be allowed to miss by looking away for five seconds.
          severity: 'error',
          message: `Saving ${describe(id)} failed. Nothing was changed.`,
          testId: 'prefs-notice',
        });
      }),
    [notify],
  );
}

/**
 * The document, as the user would name it.
 *
 * Deliberately not the raw `kind` — "Saving settings failed" is a sentence; "Saving settings-doc
 * failed" is a field name that escaped. A theme is named, because a user with several themes needs
 * to know which one did not save (029 FR-017 makes the same argument about folders).
 */
function describe(id: ConfigDocId): string {
  switch (id.kind) {
    case 'settings':
      return 'your settings';
    case 'keybindings':
      return 'your key bindings';
    case 'theme':
      return `the theme "${id.name}"`;
  }
}
