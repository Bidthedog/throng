/**
 * #635 — Focus Mode collapses both side panes, and leaving it puts each back as it was on entry.
 * Supersedes the last line of 054 FR-074 ("side panes … are unaffected") for the side panes.
 *
 * The collapse is DERIVED, like 067 FR-058's width collapse: nothing is written to the project's pane
 * preference (067 FR-056) or to the window's own flags, so leaving Focus Mode — or quitting in it — finds
 * the stored state exactly as it was on entry. A pane the user shows (or hides again) during Focus Mode is
 * an override held here for that Focus Mode only, dropped on exit, so exit restores the ENTRY state.
 *
 * "Focus Mode" is ANYTHING maximised in the active tab: a whole panel, or a diagram (069 FR-066, which
 * supersedes this file's earlier rule that a diagram maximised on its own was a section target and left the
 * panes alone). A diagram nested inside a maximised panel is already inside its Focus Mode. Focus Mode is per
 * tab (054 FR-073), so the panes follow the active tab: a tab with nothing maximised shows them as stored,
 * and returning to the maximised tab collapses them again.
 */
import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '../state/workspace-store.js';
import { useTabInFocusMode } from '../workspace/maximise-store.js';

export type SidePane = 'projects' | 'files';

/**
 * Mounted inside the workspace provider (App renders the provider itself, so it cannot read the layout —
 * the same shape as `SidePanesBridge`): reports whether anything is maximised in the active tab.
 */
export function FocusModeBridge({ onChange }: { onChange: (active: boolean) => void }): null {
  const { layout } = useWorkspace();
  const active = useTabInFocusMode(layout?.activeTabId ?? null);
  useEffect(() => {
    onChange(active);
  }, [active, onChange]);
  return null;
}

export interface FocusModePanes {
  /** Whether the active tab is in Focus Mode. */
  readonly active: boolean;
  /** Whether `pane` shows, given what it would show outside Focus Mode (`base`). */
  readonly shown: (pane: SidePane, base: boolean) => boolean;
  /** Show or hide `pane` for the rest of this Focus Mode. Never written to any preference. */
  readonly set: (pane: SidePane, shown: boolean) => void;
}

type Overrides = Readonly<Partial<Record<SidePane, boolean>>>;

const NONE: Overrides = Object.freeze({});

export function useFocusModePanes(active: boolean): FocusModePanes {
  const [overrides, setOverrides] = useState<Overrides>(NONE);
  const [seen, setSeen] = useState(active);
  // Every entry starts with both panes collapsed, and every exit drops what was shown during it. Reset
  // while rendering (not in an effect), so the first frame after a change never shows a stale override.
  if (seen !== active) {
    setSeen(active);
    setOverrides(NONE);
  }
  const current = seen === active ? overrides : NONE;
  const shown = useCallback(
    (pane: SidePane, base: boolean): boolean => (active ? (current[pane] ?? false) : base),
    [active, current],
  );
  const set = useCallback((pane: SidePane, next: boolean): void => {
    setOverrides((prev) => (prev[pane] === next ? prev : { ...prev, [pane]: next }));
  }, []);
  return { active, shown, set };
}
