import { describe, it, expect } from 'vitest';
import {
  SUBJECT_KINDS,
  SUBJECT_NAME_MAX,
  SUBJECT_SEPARATOR,
  formatSubject,
  type NoticeSubject,
} from '@throng/core';

/**
 * 030 FR-021 / FR-022 / FR-022a / FR-024 — what a notice is ABOUT, and how that reads.
 *
 * #195 is a notice saying "this item could not be renamed" while the user has four projects open.
 * The fix is not better wording at each call site — it is that the subject is a REQUIRED, structured
 * field with exactly one formatter, so no call site can spell a subject its own way and none can
 * omit one.
 *
 * One formatter is also what makes truncation enforceable: it is applied per name part, here and
 * nowhere else (FR-021). A row that rendered `panelName` straight to the DOM would bypass it and one
 * long name would break the consolidated notice's height bound.
 */

/** A name of exactly `n` characters, whose length is obvious in a failure message. */
const nameOf = (n: number, char = 'a'): string => char.repeat(n);

describe('the single subject that renders nothing (FR-027)', () => {
  it('renders the empty string for { kind: none }', () => {
    expect(formatSubject({ kind: 'none' })).toBe('');
  });

  it('renders the empty string for { kind: none } whatever context it is given', () => {
    expect(formatSubject({ kind: 'none' }, { project: 'Alpha', tab: 'Work' })).toBe('');
  });
});

describe('every union member renders (FR-024)', () => {
  it('renders a file, with its folder when there is one', () => {
    expect(formatSubject({ kind: 'file', name: 'notes.txt' })).toBe('notes.txt');
    expect(formatSubject({ kind: 'file', name: 'notes.txt', dir: 'docs' })).toBe('docs — notes.txt');
  });

  it('renders a folder', () => {
    expect(formatSubject({ kind: 'folder', name: 'src' })).toBe('src');
    expect(formatSubject({ kind: 'folder', name: 'src', dir: 'app' })).toBe('app — src');
  });

  it('renders a project', () => {
    expect(formatSubject({ kind: 'project', name: 'Alpha' })).toBe('Alpha');
  });

  /*
   * `pane` is in the union because FR-024 fixes the workspace's own vocabulary and Pane is one of
   * its words — the Projects and File Explorer panes both raise notices, and without this member
   * they would have to describe themselves as something they are not.
   */
  it('renders a pane', () => {
    expect(formatSubject({ kind: 'pane', name: 'File Explorer' })).toBe('File Explorer');
  });

  it('renders a tab, qualified by its project', () => {
    expect(formatSubject({ kind: 'tab', name: 'Work' })).toBe('Work');
    expect(formatSubject({ kind: 'tab', name: 'Work', project: 'Alpha' })).toBe('Alpha — Work');
  });

  it('renders a full panel as Project — Tab — Panel (FR-022)', () => {
    expect(formatSubject({ kind: 'panel', name: 'server.ts', tab: 'Work', project: 'Alpha' })).toBe(
      'Alpha — Work — server.ts',
    );
  });

  it('renders a panel type', () => {
    expect(formatSubject({ kind: 'panelType', name: 'Terminal' })).toBe('Terminal');
  });

  it('renders a terminal by its flavour, qualified by where it is', () => {
    expect(formatSubject({ kind: 'terminal', flavour: 'PowerShell' })).toBe('PowerShell');
    expect(
      formatSubject({
        kind: 'terminal',
        flavour: 'PowerShell',
        panel: 'Build',
        tab: 'Work',
        project: 'Alpha',
      }),
    ).toBe('Alpha — Work — Build — PowerShell');
  });

  it('renders a sub-workspace', () => {
    expect(formatSubject({ kind: 'subWorkspace', name: 'Notes' })).toBe('Notes');
  });

  /*
   * There is deliberately NO `panelTitle` member. "Panel Title" is prose vocabulary — the word a
   * message uses when it talks ABOUT a panel's title — and the thing such a notice is about is the
   * Panel, whose `name` IS its title. A tenth-and-a-half kind would give two ways to say one thing.
   */
  it('has exactly ten kinds, and panelTitle is not one of them', () => {
    /*
     * `SUBJECT_KINDS` is typed `readonly NoticeSubject['kind'][]`, so adding a member to the union
     * without adding it here is a compile error, and adding `panelTitle` here without adding it to
     * the union is the same. That is what keeps this a real assertion rather than a copy of the
     * union that drifts.
     */
    expect([...SUBJECT_KINDS].sort()).toEqual(
      [
        'none',
        'file',
        'folder',
        'project',
        'pane',
        'tab',
        'panel',
        'panelType',
        'terminal',
        'subWorkspace',
      ].sort(),
    );
    expect(SUBJECT_KINDS).not.toContain('panelTitle');
  });

  it('renders something for every kind in the set, so no member is unreachable', () => {
    const sample: Record<NoticeSubject['kind'], NoticeSubject> = {
      none: { kind: 'none' },
      file: { kind: 'file', name: 'notes.txt' },
      folder: { kind: 'folder', name: 'src' },
      project: { kind: 'project', name: 'Alpha' },
      pane: { kind: 'pane', name: 'File Explorer' },
      tab: { kind: 'tab', name: 'Work' },
      panel: { kind: 'panel', name: 'Build' },
      panelType: { kind: 'panelType', name: 'Terminal' },
      terminal: { kind: 'terminal', flavour: 'bash' },
      subWorkspace: { kind: 'subWorkspace', name: 'Notes' },
    };
    for (const kind of SUBJECT_KINDS) {
      const rendered = formatSubject(sample[kind]);
      expect(typeof rendered).toBe('string');
      expect(rendered === '').toBe(kind === 'none');
    }
  });
});

