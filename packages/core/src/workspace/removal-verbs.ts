/**
 * Which removal verb a Panel's own controls wear (011 FR-030/FR-031), as one pure rule.
 *
 * > A Panel is **Closed** when removing it dismisses a VIEW and leaves the thing itself running;
 * > it is **Destroyed** when removing it takes the thing and everything it owns, terminating any
 * > process those things host.
 *
 * For a Panel that is exactly one condition: **is this a mirror, or is this the original?** Inside a
 * sub-workspace, a Panel backed by a real project is a mirrored view — removing it here leaves this
 * sub-workspace only, and the project keeps the Panel and its running terminal. That is a Close.
 * A Panel the sub-workspace itself owns has no project behind it and no other copy anywhere, and
 * every Panel in the main window is likewise the original. Both are a Destroy.
 *
 * ── WHY THIS IS A MODULE AND NOT A TERNARY ──
 *
 * It was a ternary, inline in `panel-placeholder.tsx`, rendered straight into a `title` attribute.
 * The consequence was recorded by the E2E test that had to prove it: with no seam below the
 * component, the only way to ask "which verb does a project-owned panel in the MAIN window show?"
 * was to launch Electron, open a project, find the header's × and read its tooltip. Three of the
 * four combinations below were never asserted at all, because three more launches was not a price
 * anyone would pay for a two-branch condition.
 *
 * The rule is pure — two booleans in, one of two strings out — so the launch was never buying
 * anything except reach.
 */

/** The two verbs a Panel's removal controls may use. The other two (FR-030) belong to other targets:
 *  **Remove** unregisters a project, **Delete** destroys something on disk. Neither can apply to a
 *  Panel, so neither is representable here. */
export type PanelRemovalVerb = 'Close' | 'Destroy';

/** What the caller knows about where a Panel is and what stands behind it. */
export interface PanelRemovalContext {
  /** Is this window a sub-workspace? False for the main window. */
  inSubWorkspace: boolean;
  /**
   * Does a real project stand behind this Panel — i.e. was its origin project resolved in the
   * projects list? A sub-workspace's own Panel has none.
   */
  hasOriginProject: boolean;
}

/**
 * The verb for a Panel's own removal controls: its header ×, that button's tooltip and
 * `aria-label`, its context-menu entry, and its confirmation dialog — which FR-032 requires to
 * agree, and which agree by construction when they all read this.
 */
export function panelRemovalVerb({
  inSubWorkspace,
  hasOriginProject,
}: PanelRemovalContext): PanelRemovalVerb {
  return inSubWorkspace && hasOriginProject ? 'Close' : 'Destroy';
}
