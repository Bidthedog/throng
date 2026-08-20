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
/**
 * What the `throng:pickFolder` handler needs from its surroundings.
 *
 * Injected rather than imported so the handler can be driven by a contract test against a REAL
 * temp directory and a stub dialog — no Electron window, no app launch. Before 035 the handler
 * body sat inline in `main.ts`, which meant the only way to prove that a resolved candidate
 * actually reached the dialog's `defaultPath` was to launch the application and intercept
 * `showOpenDialog` from inside it. Four E2E tests did exactly that, at roughly two seconds a launch,
 * for a twelve-line function whose two decisions were already unit-tested.
 */
export interface PickFolderDeps {
  /** The user's profile/home directory — the universal fallback. */
  home: string;
  /** Real filesystem check in production; a map or predicate in a test. */
  existsAsDir: (path: string) => boolean;
  /** The OS folder dialog. Returns the chosen paths, or a cancellation. */
  showOpenDialog: (options: {
    properties: readonly string[];
    defaultPath: string;
  }) => Promise<{ canceled: boolean; filePaths: string[] }>;
}

/**
 * The `throng:pickFolder` handler, minus Electron.
 *
 * Resolves the caller's requested path (a single path, or the new-project cascade's candidate list)
 * to the first entry that exists as a directory, opens the dialog there, and returns the chosen
 * path or null. The cascade itself lives in {@link resolvePickerDefaultPath}; this function is the
 * WIRING — which candidate list goes in, and that its resolution is what the dialog actually opens
 * at. That wiring is the only part a unit test of either decision cannot see.
 */
export async function pickFolder(
  requested: string | readonly string[] | undefined,
  deps: PickFolderDeps,
): Promise<string | null> {
  const defaultPath = resolvePickerDefaultPath(requested, deps.home, deps.existsAsDir);
  const result = await deps.showOpenDialog({ properties: ['openDirectory'], defaultPath });
  return result.canceled || result.filePaths.length === 0 ? null : (result.filePaths[0] ?? null);
}

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
