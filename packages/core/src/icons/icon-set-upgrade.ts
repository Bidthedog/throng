/**
 * The pure half of the icon set upgrade (spec 069 FR-017 to FR-020, FR-036, FR-038). Main does the
 * file work; every decision it takes is made here so it can be tested without a disk.
 */
import { formatGrouped } from '../config/number-format.js';
import { SEEDED_ICON_HISTORY, type SeededFolderName } from './seeded-icon-history.generated.js';

/** The theme keys the upgrade removes: the glyph map, the per-icon overrides and the choice of set. */
const RETIRED_THEME_KEYS = ['icons', 'iconOverrides', 'iconPack'] as const;

export type RetiredThemeKey = (typeof RETIRED_THEME_KEYS)[number];

export interface ThemeIconSetUpgrade<T extends object> {
  /** The theme with the retired keys removed. A copy; the input is untouched. */
  theme: Omit<T, RetiredThemeKey>;
  /** Which keys it held, in the order above. */
  removed: RetiredThemeKey[];
}

/**
 * The shipped-defaults version the icon set upgrade arrived with. A configuration whose applied
 * version is below it predates icon sets: its `iconPack` named an old pack, and its icon-packs
 * folder holds old packs to back up.
 */
export const ICON_SET_UPGRADE_VERSION = 34;

/**
 * Plan the theme step of the upgrade for one theme document, built-in or the user's own alike
 * (FR-017, FR-018): delete `icons` and `iconOverrides`, and — only when the configuration's applied
 * shipped-defaults version predates {@link ICON_SET_UPGRADE_VERSION} — `iconPack`, so the theme falls
 * to the default icon set and nothing is carried anywhere. Upgrades run on every later version bump
 * too, and by then `iconPack` is the user's own choice of set, which must survive (FR-014, FR-020).
 * Returns `null` when there is nothing to remove, which is what makes a second pass change nothing.
 */
export function planThemeIconSetUpgrade<T extends object>(theme: T, appliedVersion: number): ThemeIconSetUpgrade<T> | null {
  const predatesSets = appliedVersion < ICON_SET_UPGRADE_VERSION;
  const removed = RETIRED_THEME_KEYS.filter(
    (key) => (key !== 'iconPack' || predatesSets) && Object.prototype.hasOwnProperty.call(theme, key),
  );
  if (removed.length === 0) return null;
  const next = { ...theme } as Record<string, unknown>;
  for (const key of removed) delete next[key];
  return { theme: next as Omit<T, RetiredThemeKey>, removed };
}

/** What the upgrade reads of one file in a seeded folder. */
export interface SeededFileInfo {
  name: string;
  /** Lower-case hex SHA-256 of the file's bytes. */
  sha256: string;
}

export type SeededFolderVerdict = 'uncustomised' | 'customised';

function isSeededFolderName(name: string): name is SeededFolderName {
  return Object.prototype.hasOwnProperty.call(SEEDED_ICON_HISTORY, name);
}

/**
 * Decide whether a folder an earlier version seeded (`throng` or `throng-svg`) still holds exactly what
 * throng wrote (FR-036). It is **uncustomised** only when its file-name set equals the set one release
 * seeded and every file's hash matches that same release. Anything else is **customised**: an edited
 * file, an added file, a missing file, files from two releases mixed, an empty folder, or any other
 * folder name. Customised folders are backed up, never deleted, so every doubt resolves the safe way.
 */
export function classifySeededFolder(name: string, files: readonly SeededFileInfo[]): SeededFolderVerdict {
  if (!isSeededFolderName(name) || files.length === 0) return 'customised';
  const found = new Map(files.map((f) => [f.name, f.sha256.toLowerCase()]));
  if (found.size !== files.length) return 'customised';
  const matches = SEEDED_ICON_HISTORY[name].some((version) => {
    const expected = Object.entries(version.files);
    return expected.length === found.size && expected.every(([file, sha]) => found.get(file) === sha);
  });
  return matches ? 'uncustomised' : 'customised';
}

/**
 * The name a folder is renamed to when the upgrade backs it up (FR-019): `<name>.bak`, or
 * `<name>.bak.<n>` for the first free `n` from 2 when that is taken (`throng-svg.bak.2`). `taken` is
 * every name already in the directory; names compare ignoring case, as Windows treats them.
 */
export function backupName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  const first = `${name}.bak`;
  if (!used.has(first.toLowerCase())) return first;
  for (let n = 2; ; n += 1) {
    const candidate = `${name}.bak.${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * The text of the one notice raised at every start while any `.bak` icon set folder remains (FR-038).
 * It says the folders hold icons from before the upgrade, that nothing in them was converted, and what
 * to do about it. Generic OS wording ("folder"), and "icon set", never "pack".
 */
export function iconSetBackupNoticeText(count: number): { title: string; message: string } {
  const folders = count === 1 ? 'folder' : 'folders';
  const verb = count === 1 ? 'holds' : 'hold';
  return {
    title: 'Icon set backups',
    message:
      `${formatGrouped(count)} ${folders} in your icon sets folder ${verb} icons from before the upgrade. ` +
      'Nothing was converted. To keep any of them, move the icons you want into a new icon set, ' +
      'then delete the backups or move them out of the folder.',
  };
}
