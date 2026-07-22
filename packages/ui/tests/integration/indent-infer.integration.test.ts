/**
 * Opening a document NEVER touches it (016, FR-018d · T074).
 *
 * This is the requirement most likely to be broken silently, and the most damaging when it is. The
 * editor reads a file's indentation so it knows what the NEXT indent should insert — and the failure
 * mode is that it "helpfully" normalises the file to match, or marks it dirty for having an opinion
 * about it. Either way the user opens twelve files to read them, closes the app, and finds twelve
 * files changed in their diff.
 *
 * So: inference DECIDES, it does not EDIT. Opening a file must leave every byte of it alone, leave
 * the document clean, and leave the version where it started.
 */
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  effectiveIndent,
  inferIndent,
  indentUnitOf,
  type IndentProfile,
} from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;

const meta = (absPath: string): DocMeta => ({
  panelId: 'p1',
  windowId: 'w1',
  ownerKind: 'project',
  ownerProjectId: 'A',
  ownerRoot: root,
  allProjectRoots: [root],
  tabId: 't1',
  absPath,
  encoding: 'utf8',
  hasBom: false,
  lineEnding: 'lf',
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-indent-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-indent-rec-'));
  coord = new EditorCoordinator(
    new EditorService(fs, () => DEFAULT_APP_SETTINGS),
    new EditorRecovery(recoveryDir),
    { recoveryDebounceMs: 10, relaySync: () => {}, persistUndoHistory: () => true },
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** A file whose indentation disagrees with every default this app ships with. */
const TAB_INDENTED = 'function a() {\n\tif (x) {\n\t\treturn 1;\n\t}\n}\n';
/** …and one indented four spaces, where the global default says two. */
const FOUR_SPACE = 'def a():\n    if x:\n        return 1\n';

describe('opening a document never modifies it (FR-018d)', () => {
  it('leaves the FILE byte-for-byte identical, whatever its indentation', async () => {
    const file = join(root, 'tabs.ts');
    await writeFile(file, TAB_INDENTED);

    const loaded = await coord.load(meta(file));
    expect(loaded.ok).toBe(true);

    // The buffer holds exactly what the file holds. Not a normalised copy of it.
    expect(coord.getContent('p1')?.text).toBe(TAB_INDENTED);
    expect(await readFile(file, 'utf8')).toBe(TAB_INDENTED);
  });

  it('leaves the document CLEAN — reading a file’s style is not an edit to it', async () => {
    // The subtler half. A document marked dirty merely by being opened would prompt to save on
    // close, and a user who said yes would rewrite a file they only ever looked at.
    const file = join(root, 'four.py');
    await writeFile(file, FOUR_SPACE);

    await coord.load(meta(file));

    expect(coord.getContent('p1')?.dirty).toBe(false);
    expect(coord.getContent('p1')?.version).toBe(0); // …not one edit has been applied
  });

  it('does not touch a MIXED file, however much it might like to', async () => {
    // A file that mixes tabs and spaces is not an invitation to fix it (FR-023b). It is somebody
    // else's file, and it may well be that way on purpose.
    const mixed = 'a\n\tb\n    c\n\td\n';
    const file = join(root, 'mixed.txt');
    await writeFile(file, mixed);

    await coord.load(meta(file));

    expect(coord.getContent('p1')?.text).toBe(mixed);
    expect(coord.getContent('p1')?.dirty).toBe(false);
  });
});

describe('what the file does OUTRANKS what the settings say (FR-018a)', () => {
  const settings = DEFAULT_APP_SETTINGS.editor;

  it('indents a TAB-indented TypeScript file with a tab, though the setting says spaces', () => {
    // TypeScript's shipped profile is spaces, and so is the global default. The file disagrees with
    // both, and the file wins — otherwise the next Tab this user presses puts spaces into a
    // tab-indented file, and nothing in the app will ever tell them.
    expect(settings.indent.style).toBe('spaces');

    const inferred = inferIndent(TAB_INDENTED);
    expect(inferred).toEqual({ style: 'tabs' });

    const effective: IndentProfile = effectiveIndent({
      inferred,
      languageId: 'typescript',
      settings,
    });
    expect(effective.style).toBe('tabs');
    expect(indentUnitOf(effective)).toBe('\t');
    // …and `tabWidth` still comes from the settings: how wide a tab is DRAWN is a display
    // preference the file cannot express (FR-018e).
    expect(effective.tabWidth).toBe(settings.indentByLanguage.typescript?.tabWidth ?? 4);
  });

  it('indents a 4-space file with 4 spaces, though the global default is 2', () => {
    expect(settings.indent.indentWidth).toBe(2);

    const inferred = inferIndent(FOUR_SPACE);
    expect(inferred).toEqual({ style: 'spaces', width: 4 });

    const effective = effectiveIndent({ inferred, languageId: 'python', settings });
    expect(indentUnitOf(effective)).toBe('    ');
  });

  it('reads a SHORT file — the bound caps work, it does not sample a fraction', () => {
    // The bug this test was written for. Sampling `10% of lines` meant a five-line file read ONE
    // line — its unindented opening — inferred nothing, fell through to the settings, and had the
    // wrong style poured into it on the very next Tab. Nearly every source file under fifty lines
    // was affected.
    expect(TAB_INDENTED.split('\n').length).toBeLessThan(10);
    expect(inferIndent(TAB_INDENTED)).toEqual({ style: 'tabs' });

    const tiny = 'a:\n  b\n';
    expect(inferIndent(tiny)).toEqual({ style: 'spaces', width: 2 });
  });

  it('falls back to the LANGUAGE when the file has no indentation to read', () => {
    // A brand-new or single-line Go file says nothing about how it indents. Go does.
    const inferred = inferIndent('package main\n');
    expect(inferred).toBeNull();

    const effective = effectiveIndent({ inferred, languageId: 'go', settings });
    expect(effective.style).toBe('tabs'); // …Go's convention, from the registry
    expect(indentUnitOf(effective)).toBe('\t');
  });

  it('falls back to the GLOBAL default when neither the file nor the language has an opinion', () => {
    // A language with no registered indent convention (json ships none) — with nothing inferred it
    // falls all the way through to the global default. (Plain text now DOES carry a convention of its
    // own, four spaces, so it is no longer the opinion-less case — see below.)
    const effective = effectiveIndent({ inferred: null, languageId: 'json', settings });
    expect(effective).toEqual(settings.indent);
    expect(indentUnitOf(effective)).toBe('  ');
  });

  it('plain text carries its own four-space convention', () => {
    const effective = effectiveIndent({ inferred: null, languageId: 'plaintext', settings });
    expect(effective).toEqual({ style: 'spaces', indentWidth: 4, tabWidth: 4 });
    expect(indentUnitOf(effective)).toBe('    ');
  });
});
