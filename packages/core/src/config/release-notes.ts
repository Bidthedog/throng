/**
 * Release notes and the release body (042 FR-001 to FR-010).
 *
 * Every throng release published so far carried an identical body — a hardcoded string naming the
 * version, the unsigned-installer warning, a one-row checksum table, and the source commit. Two
 * consecutive releases differed by a version number and a hash, so a user could not tell what had
 * changed or which release introduced a regression.
 *
 * The notes now come from `CHANGELOG.md`, which is compiled at release-preparation time and
 * committed BEFORE the tag. That choice is what makes FR-003 and FR-004 achievable at once: the
 * notes are reviewed as an ordinary diff, and publication adds no manual step.
 *
 * Two rules in here carry most of the weight:
 *
 *   1. **The parser never falls back.** No section for the version being published is a refusal —
 *      never the previous version's notes, never generated text. A fallback that produces a
 *      plausible body is exactly how an unreviewed release ships.
 *   2. **The footer is invariant and always last.** `docs/installation.md` tells users the notes
 *      carry the checksum, and 020 FR-043 makes the notes responsible for explaining the
 *      unrecognised-app warning. New content goes above it, never in place of it — including when
 *      the body has to be shortened to fit (FR-010), where the notes are the half with a fallback
 *      and the footer is the half without.
 *
 * Pure: no filesystem, no hashing. Digests arrive already computed, because 020 FR-042a requires
 * the checksum to be the LAST step that reads an artifact's bytes, and that step lives in
 * `scripts/checksum.mjs` at publish time.
 */

import type { ReleaseArtifact } from './release-artifacts.js';

/** The exact line that declares a release deliberately has nothing user-visible in it (FR-009). */
export const NO_USER_VISIBLE_CHANGES = 'No user-visible changes in this release.';

/** The maximum length of a GitHub release body. Beyond this the notes are shortened (FR-010). */
export const RELEASE_BODY_MAX_LENGTH = 125_000;

/** One grouped block of notes — Added, Fixed, Changed, Removed, Known issues, or anything else. */
export interface NotesSection {
  heading: string;
  entries: readonly string[];
}

/** The parsed notes for exactly one version. */
export interface ReleaseNotes {
  version: string;
  sections: readonly NotesSection[];
  /** True when the section exists and explicitly states there is nothing user-visible (FR-009). */
  isEmptyByDeclaration: boolean;
}

/**
 * What a lookup found, or which of the ways it failed — so a refusal can name the cause
 * (020 FR-031).
 */
export type NotesLookupResult =
  | { found: ReleaseNotes; cause: null }
  | { found: null; cause: 'no-section-for-version' }
  | { found: null; cause: 'section-empty' };

/** Strip HTML comments, which is where the "reconstructed retrospectively" note lives. */
function withoutComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Find the lines belonging to one version's `##` section: everything after its heading and before
 * the next `##`. Returns `null` when there is no such heading.
 *
 * The version match is exact on the first whitespace-delimited token, so `## 1.2.3` does not
 * satisfy a publish of `1.2.30` — the same binding rule 020 FR-030 applies to a QA sign-off, for
 * the same reason.
 */
