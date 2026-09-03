import { describe, expect, it } from 'vitest';

import { composeReleaseBody, lookupReleaseNotes } from '../../src/index.js';
import type { ReleaseArtifact } from '../../src/index.js';

/**
 * 042 FR-001 to FR-010 — a release body says what changed in that release, above an INVARIANT
 * footer. The notes come from `CHANGELOG.md`, parsed and bound to exactly one version; the parser
 * refuses rather than falling back, because a fallback that produces a plausible body is how an
 * unreviewed release ships.
 */

const CHANGELOG = `# Changelog

<!-- Sections for 1.0.0-alpha1 were reconstructed after that release shipped. -->

## 1.2.3 — 2026-09-14

### Added
- Portable and archive downloads.
- A second added line.

### Fixed
- Terminal scrolling after a project switch (#290).

### Known issues
- The preferences window is slow on a cold start.

## 1.2.2 — 2026-08-30

### Fixed
- Something older.

## 1.2.1 — 2026-08-01

- No user-visible changes in this release.

## 1.2.0 — 2026-07-01

### Fixed
`;

const ARTIFACTS: ReleaseArtifact[] = [
  {
    role: 'setup',
    filename: 'throng-setup-1.2.3.exe',
    label: 'Installer (per-user setup)',
    applicableSteps: [],
    sha256: 'a'.repeat(64),
  },
  {
    role: 'portable',
    filename: 'throng-portable-1.2.3.exe',
    label: 'Portable',
    applicableSteps: [],
    sha256: 'b'.repeat(64),
  },
];

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

