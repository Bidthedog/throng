/**
 * Globally unique panel names (024 follow-up).
 *
 * No two panels anywhere in throng — across every project AND every sub-workspace — may share a
 * name. The reason is that a panel's name is how a user REFERS to it: in the tab strip, in the
 * window title, in the app-close warning listing what is still running, and out loud to whoever
 * they are pairing with. Two panels called "Build" in two projects make every one of those a
 * riddle.
 *
 * Pure: the caller supplies the names already taken and gets back a free one. Deciding WHICH names
 * are taken is a question about the whole application, and only the daemon can answer it.
 */

/** Names are compared case-INSENSITIVELY: "Build" and "build" are the same name to a reader. */
function key(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * `desired` if it is free, else the first free `"<desired> (n)"`.
 *
 * The suffix starts at 2 — the existing holder is implicitly (1) — and counts up, so a third
 * "Build" becomes "Build (3)" rather than "Build (2) (2)". A `desired` that already ends in a
 * suffix is treated as an ordinary name, because the user may have typed it deliberately.
 */
export function uniquePanelName(desired: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const name of taken) used.add(key(name));
  const base = desired.trim();
  if (base.length === 0) return base; // an empty name is the caller's problem, not this function's
  if (!used.has(key(base))) return base;
  // A GENERATED name rejoins the sequence rather than growing a suffix: the second project's first
  // panel is "Panel 2", not "Panel 1 (2)". A name the USER typed keeps its words and takes a suffix,
  // because those words are the thing they chose — renumbering "Build" to "Build 2" would be
  // rewriting their name rather than disambiguating it.
  if (isDefaultPanelName(base)) return nextDefaultPanelName(used);
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!used.has(key(candidate))) return candidate;
  }
}

/** The shape of a name throng generated: exactly "Panel <n>", nothing a user would have typed. */
const DEFAULT_PANEL_NAME = /^panel (\d+)$/;

/**
 * True when a name is one throng generated, and so may be renumbered freely.
 *
 * Deliberately strict. "Panel 1 (2)", "My Panel 2" and "Panel one" are all names a person could have
 * chosen, and silently renumbering one of those would take a name away from whoever picked it.
 */
export function isDefaultPanelName(name: string): boolean {
  return DEFAULT_PANEL_NAME.test(key(name));
}

/**
 * The next free `"Panel <n>"`, counting from 1 across the WHOLE application — every project, every
 * sub-workspace, every tab. There is one sequence because there is one namespace.
 *
 * The lowest free number wins, so deleting "Panel 2" and adding a panel reuses that number instead
 * of leaving a hole and climbing forever.
 */
export function nextDefaultPanelName(taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const name of taken) used.add(key(name));
  for (let n = 1; ; n += 1) {
    if (!used.has(`panel ${n}`)) return `Panel ${n}`;
  }
}

/**
 * Reconcile a list of already-existing names, keeping the FIRST claim on each.
 *
 * Used once, over everything on disk: the invariant has to be true of the panels a user already
 * has, not merely of the ones they create from now on. Order is the caller's — oldest first — and
 * the first holder of a name keeps it, so the panel a user has been calling "Build" for a month
 * stays "Build" and the newcomer moves.
 *
 * Returns only the entries that CHANGED, so a caller can persist just those layouts.
 */
export function reconcilePanelNames<T extends { id: string; name: string }>(
  panels: readonly T[],
): { id: string; from: string; to: string }[] {
  const used = new Set<string>();
  const changed: { id: string; from: string; to: string }[] = [];
  // A panel CLONED into a sub-workspace shares its id with the project's panel: it is the same
  // panel seen twice, so it claims its name once and is never renamed against itself.
  const seenIds = new Set<string>();
  for (const panel of panels) {
    if (seenIds.has(panel.id)) continue;
    seenIds.add(panel.id);
    const granted = uniquePanelName(panel.name, used);
    used.add(key(granted));
    if (granted !== panel.name) changed.push({ id: panel.id, from: panel.name, to: granted });
  }
  return changed;
}
