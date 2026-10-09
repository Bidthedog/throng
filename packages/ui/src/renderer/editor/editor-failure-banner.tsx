import { useCallback, type ReactElement } from 'react';
import { collectPanels, type Panel } from '@throng/core';
import { PanelFailureBanner } from '../common/panel-failure-banner.js';
import { useConfirm } from '../confirm-dialog.js';
import { useSubWorkspaceWindow } from '../workspace/subworkspace-window-context.js';
import { useWorkspace } from '../state/workspace-store.js';
import { requestPanelDestroy } from '../workspace/panel-destroy.js';
import { clearEditorPanelType } from './clear-editor-panel-type.js';
import { getEditorActions } from './editor-actions.js';
import { NOT_THE_FILE, useEditorFailure } from './editor-failure.js';
import { useEditorState } from './editor-state.js';
import { MovedOutNotice } from './moved-out-notice.js';
import { ReplacedNotice } from './replaced-notice.js';

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
 *
 * (The second sentence, `NOT_THE_FILE`, lives in `editor-failure.ts` beside the facts the panel menu
 * copies, so the menu and this banner cannot say different things.)
 */
export function EditorFailureBanner({ panelId }: { panelId: string }): ReactElement | null {
  const state = useEditorState(panelId);
  // The headline, subject and detail — shared with the panel menu's copy of these commands so the
  // two surfaces cannot disagree about what this failure is (030 FR-042c/FR-052).
  const failure = useEditorFailure(panelId);
  const ws = useWorkspace();
  const confirm = useConfirm();
  const subWin = useSubWorkspaceWindow();
  /*
   * 044 T179 (FR-110) — whether clearing the type here ends the PANEL: `killsSession`'s rule, the one the
   * destroy routes apply. In a sub-workspace window a PROJECT-owned panel is a second view of a panel the
   * project window still holds, so its history is not this window's to purge.
   */
  const origin = (ws.layout?.tabs ?? [])
    .flatMap((tab) => collectPanels(tab.root) as Panel[])
    .find((p) => p.id === panelId)?.originProjectId;
  const endsPanel = subWin === null || origin === ws.layout?.projectId;

  const onRetry = useCallback(
    async (): Promise<boolean> => (await getEditorActions(panelId)?.reloadFromDisk()) ?? false,
    [panelId],
  );
  const onCancel = useCallback((): void => {
    void clearEditorPanelType(panelId, {
      dirty: state?.dirty ?? false,
      name: state?.displayName ?? 'This document',
      endsPanel,
      confirm,
      clearPanelType: ws.clearPanelType,
    });
  }, [panelId, state?.dirty, state?.displayName, endsPanel, confirm, ws]);

  // 050 FR-035 — a document a move took out of its project: the ONE notice, Close and Copy, no Retry. The
  // panel's own Close runs the header's flow, so a dirty one asks Save As / Discard / Cancel first.
  if (state?.movedOut) {
    return (
      <MovedOutNotice
        panelId={panelId}
        filePath={state.filePath}
        onClose={() => void requestPanelDestroy(panelId)}
      />
    );
  }

  // 052 FR-012 — a Replace landed on this dirty document's path: its own notice, with Save As and Discard.
  if (state?.replaced) return <ReplacedNotice panelId={panelId} />;

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
