/**
 * New-project folder-picker starting-directory resolution, UI-main side (011, US3,
 * FR-043). The renderer computes an ORDERED list of *candidate* start folders from
 * settings (`resolveStartingFolder` in @throng/core — e.g. override, then last
 * viewed, then profile); UI-main validates each against the real filesystem here and
 * opens at the FIRST that resolves to a real directory, silently cascading past any
 * that cannot be resolved (never existed, deleted, or a disconnected/inaccessible
 * drive) and finally falling back to the user's profile/home folder.
 *
 * Accepts either a single path (settings "browse" opens at the current value) or a
 * candidate list (new-project cascade). Pure: existence is injected so this is
 * unit-testable without touching disk or the OS dialog (Principle II keeps the
 * OS-specific fs check behind this seam).
 */
export function resolvePickerDefaultPath(
  requested: string | readonly string[] | undefined,
  home: string,
  existsAsDir: (path: string) => boolean,
): string {
  const candidates = (Array.isArray(requested) ? requested : requested == null ? [] : [requested])
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  for (const candidate of candidates) {
    try {
      if (existsAsDir(candidate)) return candidate;
    } catch {
      // Treat a throwing check (e.g. a disconnected drive) as unresolvable; cascade.
    }
  }
  return home;
}
