/**
 * Formatting for a path dropped from Files & Folders onto a terminal (024 US2, #155). Pure. No OS/DOM.
 *
 * The rule (FR-005): wrap a path in double quotes ONLY when it contains whitespace — otherwise insert
 * it bare — and escape nothing else, so a `$` or `&` in a name passes through exactly as the Copy Path
 * default would render it. Several dragged items join with a single space, each quoted independently
 * (FR-004a), producing one atomic insert.
 */

/** Double-quote a path iff it contains whitespace; otherwise return it unchanged. */
export function quoteDropPath(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

/** Join dropped item paths into the terminal insert text: space-separated, each quoted per FR-005. */
export function formatDroppedPaths(paths: readonly string[]): string {
  return paths.map(quoteDropPath).join(' ');
}
