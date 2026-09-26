/**
 * 046 FR-001 – FR-004, SC-001 — the file tree has exactly one name, "File Explorer", everywhere a
 * human reads it.
 *
 * ══ WHY A SOURCE/DOC SCAN, NOT A LIST OF THE SITES ALREADY KNOWN ══
 *
 * `spec.md`'s Background names the sites the authors already found: the pane header, the pane
 * rail, one menu item, two setting descriptions, two keybinding descriptions, a preview-setting
 * description, the empty-editor placeholder, and four docs. A test that enumerates exactly those
 * sites proves nothing about a ninth one the authors missed — and `menu-sections.ts`'s own header
 * comment, `theme-copy.ts`'s two token descriptions and a dozen renderer comments already show the
 * old name spreads further than the named list. So this guard DISCOVERS every occurrence across
 * the shipped sources and docs, the same shape `unsaved-dot-call-sites.test.ts` argues for: a
 * source scan sees a site nobody remembered to list; a fixed list only sees the sites someone
 * already knew about.
 *
 * ══ WHAT IS EXCLUDED, AND WHY (FR-004) ══
 *
 * - `specs/` — these record what was decided AT THE TIME; FR-004 says they must not be rewritten,
 *   and this spec (S1) records the supersession of their wording instead.
 * - `.specify/memory/constitution.md` — same reasoning, named explicitly by FR-004.
 * - `CHANGELOG.md` — a release record. Its entries name the pane as it was called when they
 *   shipped, and T087's own line deliberately keeps the OLD name so a reader can find the rename.
 * - a package's `tests` directory — test titles, fixture data and migrated-from comments are not user-visible
 *   strings or docs; FR-002 and SC-001 read as covering the living product and its docs, not the
 *   test suite's own prose. (None of the scan roots below reach into a `tests/` directory anyway —
 *   this exclusion is stated for anyone who widens the roots later.)
 *
 * ══ THE FR-003 COMPANION ══
 *
 * A rename that touches copy only is worthless if it also silently touches a persisted identifier
 * — a config directory written by the previous build would then fail to load, or load with a
 * warning. The second describe block below pins the three identifiers FR-001 itself names as
 * copy sites (`view.toggleExplorer`'s binding id, and the two settings keys) still existing, byte
 * for byte, as keys. It does not care what their LABELS say — that is this file's first half, and
 * `menu-sections.test.ts` / `file-explorer-pane.test.ts` / `preview-header-actions.test.ts` for the
 * rest — only that the KEY survived the rename.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS, settingsLeaves } from '@throng/core';

const ROOT = process.cwd();

/** Absolute prefixes FR-004 exempts, plus the test-suite exclusion stated above. */
const EXCLUDED_PREFIXES = [join(ROOT, 'specs'), join(ROOT, '.specify', 'memory', 'constitution.md'), join(ROOT, 'CHANGELOG.md')];

function isExcluded(path: string): boolean {
  if (EXCLUDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + '\\') || path.startsWith(prefix + '/'))) {
    return true;
  }
  // `packages/<name>/tests/...`, at any depth — stated even though no scan root below reaches it.
  return /[\\/]packages[\\/][^\\/]+[\\/]tests([\\/]|$)/.test(path);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (isExcluded(path)) continue;
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** Every package that ships a `src/` tree — read from disk, so a new package needs no edit here. */
function packageSrcDirs(): string[] {
  const packagesRoot = join(ROOT, 'packages');
  return readdirSync(packagesRoot)
    .map((name) => join(packagesRoot, name, 'src'))
    .filter((dir) => existsSync(dir) && statSync(dir).isDirectory());
}

const SCAN_ROOTS = [...packageSrcDirs(), join(ROOT, 'docs')];
/**
 * Root doc and shipped build/installer text — none of these live under a package `src/` tree or
 * `docs/`, and the installer's own strings and the legal notices reach a user exactly as much as
 * anything under `packages/*\/src` does.
 */
