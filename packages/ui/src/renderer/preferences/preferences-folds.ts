/**
 * The persisted fold state of the Preferences window (056 FR-010, FR-011, FR-011a, FR-016, FR-017).
 *
 * ══ WHERE IT LIVES, AND WHY NOT IN A SETTING ══
 *
 * `localStorage["throng.preferences.folds"]`, one JSON object holding one `key → boolean` record per
 * tab. FR-011 calls it hidden UI state, not a setting, and the renderer already keeps exactly that
 * in `localStorage` (pane widths, pane visibility, explorer expansion — research R1).
 *
 * ══ THE USER'S EXPLICIT CHOICE IS STORED, THE DEFAULT IS NOT (version 2, research R9) ══
 *
 * `true` is a heading the user folded, `false` one the user unfolded. A heading with NO entry takes its
 * default ({@link defaultFolded}): a section starts folded and a subgroup or subsection starts unfolded
 * (FR-016). An early shape stored only folded keys, which could never remember an OPENED section once
 * folded became the default (FR-017). That shape never shipped (research R9), so there is no migration:
 * any version but 2 reads as empty, every heading at its default.
 *
 * A heading new since the state was written has no entry and so opens at its default, and a key naming a
 * heading that no longer exists matches nothing and is ignored (FR-011a); the next write for that tab
 * prunes it. A write rewrites only its own tab's record (FR-010: each tab is independent).
 *
 * Storage that throws (unavailable, quota) is swallowed on both paths: folding still works for the
 * session, which beats a Preferences window that cannot open over a remembered chevron.
 */

export type FoldTab = 'settings' | 'keybindings' | 'themes';

const STORAGE_KEY = 'throng.preferences.folds';
const VERSION = 2;
const TABS: readonly FoldTab[] = ['settings', 'keybindings', 'themes'];

type Stored = Record<FoldTab, Record<string, boolean>>;

const emptyDoc = (): Stored => ({ settings: {}, keybindings: {}, themes: {} });

/** The stored document, or empty records for anything unreadable or of another version. */
function readAll(): Stored {
  const doc = emptyDoc();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return doc;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return doc;
    const stored = parsed as Record<string, unknown>;
    if (stored.v !== VERSION) return doc;
    for (const tab of TABS) {
      const value = stored[tab];
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value)) if (typeof v === 'boolean') doc[tab][k] = v;
      }
    }
    return doc;
  } catch {
    return emptyDoc();
  }
}

/** The explicit choices the user made in this tab: `true` folded, `false` unfolded. */
export function readFolds(tab: FoldTab): Map<string, boolean> {
  return new Map(Object.entries(readAll()[tab]));
}

/**
 * Persist this tab's explicit choices, pruned to headings that still exist in the tab (`currentKeys`).
 * Never called during a search — a search never writes (FR-008, FR-009).
 */
export function writeFolds(tab: FoldTab, choices: ReadonlyMap<string, boolean>, currentKeys: ReadonlySet<string>): void {
  try {
    const doc = readAll();
    const next: Record<string, boolean> = {};
    for (const [k, v] of choices) if (currentKeys.has(k)) next[k] = v;
    doc[tab] = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: VERSION, ...doc }));
  } catch {
    // Folding keeps working for the session; only the memory of it is lost.
  }
}

/**
 * Does a heading with no stored choice start folded (FR-016)? A SECTION — a FoldKey of length 1, the Themes
 * tab's `["Icons"]` included — starts folded; a subgroup or nested subsection starts unfolded. `sectionsOpen`
 * is the test seam ({@link sectionsOpenByDefault}): with it, sections start unfolded too.
 */
export function defaultFolded(key: string, sectionsOpen: boolean): boolean {
  if (sectionsOpen) return false;
  try {
    const path: unknown = JSON.parse(key);
    return Array.isArray(path) && path.length === 1;
  } catch {
    return false;
  }
}

/**
 * The test-only seam (research R10): main adds `foldDefault=open` to the Preferences window's URL when
 * `THRONG_PREFS_SECTIONS_OPEN=1`, which the E2E harness sets so the existing specs keep driving rows in
 * open sections. Read from the URL on EVERY call, with no module-level cache, so a component test that sets
 * the URL per test sees it; false where there is no `window`. The hook reads it once per mount.
 */
export function sectionsOpenByDefault(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('foldDefault') === 'open';
}
