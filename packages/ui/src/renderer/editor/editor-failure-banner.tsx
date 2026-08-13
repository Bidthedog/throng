import { useCallback, type ReactElement } from 'react';
import { PanelFailureBanner } from '../common/panel-failure-banner.js';
import { useConfirm } from '../confirm-dialog.js';
import { useWorkspace } from '../state/workspace-store.js';
import { clearEditorPanelType } from './clear-editor-panel-type.js';
import { getEditorActions } from './editor-actions.js';
import { useEditorFailure } from './editor-failure.js';
import { useEditorState } from './editor-state.js';

/**
 * "This is not your file" — the standing statement an editor makes while its path cannot be read
 * (027 / #161 FR-011), now drawn by the banner every panel type shares (030 FR-039).
 *
 * ══ WHAT THIS FILE IS, AFTER 030 ══
 *
 * An ADAPTER, and nothing else. It replaces `unloadable-banner.tsx`, which carried its own markup,
 * its own retry state and its own stylesheet — one of the two designs 030 US4 exists to collapse.
 * What is left here is the three things only the editor knows: the condition (`unloadable`), the
 * sentences in the editor's own terms — its headline and the one below — and what Try again and
 * Clear panel type MEAN for a document.
 * (What *Copy details* means is not among them — the banner copies its own text, from facts this
 * adapter merely states, which is why US5 added no third callback here.) It deliberately renders no
 * markup of its own; a third panel type gets the same banner by writing a file this small.
 *
 * ══ THE ISSUE THIS STILL ANSWERS ══
 *
 * #161 reports a stranded editor as coming up EMPTY. It is worse than that: when a recovery snapshot
 * survives, the panel comes up holding the text the file used to have and looks entirely ordinary,
 * over a path throng could not open — and a Ctrl+S would have written that remembered text back.
 * So the banner is not decoration on top of auto-recovery; it is the load-bearing half, and it NAMES
 * the path, because the whole class of cause is a path that moved and knowing which one is what
 * tells the user what to put back.
 *
 * The one-shot "cannot open file" dialog (FR-100) is a different affordance and is untouched: it
 * fires once, when a tab is opened, and it is dismissible. This states a CONDITION, so it is not
 * dismissible — it goes when the condition does, whether by auto-recovery noticing the path came
 * back or by the user pressing ↻.
 */

/**
 * 026 `contracts/editor-unloadable.md` P3 — WHAT IS ON SCREEN IS NOT THE FILE.
 *
 * A shipped requirement, and the one thing this panel type says that no other does. It survived the
 * 030 migration only because a review caught it going: the new banner renders headline + path +
 * pointer, and this sentence had no slot, so it was deleted with `unloadable-banner.tsx` and no test
 * noticed (`editor-stranded-recovery.e2e.ts` and `editor-stranded-restart.e2e.ts` both asserted
 * visibility and the path, which is exactly what remained).
 *
 * ══ WHY IT IS NOT MERELY WORDING ══
 *
 * `unloadable` guards NO save path in the renderer — 026 P6's save-while-unloadable confirmation is
 * not implemented here. Until it is, this sentence is the only thing in the panel warning that
 * Ctrl+S will write a remembered buffer back over a path throng could not read. That is the same
 * scenario FR-040a gives as its reason for keeping the path visible, and half the reason is not the
 * requirement.
 *
 * Kept VERBATIM from the banner it replaced. "Reload it now" still names a real command — *Reload
 * from disk*, in this panel's own menu (026 P7) — and it is the retry the banner's ↻ runs.
 */
const NOT_THE_FILE =
  'What is shown here is not the file. Restore the path and it reloads by itself, or reload it now.';
export function EditorFailureBanner({ panelId }: { panelId: string }): ReactElement | null {
  const state = useEditorState(panelId);
  // The headline, subject and detail — shared with the panel menu's copy of these commands so the
  // two surfaces cannot disagree about what this failure is (030 FR-042c/FR-052).
  const failure = useEditorFailure(panelId);
  const ws = useWorkspace();
  const confirm = useConfirm();

  const onRetry = useCallback(
    async (): Promise<boolean> => (await getEditorActions(panelId)?.reloadFromDisk()) ?? false,
    [panelId],
  );
  const onCancel = useCallback((): void => {
    void clearEditorPanelType(panelId, {
      dirty: state?.dirty ?? false,
      name: state?.displayName ?? 'This document',
      confirm,
      clearPanelType: ws.clearPanelType,
    });
  }, [panelId, state?.dirty, state?.displayName, confirm, ws]);

  if (!failure) return null;

  return (
    <PanelFailureBanner
      panelId={panelId}
      headline={failure.headline}
      note={NOT_THE_FILE}
      subject={failure.subject}
      detail={failure.detail}
      onRetry={onRetry}
      onCancel={onCancel}
    />
  );
}