const SCAN_FILES = [
  join(ROOT, 'README.md'),
  join(ROOT, 'CONTRIBUTING.md'),
  join(ROOT, 'CLA.md'),
  join(ROOT, 'COPYRIGHT.md'),
  join(ROOT, 'SECURITY.md'),
  join(ROOT, 'electron-builder.yml'),
  join(ROOT, 'packaging', 'installer.nsh'),
].filter(existsSync);

const ALL_FILES = [...SCAN_ROOTS.flatMap(walk), ...SCAN_FILES];

/**
 * FR-002's three retired spellings: the plain form, its JSX HTML entity, and the "and" variant.
 * `theme-copy.ts:67` spells it "FILES & FOLDERS" (upper-case, inside an enumeration of pane
 * headings) and `theme-copy.ts:555`/`:559` spell it "files and folders" (lower case, inside "the
 * files and folders tree") — a case-sensitive Title Case match missed both, so each separator gets
 * TWO patterns rather than one blanket case-insensitive match:
 *
 * - ALL-CAPS, because that is how this codebase renders the retired name as an enumerated label
 *   next to its siblings ("PROJECTS, TERMINALS and FILES & FOLDERS") — ordinary English does not.
 * - Any case, but only when the phrase is followed by a word that names a UI surface (tree, pane,
 *   panel, heading/headings) — how every OTHER violation in this codebase actually reads.
 * - The exact literal Title Case spelling — "Files & Folders", "Files &amp; Folders" and
 *   "Files and Folders" — ANYWHERE in a line, case-sensitively and with no surface-word
 *   requirement. FR-002/SC-001 want zero matches for these three literal strings outright; the
 *   other two heuristics above exist only to widen the net beyond the literal spelling (ALL-CAPS
 *   enumeration labels, and a lower-case phrase immediately naming a surface), not to narrow it.
 *
 * A blind case-insensitive match over the bare phrase also flagged three sites that are not this
 * name at all: `files-service.ts`'s "rename directly for both files and folders", a comment on
 * `terminal-panel.tsx` reading "files and folders alike", and the Project Settings dialog's
 * "Hidden files & folders" heading (a list of hidden filesystem entries — a different feature).
 * All three use "files and/& folders" as ordinary plural nouns, not as the pane's name, and
 * renaming them to reference "File Explorer" would change what they mean. All three also spell it
 * LOWER-case ("files and folders", never "Files and Folders"), so the case-sensitive literal check
 * above does not re-introduce them — a new lower-case, mid-sentence "files and folders" elsewhere
 * still passes, exactly as it should.
 */
const SEPARATORS: readonly string[] = ['&', '&amp;', 'and'];
const SURFACE_WORDS = 'tree|pane|panel|headings?';
const RETIRED_SPELLINGS: readonly RegExp[] = SEPARATORS.flatMap((sep) => [
  new RegExp(`FILES\\s*${sep.toUpperCase()}\\s*FOLDERS`),
  new RegExp(`Files\\s*${sep}\\s*Folders\\s*(${SURFACE_WORDS})\\b`, 'i'),
  new RegExp(`Files\\s*${sep}\\s*Folders`),
]);

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** Pulled out of `findViolations` so the literal/heuristic patterns can be proven on sample strings. */
function hasRetiredSpelling(text: string): boolean {
  return RETIRED_SPELLINGS.some((re) => re.test(text));
}

function findViolations(): Violation[] {
  const found: Violation[] = [];
  for (const file of ALL_FILES) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      if (hasRetiredSpelling(text)) {
        found.push({
          file: file.slice(ROOT.length + 1).replace(/\\/g, '/'),
          line: i + 1,
          text: text.trim(),
        });
      }
    });
  }
  return found;
}

