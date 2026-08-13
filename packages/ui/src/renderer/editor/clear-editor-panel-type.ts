import type { ConfirmOptions } from '../confirm-dialog.js';
import { disposeEditor } from './use-editor.js';

/**
 * Clear an EDITOR panel's type — the way out of a stranded editor (030 US4 / #236, FR-043).
 *
 * ══ WHY THIS IS NEW ══
 *
 * `clearPanelType` has always existed and has always been the terminal's. `core/src/editor/
 * panel-type.ts` recorded, as a fact about the editor type, that it "never reverts to the
 * type-selection form" — so an editor whose file could not be read had exactly one exit: destroy the
 * panel, and lose its position in the split tree and the name its owner gave it. FR-043 makes the
 * banner's *Clear panel type* mean the same thing for an editor as it does for a terminal: the
 * panel survives, in place, with its title, back at the panel-type selection screen.
 *
 * ══ WHY IT DISPOSES FIRST ══
 *
 * The document lives in UI main keyed by panel id and deliberately survives a remount, so dropping
 * `kind`/`config` from the layout alone would leave the document, its dirty-file lock, its recovery
 * temp and this panel's editor state behind — an invisible editor holding a lock on a file no panel
 * shows. `disposeEditor` is the same teardown an explicit panel destroy performs; the difference is
 * only that the PANEL stays.
 *
 * ══ AND WHY IT ASKS WHEN THE BUFFER IS DIRTY ══
 *
 * The banner's condition can be reached with unsaved text in the buffer (the watcher route marks the
 * document deleted AND dirty), and that text exists nowhere else once the document is disposed.
 * Clearing is a decision about the panel, not about the work in it, so the one case where the two
 * differ is asked about rather than assumed. A clean buffer has nothing to lose and is never
 * interrupted — which is also the state the E2E drives, deliberately.
 */
export async function clearEditorPanelType(
  panelId: string,
  opts: {
    /** Whether the document holds unsaved changes. */
    dirty: boolean;
    /** What to call the document in the question, if one is asked. */
    name: string;
    confirm: (options: ConfirmOptions) => Promise<boolean>;
    /** The workspace store's `clearPanelType` — kept as an argument so this stays testable. */
    clearPanelType: (panelId: string) => void;
  },
): Promise<void> {
  if (opts.dirty) {
    const ok = await opts.confirm({
      title: 'Clear panel type',
      message: `“${opts.name}” has unsaved changes. Clearing this panel's type discards them. This cannot be undone.`,
      confirmLabel: 'Clear panel type',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
  }
  disposeEditor(panelId);
  opts.clearPanelType(panelId);
}
