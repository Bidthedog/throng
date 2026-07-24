import type { ReactElement } from 'react';

/**
 * The terminal's per-panel status bar (024 US1, #152) — a NEW surface; terminals had none.
 *
 * Built to host future per-terminal affordances (the word-wrap toggle lands here once terminal
 * horizontal scrolling exists, #169). For now it shows the shell FLAVOUR label — a real,
 * terminal-specific status, not an empty row (spec 024, analyze-pass decision / FR-001) — which the
 * header (title/cwd) does not duplicate. Visibility is preference-controlled by the caller
 * (`terminals.showStatusBar`, FR-001b).
 */
export interface TerminalStatusBarProps {
  panelId: string;
  /** The shell flavour's display label (e.g. "PowerShell", "Git Bash"). */
  flavourLabel: string;
}

export function TerminalStatusBar({ panelId, flavourLabel }: TerminalStatusBarProps): ReactElement {
  return (
    <div className="terminal-status-bar" data-testid={`terminal-status-bar-${panelId}`}>
      <span className="terminal-status-bar__flavour">{flavourLabel}</span>
    </div>
  );
}