function sectionLinesFor(text: string, version: string): string[] | null {
  const lines = withoutComments(text).split(/\r?\n/);
  const headingIndex = lines.findIndex(
    (line) => line.startsWith('## ') && line.slice(3).trim().split(/\s+/)[0] === version,
  );
  if (headingIndex === -1) return null;

  const rest = lines.slice(headingIndex + 1);
  const nextHeading = rest.findIndex((line) => line.startsWith('## '));
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

/**
 * Group a section's lines into `### heading` blocks, keeping an unheaded preamble as its own block.
 *
 * **Entries wrap.** `CHANGELOG.md` is a file people read and edit, so its list items are wrapped to
 * the file's line length like every other line in the repository. A parser that reads only the
 * `- ` line drops the rest of the sentence, and the published release body then reads as though it
 * were cut off mid-thought — which is exactly what happened the first time a real changelog was
 * rendered through this. A continuation line is joined to its entry with a single space.
 */
function groupSections(lines: readonly string[]): NotesSection[] {
  const sections: NotesSection[] = [];
  let heading = '';
  let entries: string[] = [];

  const flush = (): void => {
    if (entries.length > 0 || heading !== '') sections.push({ heading, entries });
    entries = [];
  };

  for (const line of lines) {
    if (line.startsWith('### ')) {
      flush();
      // An unrecognised heading is passed through in place rather than dropped — losing content
      // silently is worse than rendering a heading nobody planned for.
      heading = line.slice(4).trim();
      continue;
    }

    const entry = /^\s*-\s+(.*)$/.exec(line);
    if (entry) {
      entries.push(entry[1].trim());
      continue;
    }

    // A non-empty line that is not a list item and not a heading continues the entry above it.
    const continuation = line.trim();
    if (continuation !== '' && entries.length > 0) {
      entries[entries.length - 1] = `${entries[entries.length - 1]} ${continuation}`;
    }
  }
  flush();

  return sections.filter((s) => s.entries.length > 0 || s.heading !== '');
}

/**
 * The notes for one version, or the reason there are none.
 *
 * A section that is present but carries no entries is `section-empty` — which is a REFUSAL, not an
 * empty release. The only way to publish a release with nothing listed is the explicit declaration
 * in {@link NO_USER_VISIBLE_CHANGES}: absence and a deliberate statement are different states, and
 * conflating them is what lets an unwritten changelog through.
 */
export function lookupReleaseNotes(changelog: string, version: string): NotesLookupResult {
  const lines = sectionLinesFor(changelog, version);
  if (lines === null) return { found: null, cause: 'no-section-for-version' };

  const sections = groupSections(lines);
  const allEntries = sections.flatMap((s) => s.entries);

  if (allEntries.length === 0) return { found: null, cause: 'section-empty' };

  const isEmptyByDeclaration = allEntries.length === 1 && allEntries[0] === NO_USER_VISIBLE_CHANGES;

  return { found: { version, sections, isEmptyByDeclaration }, cause: null };
}

export interface ComposeReleaseBodyInput {
  notes: ReleaseNotes;
  /** The declared set, each with its `sha256` filled from the published bytes (020 FR-042a). */
  artifacts: readonly ReleaseArtifact[];
  /** The exact source revision the artifacts were built from (020 FR-035). */
  commitSha: string;
  /** Overridable for tests; defaults to {@link RELEASE_BODY_MAX_LENGTH}. */
  maxLength?: number;
}

/** Render the notes half of the body. */
function renderNotes(notes: ReleaseNotes): string {
  return notes.sections
    .map((section) => {
      const body = section.entries.map((e) => `- ${e}`).join('\n');
      return section.heading === '' ? body : `### ${section.heading}\n\n${body}`;
    })
    .join('\n\n');
}

/**
 * Render the invariant footer: the warning, how to verify a download, one checksum row per
 * artifact, and the source revision. Never shortened, never reordered, always last.
 */
function renderFooter(artifacts: readonly ReleaseArtifact[], commitSha: string): string {
  const rows = artifacts
    .map((a) => `| ${a.label} | \`${a.filename}\` | \`${a.sha256 ?? ''}\` |`)
    .join('\n');

  return [
    '---',
    '',
    '**These downloads are not code-signed.** Windows will show an "unrecognised app" warning',
    '(SmartScreen) — click **More info → Run anyway**. Never disable a security feature to install.',
    '',
    'Verify your download matches its checksum below (`Get-FileHash <file> -Algorithm SHA256`).',
    '',
    '| Artifact | File | SHA-256 |',
    '|---|---|---|',
    rows,
    '',
    `Built from ${commitSha}.`,
  ].join('\n');
}

/**
 * Compose the complete release body: the notes, then the invariant footer.
 *
 * If the result would exceed `maxLength`, the NOTES are shortened at a section boundary and a line
 * pointing at `CHANGELOG.md` is appended — publication still succeeds (FR-010). The footer is never
 * touched, because it is the half other documents promise is there.
 */
export function composeReleaseBody(input: ComposeReleaseBodyInput): string {
  const { notes, artifacts, commitSha, maxLength = RELEASE_BODY_MAX_LENGTH } = input;

  const footer = renderFooter(artifacts, commitSha);
  const full = `${renderNotes(notes)}\n\n${footer}`;
  if (full.length <= maxLength) return full;

  const pointer = '\n\n_These notes were shortened to fit. See `CHANGELOG.md` for the rest._';
  const budget = maxLength - footer.length - pointer.length - 2;

  // Drop whole sections from the end until what remains fits — a body cut mid-sentence reads as a
  // fault rather than as a deliberate summary.
  let kept = [...notes.sections];
  let rendered = renderNotes({ ...notes, sections: kept });
  while (kept.length > 1 && rendered.length > budget) {
    kept = kept.slice(0, -1);
    rendered = renderNotes({ ...notes, sections: kept });
  }

  // One enormous section can still overflow on its own; drop entries from the end of it.
  if (rendered.length > budget && kept.length === 1) {
    let entries = [...kept[0].entries];
    while (entries.length > 1 && rendered.length > budget) {
      entries = entries.slice(0, -1);
      rendered = renderNotes({ ...notes, sections: [{ ...kept[0], entries }] });
    }
  }

  return `${rendered.slice(0, Math.max(0, budget))}${pointer}\n\n${footer}`;
}
