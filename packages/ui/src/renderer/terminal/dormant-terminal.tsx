import type { ReactElement } from 'react';
import type { Panel } from '@throng/core';
import { useAppSettings } from '../config/config-store.js';
import { usePanelDisplayNames } from '../workspace/use-panel-display-names.js';

/**
 * 039 FR-023 (#293) — a terminal Panel that has not been reloaded.
 *
 * Reached when `terminals.reloadMode` is `'manual'` and the project has been opened without
 * starting its terminals. Rendered from `panel-body.tsx` INSTEAD OF `TerminalPanel`, never
 * alongside it: `TerminalPanel` calls `useTerminal()` unconditionally, so not mounting it is what
 * makes FR-026 (no PTY, no shell, no `conhost`) true by construction rather than by gating.
 *
 * ══ WHAT THIS IS NOT ══
 *
 * It is NOT a failure. FR-029 is explicit, and the repository's "one condition, one notice" rule
 * makes the distinction load-bearing rather than cosmetic: dormancy must not reach the notice,
 * banner or notification surfaces, because a state the user deliberately chose is not something to
 * report to them. So there is no ⚠, no error styling, and no `panel-failure-notice` — and the
 * styling follows: no card, no border, nothing from the warning palette. It reads as *waiting*.
 *
 * It is also NOT the empty-panel form. An untyped Panel asks "what should this be?"; a dormant one
 * already knows what it is and is only waiting to be told when. It keeps its name, its type and its
 * place in the layout throughout (FR-027).
 *
 * The wording deliberately echoes the preference that caused it ("Reload terminals when a project
 * opens: Manual"), so a user who wonders why nothing started can find the setting from the panel.
 *
 * ══ IT TAKES THE PANEL, NOT A NAME — AND THAT IS #294 ══
 *
 * This used to take a `panelName: string`, and `panel-body.tsx` passed `panel.title` — the RAW
 * STORED title. So a terminal panel the user had never renamed showed "Panel 3" in its body while
 * its own header, one line above, said "Command Prompt": two surfaces naming one panel differently,
 * a few pixels apart.
 *
 * `panelDisplayTitle` has been the one place a panel's name is decided since #218, and #294 was
 * that same rule "starved of its inputs" in the tab popover — which is why
 * {@link usePanelDisplayNames} exists at all. Taking the Panel and resolving here removes the
 * starved call site rather than correcting the string it produced, so the shape cannot come back.
 *
 * Bounded by `tabs.maxNameLength` for the same reason the panel header is: the two must agree
 * character for character, and a shell's window title can be arbitrarily long.
 */
export function DormantTerminal({
  panel,
  onReload,
}: {
  /** The dormant Panel itself, so the placeholder names it exactly as every other surface does. */
  panel: Panel;
  onReload: () => void;
}): ReactElement {
  const maxNameLength = useAppSettings().tabs.maxNameLength;
  // The SAME resolver the tab popover uses, given the same live sources. A dormant panel has no
  // shell, so ordinarily there is no window title and the flavour label names it — but the title
  // store is keyed by panel id and outlives an unmount, so a panel that HELD a terminal and was
  // later left dormant still has one, and it must win here exactly as it does in the header.
  const [{ name }] = usePanelDisplayNames([panel], maxNameLength);

  return (
    <div
      className="panel-box__placeholder terminal-dormant"
      data-testid={`terminal-dormant-${panel.id}`}
    >
      <span className="terminal-dormant__name" data-testid="terminal-dormant-name">
        {name}
      </span>
      <span className="terminal-dormant__detail">
        Not reloaded. Terminals start on demand while “Reload terminals when a project opens” is set
        to Manual.
      </span>
      <button
        type="button"
        className="terminal-dormant__reload"
        data-testid="terminal-dormant-reload"
        onClick={onReload}
      >
        Reload
      </button>
    </div>
  );
}
