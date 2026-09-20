/**
 * 045 FR-173e, FR-178, FR-178a, FR-178b — the file extensions that tell the space rule where a path ENDS.
 *
 * A candidate that is anchored or carries a separator may scan forward across single spaces, and the
 * first word whose last segment ends in one of these extensions ends it (FR-179b):
 * `C:\my folder\my file.txt` is one link because `txt` is here; `D:\notes draft.xyz` is not, because
 * `xyz` is not. Detection never asks the disk (FR-155), so this list is the whole of what "a file name
 * has ended" means to it.
 *
 * ══ A SYNTACTIC HINT, NOT AN OS FACT (FR-178b) ══
 *
 * The list names `exe`, `msi`, `ps1`, `bat` and the like because people print paths to them, not
 * because anything here decides what the OS would run — executability is decided only behind
 * `IExecutableExtensions` (FR-039a). `links-no-os-names.test.ts` carries a named exemption for this
 * file saying exactly that; every other file under `core/src/links/` stays under the full rule.
 *
 * ══ WHAT IS DELIBERATELY LEFT OUT ══
 *
 * Anything that is also a word or a host suffix drags prose into a path: `com`, `net`, `org`,
 * `local`, `folder`, `out`, `err`, and single letters beyond the two every C programmer prints
 * (`c`, `h`). The table's U8 pins the first group.
 *
 * ══ THE SETTING IS THE LIST (round five) ══
 *
 * `editor.links.knownFileExtensions` holds the extensions themselves, seeded from this list, so the
 * preferences control shows the real ones and add/remove is ordinary editing. Every reader turns it
 * into a set through `knownFileExtensionsSet`.
 *
 * ── what that costs, and why it was chosen anyway ──
 *
 * FR-178a stored the user's EDITS instead — `.added` and `.removed` against this list — precisely so
 * that an extension shipped here later reached every install that had not removed it. Storing the
 * whole list gives that up: an install whose list has been edited never sees a later addition. The
 * maintainer asked for the visible list knowing this; FR-182c records the trade.
 *
 * `resolveKnownExtensions` below survives for ONE caller, the migration that folds an old
 * `{ added, removed }` document into the new list. Nothing on the scanning path uses it.
 *
 * ── the trap ──
 *
 * THE EMPTY VALUE INVERTED. `{ added: [], removed: [] }` meant every shipped extension; `[]` means
 * none. A fixture or a default translated by shape alone typechecks and silently stops detecting,
 * which has already happened once (`link-parity.test.ts`).
 */

const SHIPPED = [
  // documents and text
  'txt', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'tex', 'pdf', 'csv', 'tsv', 'rtf', 'odt', 'ods',
  'odp', 'epub',
  // office
  'doc', 'docx', 'docm', 'xls', 'xlsx', 'xlsm', 'xlsb', 'ppt', 'pptx', 'vsdx', 'msg', 'eml',
  // images
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tif', 'tiff', 'heic', 'avif', 'psd',
  // audio and video
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'mp4', 'mkv', 'mov', 'avi', 'webm',
  // fonts
  'ttf', 'otf', 'woff', 'woff2',
  // archives and packages
  'zip', '7z', 'gz', 'tgz', 'tar', 'rar', 'bz2', 'xz', 'zst', 'cab', 'iso', 'nupkg', 'jar', 'whl',
  'vsix',
  // source code
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'cs', 'csx', 'vb', 'fs', 'fsx', 'py', 'pyi',
  'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'swift', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp',
  'hxx', 'php', 'pl', 'lua', 'dart', 'sql', 'css', 'scss', 'sass', 'less', 'html', 'htm', 'vue',
  'svelte', 'razor', 'cshtml', 'xaml', 'ipynb', 'graphql', 'proto',
  // configuration and data
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'xml', 'ini', 'cfg', 'conf', 'config', 'props',
  'targets', 'csproj', 'fsproj', 'vbproj', 'vcxproj', 'sln', 'slnx', 'editorconfig', 'env',
  'properties', 'lock', 'gradle', 'tfvars', 'db', 'sqlite',
  // logs and diagnostics
  'log', 'dmp', 'etl', 'evtx', 'har',
  // patches
  'patch', 'diff',
  // executables and scripts — a hint for where a path ends only (FR-178b)
  'exe', 'dll', 'sys', 'msi', 'msix', 'appx', 'ps1', 'psm1', 'psd1', 'bat', 'cmd', 'sh', 'bash',
  'zsh', 'fish', 'wasm',
] as const;

/** FR-173e's shipped default: lower-case, no leading dot. The setting edits this; it never copies it. */
export const KNOWN_FILE_EXTENSIONS: ReadonlySet<string> = new Set<string>(SHIPPED);

/** FR-178a: the user's edits against `KNOWN_FILE_EXTENSIONS`, as the settings store them. */
export interface KnownExtensionEdits {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** `removed` holding this removes every SHIPPED entry — including ones shipped later (FR-178a). */
export const REMOVE_ALL_SHIPPED = '*';

/**
 * FR-178a: `(shipped ∪ added) − removed`, each entry trimmed, lower-cased and stripped of ONE leading
 * dot, empties dropped. `*` in `removed` empties the shipped half; an addition survives it. Pure; the
 * result is always a new set.
 */
export function resolveKnownExtensions(
  shipped: ReadonlySet<string>,
  edits: KnownExtensionEdits,
): ReadonlySet<string> {
  const removed = new Set(edits.removed.map(normaliseExtension).filter((e) => e.length > 0));
  const out = new Set<string>(removed.has(REMOVE_ALL_SHIPPED) ? [] : shipped);
  for (const entry of edits.added) {
    const e = normaliseExtension(entry);
    if (e.length > 0) out.add(e);
  }
  for (const e of removed) out.delete(e);
  return out;
}

/**
 * FR-178b (round five): the extensions a scan compares against, from the ONE list the setting now
 * holds — each entry trimmed, lower-cased and stripped of ONE leading dot, empties dropped.
 *
 * The setting stores what the user typed, exactly as `editor.links.protocolAllowlist` does, so every
 * reader normalises at the point of use rather than the parse trusting a shape it did not impose.
 * `protocolAllowlistSet` in `protocol-uri.ts` is the same function for schemes, and this is
 * deliberately its twin: one accessor per list setting, so a surface cannot invent its own reading.
 *
 * Round four's `resolveKnownExtensions` survives for the MIGRATION alone — a settings document
 * written before the inversion still holds `{ added, removed }`, and folding that into the new list
 * must use the same arithmetic that used to compute the effective set, not a second copy of it.
 */
export function knownFileExtensionsSet(entries: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const entry of entries) {
    const e = normaliseExtension(entry);
    if (e.length > 0) out.add(e);
  }
  return out;
}

/** FR-178: compared without case, accepted with or without its leading dot. */
function normaliseExtension(entry: string): string {
  const e = entry.trim().toLowerCase();
  return e.startsWith('.') ? e.slice(1).trim() : e;
}
