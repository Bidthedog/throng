import { useCallback, type ReactElement } from 'react';
import { toDisplayPath } from '@throng/core';
import { PanelFailureBanner } from '../common/panel-failure-banner.js';
import { useConfirm } from '../confirm-dialog.js';
import { useWorkspace } from '../state/workspace-store.js';
import { clearEditorPanelType } from './clear-editor-panel-type.js';
import { getEditorActions } from './editor-actions.js';
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
 * sentence in the editor's own terms, and what Try again and Clear panel type MEAN for a document.
 * It deliberately renders no markup of its own; a third panel type gets the same banner by writing
 * a file this small.
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
export function EditorFailureBanner({ panelId }: { panelId: string }): ReactElement | null {
  const state = useEditorState(panelId);
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

  if (!state?.unloadable) return null;

  const os = window.throng?.osName ?? 'windows';
  return (
    <PanelFailureBanner
      panelId={panelId}
      headline="This file could not be read"
      detail={{ path: state.filePath ? toDisplayPath(state.filePath, os) : undefined }}
      onRetry={onRetry}
      onCancel={onCancel}
    />
  );
}