describe('absent parts leave no dangling separators (Edge Cases)', () => {
  it('omits a missing middle part rather than joining an empty one', () => {
    expect(formatSubject({ kind: 'panel', name: 'server.ts', project: 'Alpha' })).toBe(
      'Alpha — server.ts',
    );
    expect(formatSubject({ kind: 'panel', name: 'server.ts', tab: 'Work' })).toBe('Work — server.ts');
  });

  it('treats an empty or whitespace-only part as absent', () => {
    expect(formatSubject({ kind: 'panel', name: 'server.ts', tab: '', project: '   ' })).toBe(
      'server.ts',
    );
  });

  it('never starts or ends with the separator', () => {
    const rendered = formatSubject({ kind: 'terminal', flavour: 'bash', tab: '', project: 'Alpha' });
    expect(rendered).toBe('Alpha — bash');
    expect(rendered.startsWith(SUBJECT_SEPARATOR)).toBe(false);
    expect(rendered.endsWith(SUBJECT_SEPARATOR)).toBe(false);
  });

  it('renders the empty string when every part is empty, rather than a bare separator', () => {
    expect(formatSubject({ kind: 'panel', name: '', tab: '', project: '' })).toBe('');
  });

  it('trims the parts it does render', () => {
    expect(formatSubject({ kind: 'file', name: '  notes.txt  ', dir: ' docs ' })).toBe(
      'docs — notes.txt',
    );
  });
});

describe('context elision — omitted, never re-spelled (FR-022a)', () => {
  it('omits the project and tab the surrounding UI already states', () => {
    const row: NoticeSubject = { kind: 'panel', name: 'server.ts', tab: 'Work', project: 'Alpha' };
    expect(formatSubject(row, { project: 'Alpha', tab: 'Work' })).toBe('server.ts');
  });

  it('omits only the parts the context actually states', () => {
    const row: NoticeSubject = { kind: 'panel', name: 'server.ts', tab: 'Work', project: 'Alpha' };
    expect(formatSubject(row, { project: 'Alpha' })).toBe('Work — server.ts');
    expect(formatSubject(row, { tab: 'Work' })).toBe('Alpha — server.ts');
  });

  it('keeps a part the context states DIFFERENTLY — that is a different thing, not a repetition', () => {
    const row: NoticeSubject = { kind: 'panel', name: 'server.ts', tab: 'Work', project: 'Alpha' };
    expect(formatSubject(row, { project: 'Bravo' })).toBe('Alpha — Work — server.ts');
  });

  it('never elides the subject own name, however the context is set', () => {
    expect(formatSubject({ kind: 'project', name: 'Alpha' }, { project: 'Alpha' })).toBe('Alpha');
    expect(formatSubject({ kind: 'tab', name: 'Work', project: 'Alpha' }, { tab: 'Work' })).toBe(
      'Alpha — Work',
    );
  });

  it('elides a terminal panel and folder context too — one rule for every qualifier', () => {
    expect(
      formatSubject(
        { kind: 'terminal', flavour: 'bash', panel: 'Build', tab: 'Work', project: 'Alpha' },
        { project: 'Alpha', tab: 'Work', panel: 'Build' },
      ),
    ).toBe('bash');
    expect(formatSubject({ kind: 'file', name: 'notes.txt', dir: 'docs' }, { dir: 'docs' })).toBe(
      'notes.txt',
    );
  });

  it('ignores a context part the subject does not carry', () => {
    expect(formatSubject({ kind: 'project', name: 'Alpha' }, { tab: 'Work', panel: 'Build' })).toBe(
      'Alpha',
    );
  });
});

