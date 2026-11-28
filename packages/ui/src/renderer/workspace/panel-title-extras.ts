/**
 * What a panel's body hands its TITLE menu (v1 review, #732).
 *
 * The maintainer's rule: the title menu holds the panel, its file and its link to other panels; the body menu holds
 * what acts on the content under the pointer. Several rows that moved to the title read state only the body holds (an
 * editor's language and encoding, a terminal's toggles, the project root a preview's Copy Path is relative to). The
 * body registers a reader here, and `panel-placeholder.tsx` calls it when the title menu opens, so every row states
 * the panel as it is at that moment.
 *
 * Non-reactive by design, like `editor-actions.ts`: a reader is called once per menu open.
 */
import type { PathForms } from '../common/copy-path-menu.js';
import type { EditorFormatMenuArgs } from '../editor/content-menu.js';
import type { TerminalMenuToggle } from '../terminal/terminal-content-menu.js';

/** A terminal's title-menu state: its per-panel toggles and, while its start failed, the banner's two commands. */
export interface TerminalTitleExtras {
  /** 076 FR-005 — the status-bar toggles, in status-bar order, each with the chord bound to it now. */
  toggles: readonly TerminalMenuToggle[];
  /** Whether a start failure is live: the only state the failure rows mean anything in. */
  startFailure: boolean;
  copyDetails: () => void;
  clearPanelType: () => void;
}

export interface PanelTitleExtras {
  /** 074 FR-028, FR-068a — the panel's file in the File Explorer's four forms; absent or `null` outside the project. */
  copyPath?: PathForms | null;
  /** An editor's format rows. */
  editorFormat?: EditorFormatMenuArgs;
  terminal?: TerminalTitleExtras;
}

const registry = new Map<string, () => PanelTitleExtras>();

/** Register `read` for `panelId`; the returned function unregisters it, so an effect can return it directly. */
export function registerPanelTitleExtras(panelId: string, read: () => PanelTitleExtras): () => void {
  registry.set(panelId, read);
  return () => {
    if (registry.get(panelId) === read) registry.delete(panelId);
  };
}

/** The panel's extras as they stand now; an empty object when its body registered none. */
export function readPanelTitleExtras(panelId: string): PanelTitleExtras {
  return registry.get(panelId)?.() ?? {};
}
