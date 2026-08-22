import type { ReactElement } from 'react';

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
 * report to them. So there is no ⚠, no error styling, and no `panel-failure-notice`.
 *
 * It is also NOT the empty-panel form. An untyped Panel asks "what should this be?"; a dormant one
 * already knows what it is and is only waiting to be told when. It keeps its name, its type and its
 * place in the layout throughout (FR-027).
 *
 * The wording deliberately echoes the preference that caused it ("Reload terminals when a project
 * opens: Manual"), so a user who wonders why nothing started can find the setting from the panel.
 */
export function DormantTerminal({
  panelId,
  panelName,
  onReload,
}: {
  panelId: string;
  /** The Panel's effective title, so the placeholder names the thing the user is looking at. */
  panelName: string;
  onReload: () => void;
}): ReactElement {
  return (
    <div className="panel-box__placeholder" data-testid={`terminal-dormant-${panelId}`}>
      <span data-testid="terminal-dormant-name">{panelName}</span>
      <span className="panel-box__placeholder-detail">
        Not reloaded. Terminals start on demand while “Reload terminals when a project opens” is set
        to Manual.
      </span>
      <button type="button" data-testid="terminal-dormant-reload" onClick={onReload}>
        Reload
      </button>
    </div>
  );
}
