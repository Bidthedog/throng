import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  type AppSettings,
  type Keybindings,
} from '@throng/core';

/**
 * The configuration as it was when the preferences window opened (015, FR-016).
 *
 * "Revert All Preferences" has always had this — it is feature 007's session undo, and it keeps
 * an on-entry snapshot in the window's root component. The per-item revert affordance is that
 * same undo at row granularity, so it needs the same snapshot; publishing it here is what stops
 * each tab from growing its own second copy that drifts from the first.
 *
 * Parsed, not raw: the snapshot is stored as JSON text (that is the shape the write path wants),
 * but a row comparing one leaf against its on-entry value wants a document, not a string.
 */
export interface OnEntryConfig {
  settings: AppSettings;
  keybindings: Keybindings;
}

const OnEntryContext = createContext<OnEntryConfig>({
  settings: DEFAULT_APP_SETTINGS,
  keybindings: DEFAULT_KEYBINDINGS,
});

export function OnEntryProvider({
  value,
  children,
}: {
  value: OnEntryConfig;
  children: ReactNode;
}): ReactElement {
  return <OnEntryContext.Provider value={value}>{children}</OnEntryContext.Provider>;
}

/** The settings and key bindings this preferences session started with. */
export function useOnEntry(): OnEntryConfig {
  return useContext(OnEntryContext);
}
