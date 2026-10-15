/**
 * Tells main about this window's panels (055 FR-024, FR-024b, research R7 and R9): the workspace
 * context when it changes, and the memory estimates for the panels that share a process, every tick.
 *
 * ══ ONLY WHILE SOMEONE IS LOOKING ══
 *
 * Estimates exist to be moved out of process nodes in the detailed hierarchy, which exists only while a
 * detail subscription does (FR-003). Reading an editor's document length or counting a preview's DOM
 * nodes for a monitor nobody has open would be cost with no reader (Principle XII), so with no
 * subscription this does not send AND does not read. Main discards a window's context when the last
 * subscription goes, so a new subscription resends it whole.
 *
 * The reporter is a plain object over injected sources: the registries it reads from are the renderer's
 * (`estimates-sources.ts`), and nothing here needs a DOM.
 */
import type { PanelEstimate, WorkspaceContext } from '@throng/ipc-contract';

export interface EstimatesReporterDeps {
  readonly reportPanels: (context: WorkspaceContext | null, estimates: readonly PanelEstimate[]) => void;
  readonly readContext: () => WorkspaceContext;
  readonly readEstimates: () => readonly PanelEstimate[];
}

export interface EstimatesReporter {
  /** A detail subscription started (`true`) or the last one ended (`false`). */
  setSubscribed(on: boolean): void;
  /** A detail frame arrived: report the estimates. */
  tick(): void;
  /** The tabs, panels or projects may have changed: report the context if it did. */
  contextChanged(): void;
}

export function createEstimatesReporter(deps: EstimatesReporterDeps): EstimatesReporter {
  let subscribed = false;
  /** What main holds for this window, serialised, to tell a change from a re-render. */
  let sent: string | null = null;

  const contextToSend = (): WorkspaceContext | null => {
    const context = deps.readContext();
    const json = JSON.stringify(context);
    if (json === sent) return null;
    sent = json;
    return context;
  };

  return {
    setSubscribed(on) {
      if (on === subscribed) return;
      subscribed = on;
      if (!on) {
        sent = null;
        return;
      }
      deps.reportPanels(contextToSend(), deps.readEstimates());
    },
    tick() {
      if (!subscribed) return;
      deps.reportPanels(contextToSend(), deps.readEstimates());
    },
    contextChanged() {
      if (!subscribed) return;
      const context = contextToSend();
      if (context !== null) deps.reportPanels(context, deps.readEstimates());
    },
  };
}