describe('FR-002/SC-001 — the literal Title Case retired name is flagged anywhere, case-sensitively', () => {
  it.each([
    ['Files & Folders', 'Selecting Files & Folders together works well.'],
    ['Files &amp; Folders', 'Selecting Files &amp; Folders together works well.'],
    ['Files and Folders', 'Selecting Files and Folders together works well.'],
  ])('flags the literal %s mid-sentence, with no trailing surface word', (_label, sample) => {
    expect(hasRetiredSpelling(sample)).toBe(true);
  });

  /**
   * The three sites the heuristics were written to avoid (see the big comment above
   * `RETIRED_SPELLINGS`): all three spell it lower-case, as an ordinary plural noun, never
   * Title Case. A case-SENSITIVE literal match must not start flagging them.
   */
  it('still does not flag the lower-case "files and/&amp; folders" false positives', () => {
    expect(hasRetiredSpelling('// rename directly for both files and folders. A temp-name dance would…')).toBe(false);
    expect(hasRetiredSpelling('// terminal takes any tree drag, files and folders alike, as text at the prompt.')).toBe(false);
    expect(hasRetiredSpelling('<h4 className="project-settings__section">Hidden files &amp; folders</h4>')).toBe(false);
  });
});

describe('FR-002/SC-001 — no shipped source or doc names the tree "Files & Folders"', () => {
  it('has zero matches for the retired spelling, its HTML entity, and "Files and Folders", across packages/*/src, README.md, CONTRIBUTING.md and docs/', () => {
    const violations = findViolations();
    const report = violations.map((v) => `  ${v.file}:${v.line}: ${v.text}`).join('\n');
    expect(violations, `the retired name is still present (FR-002):\n${report}`).toEqual([]);
  });

  /**
   * A mechanical find/replace of "Files & Folders'" (the old possessive, e.g. "Files & Folders'
   * Open In") to "File Explorer'" leaves a dangling apostrophe rather than "File Explorer's" — five
   * sites shipped exactly that shape in this codebase (CONTRIBUTING.md ×2, README.md, the
   * editor-coordinator watch/delete comment, and an integration test comment). A closing string
   * quote (`'File Explorer'`, `'File Explorer',`, `'File Explorer']`, …) is never followed by a
   * space and a word character, so that is the regression this guards without re-flagging every
   * ordinary string literal spelling the pane's name.
   */
  it('never leaves a dangling "File Explorer\'" possessive (not followed by an s)', () => {
    const found: Violation[] = [];
    for (const file of ALL_FILES) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((text, i) => {
        if (/File Explorer' \S/.test(text) && !/File Explorer's\b/.test(text)) {
          found.push({ file: file.slice(ROOT.length + 1).replace(/\\/g, '/'), line: i + 1, text: text.trim() });
        }
      });
    }
    const report = found.map((v) => `  ${v.file}:${v.line}: ${v.text}`).join('\n');
    expect(found, `a dangling "File Explorer'" possessive:\n${report}`).toEqual([]);
  });
});

describe('FR-003 — the rename is copy only, so these frozen identifiers still exist as keys', () => {
  it('keeps view.toggleExplorer as a keybinding command id', () => {
    expect(Object.keys(DEFAULT_KEYBINDINGS.bindings)).toContain('view.toggleExplorer');
  });

  it('keeps panes.fileExplorer.maxWidth as a settings key', () => {
    expect(settingsLeaves()).toContain('panes.fileExplorer.maxWidth');
  });

  it('keeps explorer.autoRevealActiveFile as a settings key', () => {
    /*
     * T023/spec.md FR-001 name this identifier "explorer.followActiveEditor" — that string exists
     * nowhere in the shipped sources; `settings-metadata.ts:392` is the "Follow the active editor"
     * toggle, and its key is `explorer.autoRevealActiveFile`. This asserts the real frozen key
     * rather than the name spec.md/tasks.md give it — see this batch's report for the discrepancy.
     */
    expect(settingsLeaves()).toContain('explorer.autoRevealActiveFile');
  });
});
