import { describe, it, expect } from 'vitest';
import { parseWikilink, wikiCandidates, wikiDisplayText } from '../../src/preview/wiki-links.js';
import type { WikiTarget } from '../../src/preview/wiki-links.js';

/**
 * 047 T059 (data-model.md "WikiTarget", research R12, FR-050 – FR-056) — `[[Target]]` and its
 * variants. `parseWikilink` reads the text BETWEEN the double brackets (the pipeline strips them
 * before calling this); `wikiCandidates` turns a parsed target into the ordered absolute paths
 * FR-052c names, resolving exactly as an ordinary relative/rooted link does (`path-resolve.ts`).
 */

describe('parseWikilink — the grammar (FR-050, FR-056)', () => {
  it('[[Note]] — a bare target, no alias, no fragment', () => {
    expect(parseWikilink('Note')).toEqual<WikiTarget>({ path: 'Note', rooted: false, fragment: null, alias: null });
  });

  it('[[Note|Alias]] — target and alias', () => {
    expect(parseWikilink('Note|Alias')).toEqual<WikiTarget>({
      path: 'Note',
      rooted: false,
      fragment: null,
      alias: 'Alias',
    });
  });

  it('[[Note#Heading]] — target and fragment', () => {
    expect(parseWikilink('Note#Heading')).toEqual<WikiTarget>({
      path: 'Note',
      rooted: false,
      fragment: 'Heading',
      alias: null,
    });
  });

  it('[[#Heading]] — same-document heading, empty path', () => {
    expect(parseWikilink('#Heading')).toEqual<WikiTarget>({
      path: '',
      rooted: false,
      fragment: 'Heading',
      alias: null,
    });
  });

  it('[[Note#^block]] — the block id is DROPPED, fragment is null (FR-056)', () => {
    expect(parseWikilink('Note#^block')).toEqual<WikiTarget>({
      path: 'Note',
      rooted: false,
      fragment: null,
      alias: null,
    });
  });

  it('[[/docs/README]] — a leading / is rooted, and stripped from path', () => {
    expect(parseWikilink('/docs/README')).toEqual<WikiTarget>({
      path: 'docs/README',
      rooted: true,
      fragment: null,
      alias: null,
    });
  });

  it('[[../README]] — an ordinary relative climb, not rooted', () => {
    expect(parseWikilink('../README')).toEqual<WikiTarget>({
      path: '../README',
      rooted: false,
      fragment: null,
      alias: null,
    });
  });

  it('a target and alias and fragment together', () => {
    expect(parseWikilink('Note#Heading|Shown Text')).toEqual<WikiTarget>({
      path: 'Note',
      rooted: false,
      fragment: 'Heading',
      alias: 'Shown Text',
    });
  });

  it.each(['', '   ', '|Alias', '|'])('%j is malformed — null (no path and no fragment)', (inner) => {
    expect(parseWikilink(inner)).toBeNull();
  });
});

describe('wikiCandidates — FR-052c ordering', () => {
  const win = { docDir: 'C:\\proj\\docs', projectRoot: 'C:\\proj' as string | null };

  it('no extension: path+.md, path+.markdown, then path exactly, relative to the document folder', () => {
    expect(wikiCandidates({ path: 'Note', rooted: false, fragment: null, alias: null }, win.docDir, win.projectRoot)).toEqual([
      'C:\\proj\\docs\\Note.md',
      'C:\\proj\\docs\\Note.markdown',
      'C:\\proj\\docs\\Note',
      'C:\\proj\\Note.md',
      'C:\\proj\\Note.markdown',
      'C:\\proj\\Note',
    ]);
  });

  it('an explicit extension matches ONLY that exact file, in the document folder then the root', () => {
    expect(
      wikiCandidates({ path: 'Note.txt', rooted: false, fragment: null, alias: null }, win.docDir, win.projectRoot),
    ).toEqual(['C:\\proj\\docs\\Note.txt', 'C:\\proj\\Note.txt']);
  });

  it('rooted resolves from the PROJECT root, not the document folder', () => {
    expect(
      wikiCandidates({ path: 'docs/README', rooted: true, fragment: null, alias: null }, win.docDir, win.projectRoot),
    ).toEqual(['C:\\proj\\docs\\README.md', 'C:\\proj\\docs\\README.markdown', 'C:\\proj\\docs\\README']);
  });

  it('rooted with NO project root is unresolved — [] (FR-052b)', () => {
    expect(
      wikiCandidates({ path: 'README', rooted: true, fragment: null, alias: null }, win.docDir, null),
    ).toEqual([]);
  });

  it('a sub-folder target climbs and descends relative to the document folder', () => {
    expect(
      wikiCandidates({ path: '../sibling/Note', rooted: false, fragment: null, alias: null }, win.docDir, win.projectRoot),
    ).toEqual([
      'C:\\proj\\sibling\\Note.md',
      'C:\\proj\\sibling\\Note.markdown',
      'C:\\proj\\sibling\\Note',
    ]);
  });

  it('068 FR-001: a vault-root target follows the document-folder candidates with the same from the root', () => {
    expect(
      wikiCandidates(
        { path: 'folder/sub/Target', rooted: false, fragment: null, alias: null },
        'C:\\proj\\folder\\sub',
        'C:\\proj',
      ),
    ).toEqual([
      'C:\\proj\\folder\\sub\\folder\\sub\\Target.md',
      'C:\\proj\\folder\\sub\\folder\\sub\\Target.markdown',
      'C:\\proj\\folder\\sub\\folder\\sub\\Target',
      'C:\\proj\\folder\\sub\\Target.md',
      'C:\\proj\\folder\\sub\\Target.markdown',
      'C:\\proj\\folder\\sub\\Target',
    ]);
  });

  it('068 FR-001: a null project root lists the document folder only', () => {
    expect(wikiCandidates({ path: 'Note.txt', rooted: false, fragment: null, alias: null }, win.docDir, null)).toEqual([
      'C:\\proj\\docs\\Note.txt',
    ]);
  });

  it('068 FR-001: a document folder equal to the root lists each candidate once', () => {
    expect(
      wikiCandidates({ path: 'Note.txt', rooted: false, fragment: null, alias: null }, 'C:\\proj', 'C:\\proj'),
    ).toEqual(['C:\\proj\\Note.txt']);
  });

  it('an empty path (a same-document [[#Heading]] target) has no file candidates', () => {
    expect(wikiCandidates({ path: '', rooted: false, fragment: 'Heading', alias: null }, win.docDir, win.projectRoot)).toEqual(
      [],
    );
  });

  it('resolves posix-separated projects the same way', () => {
    expect(
      wikiCandidates(
        { path: 'Note', rooted: false, fragment: null, alias: null },
        '/home/u/proj/docs',
        '/home/u/proj',
      ),
    ).toEqual([
      '/home/u/proj/docs/Note.md',
      '/home/u/proj/docs/Note.markdown',
      '/home/u/proj/docs/Note',
      '/home/u/proj/Note.md',
      '/home/u/proj/Note.markdown',
      '/home/u/proj/Note',
    ]);
  });
});

describe('wikiDisplayText — 068 FR-004/FR-005', () => {
  it('reads folder/sub/Target#Some Heading with no escapes', () => {
    expect(wikiDisplayText({ path: 'folder/sub/Target', rooted: false, fragment: 'Some Heading', alias: null })).toBe(
      'folder/sub/Target#Some Heading',
    );
  });
  it('keeps the leading slash of a rooted target', () => {
    expect(wikiDisplayText({ path: 'x/Y', rooted: true, fragment: null, alias: null })).toBe('/x/Y');
  });
});