describe('lookupReleaseNotes — parsing (042 FR-001)', () => {
  it('parses the requested version into ordered sections', () => {
    const r = lookupReleaseNotes(CHANGELOG, '1.2.3');
    expect(r.found).not.toBeNull();
    expect(r.found?.version).toBe('1.2.3');
    expect(r.found?.sections.map((s) => s.heading)).toEqual(['Added', 'Fixed', 'Known issues']);
  });

  it('keeps every entry of a section, in order', () => {
    const added = lookupReleaseNotes(CHANGELOG, '1.2.3').found?.sections[0];
    expect(added?.entries).toEqual(['Portable and archive downloads.', 'A second added line.']);
  });

  it('ignores the document title and HTML comments, so the reconstruction note never reaches a release', () => {
    const body = JSON.stringify(lookupReleaseNotes(CHANGELOG, '1.2.3').found);
    expect(body).not.toMatch(/reconstructed/);
    expect(body).not.toMatch(/# Changelog/);
  });

  it('stops at the next version heading — one section is one release', () => {
    const entries = lookupReleaseNotes(CHANGELOG, '1.2.3').found?.sections.flatMap((s) => s.entries);
    expect(entries).not.toContain('Something older.');
  });

  it('keeps the whole of a WRAPPED entry, not just its first line', () => {
    // Found by rendering this repository's own CHANGELOG.md: entries are wrapped to fit the file's
    // line length, and a parser that reads only the `- ` line silently drops the rest of the
    // sentence. The release body then reads as though it were cut off mid-thought.
    const changelog = [
      '## 7.0.0',
      '',
      '### Added',
      '- The editor status bar reports cursor position, selection size and document length, and the',
      '  gutter can be turned on or off from Settings.',
      '- A second, unwrapped entry.',
      '',
    ].join('\n');
    const entries = lookupReleaseNotes(changelog, '7.0.0').found?.sections[0].entries;
    expect(entries).toHaveLength(2);
    expect(entries?.[0]).toContain('gutter can be turned on or off from Settings.');
    expect(entries?.[1]).toBe('A second, unwrapped entry.');
  });

  it('joins a wrapped entry with a single space, never a newline', () => {
    const changelog = '## 7.1.0\n\n### Fixed\n- One sentence\n  continued here.\n';
    const entry = lookupReleaseNotes(changelog, '7.1.0').found?.sections[0].entries[0];
    expect(entry).toBe('One sentence continued here.');
  });

  it('does not let a wrapped entry swallow the next heading', () => {
    const changelog = '## 7.2.0\n\n### Added\n- Wrapped\n  over two lines.\n\n### Fixed\n- Separate.\n';
    const sections = lookupReleaseNotes(changelog, '7.2.0').found?.sections;
    expect(sections?.map((s) => s.heading)).toEqual(['Added', 'Fixed']);
    expect(sections?.[0].entries[0]).toBe('Wrapped over two lines.');
    expect(sections?.[1].entries[0]).toBe('Separate.');
  });

  it('passes an unrecognised heading through in place rather than dropping it', () => {
    const changelog = `## 9.9.9\n\n### Added\n- a\n\n### Wildcard\n- b\n`;
    const sections = lookupReleaseNotes(changelog, '9.9.9').found?.sections;
    expect(sections?.map((s) => s.heading)).toEqual(['Added', 'Wildcard']);
    expect(sections?.[1].entries).toEqual(['b']);
  });
});

describe('lookupReleaseNotes — the four outcomes (042 FR-005)', () => {
  it('finds the section for a version that has one', () => {
    expect(lookupReleaseNotes(CHANGELOG, '1.2.2').found?.version).toBe('1.2.2');
  });

  it('reports no-section-for-version when the version is absent', () => {
    const r = lookupReleaseNotes(CHANGELOG, '9.9.9');
    expect(r.found).toBeNull();
    expect(r.cause).toBe('no-section-for-version');
  });

  it('NEVER falls back to another version — the failure this rule exists to prevent', () => {
    const onlyPrevious = `## 1.2.2\n\n### Fixed\n- Something older.\n`;
    const r = lookupReleaseNotes(onlyPrevious, '1.2.3');
    expect(r.found).toBeNull();
    expect(r.cause).toBe('no-section-for-version');
    expect(JSON.stringify(r)).not.toMatch(/Something older/);
  });

  it('reports section-empty for a section with a heading and no entries', () => {
    const r = lookupReleaseNotes(CHANGELOG, '1.2.0');
    expect(r.found).toBeNull();
    expect(r.cause).toBe('section-empty');
  });

  it('reports section-empty for a section with no content at all', () => {
    const r = lookupReleaseNotes(`## 3.0.0\n\n## 2.0.0\n\n### Fixed\n- x\n`, '3.0.0');
    expect(r.cause).toBe('section-empty');
  });

  it('does not treat 1.2.3 as satisfying a publish of 1.2.30', () => {
    expect(lookupReleaseNotes(CHANGELOG, '1.2.30').cause).toBe('no-section-for-version');
  });
});

describe('lookupReleaseNotes — a release with nothing user-visible (042 FR-009)', () => {
  it('accepts the exact declaration, and marks it', () => {
    const r = lookupReleaseNotes(CHANGELOG, '1.2.1');
    expect(r.found?.isEmptyByDeclaration).toBe(true);
  });

  it('requires the exact literal — a paraphrase is an empty section, not a declaration', () => {
    const changelog = `## 4.0.0\n\n- Nothing much changed.\n`;
    const r = lookupReleaseNotes(changelog, '4.0.0');
    expect(r.found?.isEmptyByDeclaration ?? false).toBe(false);
  });

  it('does not mark a real release as empty-by-declaration', () => {
    expect(lookupReleaseNotes(CHANGELOG, '1.2.3').found?.isEmptyByDeclaration).toBe(false);
  });
});

describe('composeReleaseBody — the invariant footer (042 FR-007/FR-017)', () => {
  const notes = lookupReleaseNotes(CHANGELOG, '1.2.3').found!;
  const body = composeReleaseBody({ notes, artifacts: ARTIFACTS, commitSha: COMMIT });

  it('leads with what changed', () => {
    expect(body.indexOf('Portable and archive downloads.')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('Portable and archive downloads.')).toBeLessThan(body.indexOf('SHA-256'));
  });

  it('explains the unrecognised-app warning and how to get past it (020 FR-043)', () => {
    expect(body).toMatch(/unrecognised app|SmartScreen/i);
    expect(body).toMatch(/More info/i);
  });

  it('never tells the user to disable a security feature', () => {
    expect(body).toMatch(/Never disable a security feature/i);
    expect(body).not.toMatch(/turn off (Windows )?Defender|disable SmartScreen/i);
  });

  it('carries one checksum row per artifact, against that artifact’s own filename', () => {
    for (const artifact of ARTIFACTS) {
      expect(body).toContain(artifact.filename);
      expect(body).toContain(artifact.sha256);
      expect(body).toContain(artifact.label);
    }
  });

  it('records the exact source revision (020 FR-035)', () => {
    expect(body).toContain(COMMIT);
  });

  it('puts the footer last, and in order', () => {
    const warning = body.search(/unrecognised app|SmartScreen/i);
    const table = body.indexOf('SHA-256');
    const built = body.indexOf('Built from');
    expect(warning).toBeLessThan(table);
    expect(table).toBeLessThan(built);
    expect(built).toBeLessThan(body.length);
  });
});

describe('composeReleaseBody — a release with nothing user-visible (042 FR-009)', () => {
  it('publishes, saying so, with the footer intact', () => {
    const notes = lookupReleaseNotes(CHANGELOG, '1.2.1').found!;
    const body = composeReleaseBody({ notes, artifacts: ARTIFACTS, commitSha: COMMIT });
    expect(body).toMatch(/No user-visible changes/i);
    expect(body).toContain('SHA-256');
    expect(body).toContain(COMMIT);
  });
});

describe('composeReleaseBody — the size cap (042 FR-010)', () => {
  const huge = [
    '## 5.0.0',
    '',
    '### Added',
    ...Array.from({ length: 400 }, (_, i) => `- Entry number ${i} with a good deal of padding text.`),
    '',
    '### Fixed',
    ...Array.from({ length: 400 }, (_, i) => `- Fix number ${i} with a good deal of padding text.`),
    '',
  ].join('\n');

  const notes = lookupReleaseNotes(huge, '5.0.0').found!;
  const body = composeReleaseBody({ notes, artifacts: ARTIFACTS, commitSha: COMMIT, maxLength: 2000 });

  it('still produces a body rather than refusing (publication must not fail on size)', () => {
    expect(body.length).toBeGreaterThan(0);
  });

  it('respects the limit', () => {
    expect(body.length).toBeLessThanOrEqual(2000);
  });

  it('leaves the footer untouched — it is the load-bearing half', () => {
    expect(body).toMatch(/unrecognised app|SmartScreen/i);
    expect(body).toContain('SHA-256');
    expect(body).toContain(ARTIFACTS[0].filename);
    expect(body).toContain(ARTIFACTS[1].filename);
    expect(body).toContain(COMMIT);
  });

  it('says the notes were shortened, and points at the changelog', () => {
    expect(body).toMatch(/CHANGELOG/i);
  });

  it('does not truncate a body that fits', () => {
    const small = lookupReleaseNotes(CHANGELOG, '1.2.3').found!;
    const fits = composeReleaseBody({ notes: small, artifacts: ARTIFACTS, commitSha: COMMIT });
    expect(fits).not.toMatch(/CHANGELOG\.md for the rest/i);
  });
});
