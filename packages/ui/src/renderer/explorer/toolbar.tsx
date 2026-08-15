/**
 * Explorer toolbar (004, T026, FR-031/032) — themed icon buttons above the tree.
 * Expand opens the next collapsed level relative to the selection; Collapse all
 * resets to the root.
 *
 * ══ 033 (#219) — WHY THIS COMPONENT RENDERS WITH NO PROJECT OPEN ══
 *
 * FR-018c requires the Quick Open control to be **drawn and disabled** when no project is open —
 * temporarily unavailable, not meaningless, the same judgement the project-settings cog already
 * makes. It could not be, where this toolbar used to live: it rendered inside `FileTree`, and
 * `panes/file-explorer-pane.tsx` renders `FileTree` only when a project is active, so with no
 * project there was no toolbar at all to draw a disabled button on.
 *
 * So the pane now renders this toolbar in **both** of its states, and every tree action is optional:
 * a handler that is absent is an action with nothing to act on, and its control is disabled. That is
 * why the props are `?` — not because a caller may forget them.
 */
import { type ReactElement } from 'react';
import { firstBinding, type Keybindings } from '@throng/core';
import { Icon } from '../common/icon.js';
import { requestQuickOpen } from '../navigate/navigation-store.js';

export function ExplorerToolbar({
  onExpand,
  onCollapseAll,
  onNewFolder,
  onDelete,
  keybindings,
  quickOpenEnabled,
}: {
  onExpand?: () => void;
  onCollapseAll?: () => void;
  onNewFolder?: () => void;
  onDelete?: () => void;
  /** Read LIVE, so a rebound chord shows in the hover title with no restart (V3, AS-17). */
  keybindings: Keybindings;
  /** V4 — false with no project open: the control is drawn, and disabled. */
  quickOpenEnabled: boolean;
}): ReactElement {
  const chord = firstBinding(keybindings, 'navigate.quickOpen');
  return (
    <div className="explorer-toolbar" data-testid="explorer-toolbar">
      <button
        type="button"
        className="explorer-toolbar__btn"
        title="Expand (next level of the selection)"
        aria-label="Expand"
        disabled={onExpand === undefined}
        onClick={onExpand}
      >
        <Icon token="expandAll" />
      </button>
      <button
        type="button"
        className="explorer-toolbar__btn"
        title="Collapse all"
        aria-label="Collapse all"
        disabled={onCollapseAll === undefined}
        onClick={onCollapseAll}
      >
        <Icon token="collapseAll" />
      </button>
      {/*
       * V1–V3 — the VISIBLE route to Quick Open, beside Expand and Collapse all.
       *
       * It opens the same modal the chord opens, through the same registration (`requestQuickOpen`),
       * so there is one opener rather than two that must be kept in step. The hover title names the
       * action AND the command's current chord, read live from the bindings.
       */}
      <button
        type="button"
        className="explorer-toolbar__btn"
        title={
          quickOpenEnabled
            ? `Quick Open${chord === undefined ? '' : ` (${chord})`}`
            : 'Quick Open — no project is open'
        }
        /*
         * The accessible NAME is the bare action, and the chord lives in the title alone.
         *
         * They are deliberately not the same string here, where every other control lets
         * `IconButton` make them one: V3 puts a LIVE chord in the title, so it changes the moment
         * the user rebinds the command — and a locator built on the accessible name would then
         * break on the very rebind AS-17 exists to test. `helpers/navigation.ts` addresses this
         * button by name for exactly that reason.
         */
        aria-label="Quick Open"
        disabled={!quickOpenEnabled}
        onClick={() => {
          requestQuickOpen();
        }}
      >
        <Icon token="quickOpen" />
      </button>
      <button
        type="button"
        className="explorer-toolbar__btn"
        title="New folder"
        aria-label="New folder"
        disabled={onNewFolder === undefined}
        onClick={onNewFolder}
      >
        <Icon token="newFolder" />
      </button>
      <button
        type="button"
        className="explorer-toolbar__btn explorer-toolbar__btn--danger"
        title="Delete"
        aria-label="Delete"
        disabled={onDelete === undefined}
        onClick={onDelete}
      >
        <Icon token="destroy" />
      </button>
    </div>
  );
}
