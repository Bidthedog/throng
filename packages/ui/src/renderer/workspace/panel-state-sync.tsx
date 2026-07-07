import { useEffect, useRef } from 'react';
import type { PanelConfig, PanelKind } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { setDraft, clearDraft } from '../panel-type/panel-draft-store.js';
import type { FormState } from '../panel-type/form-state.js';

/**
 * Applies cross-window Panel STATE sync (005): a cloned Panel (same id in the
 * project and its sub-workspaces) mirrors, in real time, its type-selection FORM
 * draft and its CONFIRMED type+config. Each is applied locally only — never
 * re-broadcast — so there is no loop:
 *
 *  - **draft**  → `setDraft(broadcast:false)` updates the shared form store here.
 *  - **typed**  → `setPanelType` types the local clone (its form is replaced by the
 *                 typed body, which then attaches to the one shared session, FR-021).
 *
 * The active/selected Panel is deliberately NOT mirrored (revised 2026-07-02):
 * sub-workspace focus is fully independent of the main window's selection.
 *
 * Mounted inside a WorkspaceProvider (main window + each sub-workspace window),
 * alongside PanelRenameSync / PanelDestroySync.
 */
export function PanelStateSync(): null {
  const ws = useWorkspace();
  const wsRef = useRef(ws);
  wsRef.current = ws;
  useEffect(() => {
    const offDraft = window.throng?.panel?.onDraft?.((id, draft) =>
      setDraft(id, draft as FormState, { broadcast: false }),
    );
    const offTyped = window.throng?.panel?.onTyped?.((id, kind, config) => {
      clearDraft(id);
      wsRef.current.setPanelType(id, kind as PanelKind, config as PanelConfig);
    });
    return () => {
      offDraft?.();
      offTyped?.();
    };
  }, []);
  return null;
}
