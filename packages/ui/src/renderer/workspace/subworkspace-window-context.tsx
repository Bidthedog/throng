import { createContext, useContext } from 'react';

/**
 * Identity of the sub-workspace a window is showing (US7). Present only inside a
 * detached sub-workspace window; `null` in the main window. Components that are
 * shared between the two windows (e.g. the Panel header) use it to decide
 * sub-workspace-only affordances — the dominant colour and the per-Panel
 * origin-project label — without any prop drilling.
 */
export interface SubWorkspaceWindowIdentity {
  id: string;
  name: string;
  colour: string;
}

export const SubWorkspaceWindowContext = createContext<SubWorkspaceWindowIdentity | null>(null);

/** The current sub-workspace window's identity, or `null` in the main window. */
export function useSubWorkspaceWindow(): SubWorkspaceWindowIdentity | null {
  return useContext(SubWorkspaceWindowContext);
}
