/**
 * 057 FR-125, amended by the v1 review — how `panel.toggleFlag` reaches the panel it is for.
 *
 * The window dispatcher resolves the focused panel, but it cannot see the panel's place (the names a mark is headed
 * with) or whether the panel holds a mark. The panel can, so each typed panel registers the toggle its title menu's
 * Flag / Unflag row runs, and the chord runs that one implementation. A blank panel offers no Flag and registers
 * nothing.
 */
type Toggle = () => void;

const toggles = new Map<string, Toggle>();

/** Register a panel's toggle. Returns the un-register, which leaves a newer registration for the panel alone. */
export function registerPanelFlagToggle(panelId: string, toggle: Toggle): () => void {
  toggles.set(panelId, toggle);
  return () => {
    if (toggles.get(panelId) === toggle) toggles.delete(panelId);
  };
}

/** Flag or unflag a panel. False when nothing is registered for it: nothing to act on (048 FR-092). */
export function runPanelFlagToggle(panelId: string): boolean {
  const toggle = toggles.get(panelId);
  if (!toggle) return false;
  toggle();
  return true;
}
