import { useEffect, useMemo, useSyncExternalStore, type ReactElement } from 'react';
import { defaultPanelTypeRegistry, type PanelTypeContext } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import {
  selectKind,
  canConfirm,
  confirmConfig,
  type FormDeps,
} from './form-state.js';
import { EMPTY_DRAFT, getDraft, setDraft, clearDraft, subscribeDraft } from './panel-draft-store.js';
import { useFlavours } from './use-flavours.js';
import { useCapabilities } from './use-capabilities.js';
import { TerminalInputs } from './terminal-inputs.js';
import { EditorInputs } from './editor-inputs.js';
import { clearPanelExit, dismissPanelExit, useVisiblePanelExit } from '../terminal/exit-store.js';
import { markExplicitRetype } from '../terminal/explicit-retype.js';
import { useNotify } from '../common/notification.js';
import './panel-type.css';

/**
 * The Panel type-selection form (005 / US1, FR-001..006). Replaces the inert
 * "Empty Panel" body for an untyped Panel: a **Panel Type** dropdown (sourced from
 * the registry, so a new type appears with no change here — SC-010), the selected
 * type's own inputs, and Confirm / Clear. Confirm is gated by the
 * descriptor's validation (FR-005); Confirm assigns the type+config to the Panel
 * via the workspace store (it then becomes typed and this form is replaced).
 *
 * Only the type-specific inputs block is per-type; the selection / confirm / clear
 * flow is shared, so future types plug in by registering a descriptor and adding
 * their inputs component.
 */
export function PanelTypeForm({
  panelId,
  projectRoot,
  rootless = false,
}: {
  panelId: string;
  projectRoot: string | null;
  /** Sub-workspace-owned Panel: a null root is allowed (launches at home, FR-028). */
  rootless?: boolean;
}): ReactElement {
  const ws = useWorkspace();
  const flavours = useFlavours();
  const { elevated } = useCapabilities();
  const registry = defaultPanelTypeRegistry;
  const ctx = useMemo<PanelTypeContext>(
    () => ({ projectRoot, flavours, rootless }),
    [projectRoot, flavours, rootless],
  );
  const deps = useMemo<FormDeps>(() => ({ registry, ctx }), [registry, ctx]);
  // The draft lives in a cross-window store keyed by panelId, so a cloned Panel's
  // form mirrors across the project + sub-workspace windows live. Local edits
  // broadcast; the sync listener applies remote drafts with broadcast:false.
  const state = useSyncExternalStore(
    (cb) => subscribeDraft(panelId, cb),
    () => getDraft(panelId),
  );

  const types = registry.list();
  const confirmable = canConfirm(state, deps);

  const onConfirm = (): void => {
    const result = confirmConfig(state, deps);
    if (result) {
      clearPanelExit(panelId);
      clearDraft(panelId);
      // Confirm is a deliberate user action: mark the next attach for this panel as an
      // EXPLICIT re-type (008 FR-002/FR-007), so if a session is still running for this
      // panel the daemon terminates it and cold-starts the chosen flavour instead of
      // reusing the old one. Set locally BEFORE typing the panel (which mounts the
      // terminal and attaches); the mirror in other windows never runs this, so it
      // reuses the new session. Only a terminal attaches.
      if (result.kind === 'terminal') markExplicitRetype(panelId);
      ws.setPanelType(panelId, result.kind, result.config);
      // Mirror the confirmed type+config to the Panel's other views (FR-027a).
      window.throng?.panel?.notifyTyped?.(panelId, result.kind, result.config);
    }
  };

  // When a previous terminal in this Panel ended (exit/crash/launch failure), the
  // Panel reverted here; surface that as the form returns (FR-017/019/020). Read
  // reactively so dismissing the notice (011, US1) hides it immediately, and a fresh
  // exit re-shows it (recurrence, FR-003).
  const lastExit = useVisiblePanelExit(panelId);

  /*
   * 018 / FR-051 — the terminal-exit notice, through THE notification model.
   *
   * It reports as INFO rather than an error: a terminal you told to exit has not failed, and the
   * message is a courtesy telling you what the shell said on its way out. So it dismisses itself
   * after five seconds, while a real failure would persist until acknowledged. That is severity
   * doing its job — and it is the one place in this migration where the old behaviour (a strip that
   * sat there until you clicked it) was arguably wrong.
   */
  const { notify } = useNotify();
  useEffect(() => {
    if (!lastExit) return;
    notify({
      severity: 'info',
      message: lastExit.message,
      testId: `panel-exit-${panelId}`,
      testIds: { dismiss: `exit-dismiss-${panelId}` },
      onDismiss: () => dismissPanelExit(panelId),
    });
  }, [lastExit, panelId, notify]);

  return (
    <div className="panel-type-form" data-testid={`panel-type-form-${panelId}`}>
      {/* 018 / FR-051 — the last of the four copy-pasted error strips. It is the shared notification
          model now (see the effect above), and its per-panel identifiers are preserved. */}
      <label className="panel-type-form__field">
        <span>Panel Type</span>
        <select
          data-testid={`panel-type-select-${panelId}`}
          value={state.selectedKind ?? ''}
          onChange={(e) =>
            setDraft(
              panelId,
              e.target.value ? selectKind(state, e.target.value, deps) : EMPTY_DRAFT,
              { broadcast: true },
            )
          }
        >
          <option value="">Choose a type…</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {state.selectedKind === 'terminal' ? (
        <TerminalInputs
          values={state.values}
          flavours={flavours}
          elevated={elevated}
          onChange={(next) => setDraft(panelId, { ...state, values: next }, { broadcast: true })}
        />
      ) : state.selectedKind === 'editor' ? (
        <EditorInputs rootless={rootless} />
      ) : null}

      <div className="panel-type-form__actions">
        <button
          type="button"
          className="panel-type-form__clear"
          data-testid={`panel-type-clear-${panelId}`}
          onClick={() => {
            // Clear resets ONLY the form fields (011, US1) — it MUST NOT clear the
            // exit notice or any error state. Clearing the form leaves a visible
            // exit notice visible; dismissing the notice is a separate control.
            setDraft(panelId, EMPTY_DRAFT, { broadcast: true });
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className="panel-type-form__confirm"
          data-testid={`panel-type-confirm-${panelId}`}
          disabled={!confirmable}
          onClick={onConfirm}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