describe('truncation — 48 characters PER PART, and nowhere else (FR-021)', () => {
  it('leaves a name of exactly the bound alone', () => {
    expect(SUBJECT_NAME_MAX).toBe(48);
    const name = nameOf(48);
    expect(formatSubject({ kind: 'project', name })).toBe(name);
  });

  it('truncates one character over the bound, the ellipsis replacing the final character', () => {
    const rendered = formatSubject({ kind: 'project', name: nameOf(49) });
    expect(rendered).toBe(`${nameOf(47)}…`);
    expect([...rendered]).toHaveLength(48);
  });

  it('truncates EVERY part independently, never the joined string', () => {
    const rendered = formatSubject({
      kind: 'panel',
      name: nameOf(60, 'p'),
      tab: nameOf(60, 't'),
      project: nameOf(60, 'r'),
    });
    const parts = rendered.split(SUBJECT_SEPARATOR);
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect([...part]).toHaveLength(48);
      expect(part.endsWith('…')).toBe(true);
    }
    // The panel name — the part that matters most — survives a long project name intact.
    expect(parts[2].startsWith('p')).toBe(true);
  });

  /*
   * The joined string is long, and that is CORRECT. Truncating it would lose the panel name because
   * the project name was long, which is the exact opposite of the point.
   */
  it('does not truncate the joined string, however long three truncated parts add up to', () => {
    const rendered = formatSubject({
      kind: 'panel',
      name: nameOf(60, 'p'),
      tab: nameOf(60, 't'),
      project: nameOf(60, 'r'),
    });
    expect(rendered.length).toBeGreaterThan(SUBJECT_NAME_MAX);
    expect(rendered.endsWith('…')).toBe(true);
  });

  it('truncates a terminal flavour and a file folder by the same rule', () => {
    expect(formatSubject({ kind: 'terminal', flavour: nameOf(50) })).toBe(`${nameOf(47)}…`);
    expect(formatSubject({ kind: 'file', name: 'notes.txt', dir: nameOf(50) })).toBe(
      `${nameOf(47)}… — notes.txt`,
    );
  });

  it('compares the context against the RAW part, so elision survives truncation', () => {
    const long = nameOf(60, 'r');
    expect(formatSubject({ kind: 'tab', name: 'Work', project: long }, { project: long })).toBe(
      'Work',
    );
  });

  it('measures in characters, never splitting an astral character into a lone surrogate', () => {
    const rendered = formatSubject({ kind: 'project', name: '🦊'.repeat(50) });
    expect([...rendered]).toHaveLength(48);
    expect(rendered).toBe(`${'🦊'.repeat(47)}…`);
    // A lone high surrogate would be a broken glyph in the toast.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(rendered)).toBe(false);
  });
});

describe('two failures about one subject read identically (FR-021)', () => {
  it('renders the same string for the same subject, whoever raised it', () => {
    const a: NoticeSubject = { kind: 'panel', name: 'server.ts', tab: 'Work', project: 'Alpha' };
    const b: NoticeSubject = { kind: 'panel', name: 'server.ts', tab: 'Work', project: 'Alpha' };
    expect(formatSubject(a)).toBe(formatSubject(b));
  });
});
