/**
 * 006's text fidelity MUST survive this feature (016, FR-023 · T113).
 *
 * Highlighting, indentation, the content menu and column editing all reach into the buffer. None of
 * them is allowed to change what a save WRITES: a CRLF file stays CRLF, a BOM survives, and a file
 * the user only indented does not come back with every line ending rewritten.
 *
 * This is a REGRESSION guard, and it is worth its keep precisely because nothing about the features
 * above looks like it touches encoding. That is how fidelity gets lost: not by someone deciding to
 * normalise a file, but by an editor that quietly holds LF, and a save that quietly writes what it
 * holds.
 */
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChangeSet } from '@codemirror/state';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
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

/** Edit the open document the way a view does — a ChangeSet, through the authority. */
function edit(spec: { from: number; to?: number; insert?: string }): void {
  const current = coord.getContent('p1')!;
  coord.dispatchChange(meta(current.absPath!), {
    documentId: 'p1',
    viewId: 'view-1',
    changes: ChangeSet.of(spec, current.text.length).toJSON(),
    baseVersion: current.version,
    selectionBefore: null,
    mergeClass: null,
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-fidelity-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-fidelity-rec-'));
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

describe('a CRLF file stays a CRLF file (FR-023)', () => {
  it('writes CRLF back after an INDENT — every line, not just the edited one', async () => {
    // The failure this catches: the buffer is LF internally (the fidelity model normalises on read
    // and re-applies on write), so an editor that saved what it HOLDS would silently convert the
    // whole file to LF the first time anyone pressed Tab in it. The diff would show every line
    // changed, for a one-line edit.
    const file = join(root, 'crlf.ts');
    await writeFile(file, 'function a() {\r\n\treturn 1;\r\n}\r\n', 'utf8');

    await coord.load(meta(file));
    // …an indent, exactly as `indent-lines` would apply it.
    edit({ from: 0, insert: '\t' });
    const saved = await coord.save({ panelId: 'p1' });
    expect(saved.ok).toBe(true);

    const onDisk = await readFile(file, 'utf8');
    expect(onDisk).toBe('\tfunction a() {\r\n\treturn 1;\r\n}\r\n');
    expect(onDisk).not.toContain('\n\n'); // …no stray bare LF anywhere
  });

  it('writes CRLF back after a CUT, which removes a line and its ending', async () => {
    const file = join(root, 'cut.txt');
    await writeFile(file, 'one\r\ntwo\r\nthree\r\n', 'utf8');

    await coord.load(meta(file));
    // The buffer is LF, so `cut-line` computes its offsets against "one\ntwo\nthree\n".
    edit({ from: 4, to: 8 }); // …removes "two\n"
    await coord.save({ panelId: 'p1' });

    expect(await readFile(file, 'utf8')).toBe('one\r\nthree\r\n');
  });
});

describe('an LF file stays an LF file', () => {
  it('does not acquire CRLF from a paste of CRLF text (FR-023a)', async () => {
    // Text pasted from another application arrives with ITS line endings. Inserting those verbatim
    // would make the file MIXED — half LF, half CRLF — which no test of the pasted region alone
    // would notice, and which every reviewer would.
    const file = join(root, 'lf.txt');
    await writeFile(file, 'a\nb\n', 'utf8');

    await coord.load(meta(file));
    // The paste path normalises to the buffer's LF before it ever reaches the authority, so what is
    // dispatched here is what the view would dispatch.
    edit({ from: 4, insert: 'pasted\nlines\n' });
    await coord.save({ panelId: 'p1' });

    const onDisk = await readFile(file, 'utf8');
    expect(onDisk).toBe('a\nb\npasted\nlines\n');
    expect(onDisk).not.toContain('\r'); // …not one carriage return
  });
});

describe('a BOM survives (FR-023)', () => {
  it('is still there after the document has been edited and saved', async () => {
    const file = join(root, 'bom.txt');
    await writeFile(file, '﻿hello\n', 'utf8');

    const loaded = await coord.load(meta(file));
    expect(loaded.ok && loaded.hasBom).toBe(true);
    // The BOM is metadata, not content — the buffer must not contain it.
    expect(coord.getContent('p1')?.text).toBe('hello\n');

    edit({ from: 5, insert: ' world' });
    await coord.save({ panelId: 'p1' });

    const bytes = await readFile(file);
    expect(bytes[0]).toBe(0xef); // …the BOM, byte for byte
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    expect(bytes.toString('utf8')).toBe('﻿hello world\n');
  });
});

describe('the authority does not normalise what it is given', () => {
  it('preserves a file with NO trailing newline — it does not add one', async () => {
    // An editor that "helpfully" terminates the last line changes a file the user only read.
    const file = join(root, 'noeol.txt');
    await writeFile(file, 'no trailing newline', 'utf8');

    await coord.load(meta(file));
    expect(coord.getContent('p1')?.text).toBe('no trailing newline');

    await coord.save({ panelId: 'p1' });
    expect(await readFile(file, 'utf8')).toBe('no trailing newline');
  });
});
