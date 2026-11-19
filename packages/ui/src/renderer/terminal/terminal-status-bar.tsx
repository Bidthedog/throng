import type { ReactElement } from 'react';
import { terminalToggleTitle, type IconKey, type TerminalToggleId } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { LinkTargetReadout } from '../common/link-target-readout.js';
import { useTerminalLinkReadout } from './terminal-link-readout-store.js';

/**
 * The terminal's per-panel status bar (024 US1, #152) — a NEW surface; terminals had none.
 *
 * Left: the shell FLAVOUR label — a real, terminal-specific status, not an empty row (spec 024, analyze-pass
 * decision / FR-001) — which the header (title/cwd) does not duplicate, then the hovered link's target (045
 * FR-167, round four), which `useTerminalLinkReadout` reads from the store `use-terminal.ts` writes on every
 * hover and leave. Visibility is preference-controlled by the caller (`terminals.showStatusBar`, FR-001b).
 *
 * Right (076 FR-001): the panel's toggles, in the order `TERMINAL_PANEL_TOGGLES` declares — Remember the last
 * running command, Reopen in the last directory, Terminal notifications. Each is an icon control from the
 * theme's icon set, pressed while on, named with its state (FR-002). The row never shrinks: under width pressure
 * the link readout gives way first, then the flavour label (FR-007). Every toggle is also a checkable item in the
 * terminal's content menu, so hiding this bar strands none of them (FR-005). 024 FR-001's prohibition on a
 * wrap toggle stands: 076 dropped terminal word wrap (#169) at clarification.
 */
export interface TerminalStatusToggle {
  id: TerminalToggleId;
  label: string;
  icon: IconKey;
  /** The resolved value: the panel's own, else the preference (076 FR-003). */
  on: boolean;
  /** The chord its command is bound to, when one is. */
  chord?: string;
  onToggle: () => void;
}

export interface TerminalStatusBarProps {
  panelId: string;
  /** The shell flavour's display label (e.g. "PowerShell", "Git Bash"). */
  flavourLabel: string;
  /** 076 — the per-panel toggles, in display order. Absent draws none. */
  toggles?: readonly TerminalStatusToggle[];
}

export function TerminalStatusBar({ panelId, flavourLabel, toggles = [] }: TerminalStatusBarProps): ReactElement {
  const linkReadout = useTerminalLinkReadout(panelId);
  return (
    <div className="terminal-status-bar" data-testid={`terminal-status-bar-${panelId}`}>
      <span className="terminal-status-bar__flavour">{flavourLabel}</span>
      <LinkTargetReadout testId={`terminal-status-link-readout-${panelId}`} target={linkReadout} />
      {toggles.length > 0 && (
        <div className="terminal-status-bar__toggles">
          {toggles.map((t) => {
            const name = terminalToggleTitle(t.label, t.on, t.chord);
            return (
              <IconButton
                key={t.id}
                token={t.icon}
                className="terminal-status-bar__toggle"
                testId={`terminal-toggle-${t.id}-${panelId}`}
                title={name}
                ariaLabel={name}
                ariaPressed={t.on}
                onClick={() => t.onToggle()}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
