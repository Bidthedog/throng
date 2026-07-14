/**
 * The persisted undo history (016, FR-027a/FR-027b/FR-027c · T088-T090, T112).
 *
 * ## Why this file is about SECURITY as much as convenience
 *
 * The persisted history contains text the user **cut or deleted**. Cut an API key out of a config
 * file and the file on disk is clean — but the undo stack still holds the key, because that is what
 * an undo stack IS. Persisting that stack writes the key back to disk, in a file the user has never
 * heard of, and every question that follows is about its LIFETIME: how long does it live, who
 * deletes it, and can it outlive the document it came from?
 *
 * The design answers that structurally rather than carefully: the history lives INSIDE the recovery
 * snapshot, not in a file beside it. One file is one lifetime. Whatever removes the snapshot — a
 * save, a close, a discard after recovery — removes the history in the same act, and there is no
 * second file for a future maintainer to forget. These tests hold that line.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { editDocument } from './helpers/edit-document.js';

const fs = new NodeFileSystem(async () => {});
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let root: string;
let recoveryDir: string;

function makeCoordinator(persistUndoHistory = true): EditorCoordinator {
  const service = new EditorService(fs, () => DEFAULT_APP_SETTINGS);
  return new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10,
    relaySync: () => {},
    persistUndoHistory: () => persistUndoHistory,
  });
}

function meta(panelId: string, absPath: string | null): DocMeta {
  return {
    panelId,
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
  };
}

/** Everything the recovery directory currently holds, as raw bytes. */
async function recoveryFiles(): Promise<string[]> {
  const names = await readdir(recoveryDir).catch(() => [] as string[]);
  return Promise.all(names.map((n) => readFile(join(recoveryDir, n), 'utf8')));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-hist-root-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-hist-dir-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('the snapshot is structured, and tolerant of the one that came before it (T088)', () => {
  it('reads a LEGACY plain-text snapshot rather than discarding it', async () => {
    // An in-flight snapshot is, by definition, work the user has not saved. Losing it because they
    // upgraded throng would be losing exactly what this component exists to protect.
    await writeFile(join(recoveryDir, 'p1'), 'in progress, from the old build', 'utf8');

    const recovered = await makeCoordinator().recover();

    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ panelId: 'p1', text: 'in progress, from the old build' });
  });

  it('writes JSON carrying the version, the text and the history', async () => {
    const coord = makeCoordinator();
    coord.register(meta('p1', null), '');
    editDocument(coord, meta('p1', null), 'secret');
    await wait(40);

    const [raw] = await recoveryFiles();
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(parsed.text).toBe('secret');
    expect(parsed.version).toBe(1);
    expect(parsed.history).toBeDefined();
  });
});

describe('a TORN snapshot is refused, never read as the document (review finding C1)', () => {
  it('does not hand a half-written snapshot back as the document’s text', async () => {
    // The write lands on a 400 ms debounce while the user types, so "the process died mid-write" is
    // not exotic here — it is the case the whole module exists for. A torn write leaves a JSON
    // PREFIX on disk.
    //
    // Reading that back as plain text (which the legacy fallback would happily do) puts a buffer
    // full of escaped JSON in front of the user, marked dirty — and their next Ctrl+S writes it over
    // their source file. The old plain-text format could only lose the TAIL of a torn write; the
    // structured format turns the same truncation into CORRUPTION unless it is recognised.
    const torn = String.raw`{"throngRecovery":1,"version":42,"text":"import foo\nconst key = \"AK`;
    await writeFile(join(recoveryDir, 'p1'), torn, 'utf8');

    const recovered = await makeCoordinator().recover();

    expect(recovered).toEqual([]); // …refused, not offered
  });

  it('does not treat a snapshot with no text field as an EMPTY document', async () => {
    // Returning '' here would blank a real file's buffer and mark it dirty.
    await writeFile(join(recoveryDir, 'p1'), '{"throngRecovery":1,"version":9}', 'utf8');
    expect(await makeCoordinator().recover()).toEqual([]);
  });

  it('writes ATOMICALLY, so a reader never sees half a snapshot', async () => {
    // Written to a temp file and RENAMED over the real one. A crash-recovery file that can itself be
    // destroyed by a crash is not much of a recovery file.
    const coord = makeCoordinator();
    coord.register(meta('p1', null), '');
    editDocument(coord, meta('p1', null), 'content');
    await wait(40);

    // No .tmp is left behind, and the one file present parses.
    const names = await readdir(recoveryDir);
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect(names).toHaveLength(1);
    expect(JSON.parse((await recoveryFiles())[0]).text).toBe('content');
  });
});

describe('the history survives a crash, and the toggle governs only that (T089/T090)', () => {
  it('restores the undo history alongside the content, so Ctrl+Z still reaches the past', async () => {
    // Two edits, so there is a past worth restoring.
    const s1 = makeCoordinator();
    s1.register(meta('p1', null), '');
    editDocument(s1, meta('p1', null), 'one');
    editDocument(s1, meta('p1', null), 'one two');
    await wait(40);

    // Relaunch: a fresh coordinator, the same recovery directory.
    const s2 = makeCoordinator();
    const [recovered] = await s2.recover();
    expect(recovered.text).toBe('one two');

    s2.register(meta('p1', null), '');
    s2.restoreRecovered('p1', recovered.text, recovered.history);
    expect(s2.getContent('p1')?.text).toBe('one two');

    // …and the PAST came back with it. This is the whole of FR-027a: without the history the
    // document recovers as an island — the right text, and nothing behind it — so the user's very
    // first Ctrl+Z after a crash does nothing at all.
    s2.undo('p1', 'view-1');
    expect(s2.getContent('p1')?.text).toBe('one');
  });

  it('with the toggle OFF, the content still recovers in full — only the history is absent', async () => {
    const coord = makeCoordinator(false);
    coord.register(meta('p1', null), '');
    editDocument(coord, meta('p1', null), 'work in progress');
    await wait(40);

    const [raw] = await recoveryFiles();
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // FR-027c is explicit that a crash with the toggle off still recovers the DOCUMENT. Turning off
    // the history must not turn off recovery.
    expect(parsed.text).toBe('work in progress');
    expect(parsed.history).toBeUndefined();
  });

  it('PURGES a history already on disk the moment the toggle goes off (FR-027c)', async () => {
    // Waiting for the next keystroke to overwrite the snapshot would leave the user's cut text there
    // for as long as they left the document alone — and someone who has just turned this off because
    // they cut a secret into a file is the last person who should have to keep typing to be rid of it.
    const on = makeCoordinator(true);
    on.register(meta('p1', null), '');
    editDocument(on, meta('p1', null), 'SECRET-KEY');
    await wait(40);
    expect((await recoveryFiles())[0]).toContain('history');

    await makeCoordinator(false).purgePersistedHistories();

    const [raw] = await recoveryFiles();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.history).toBeUndefined();
    // …and the CONTENT is still there. A purge is not a delete.
    expect(parsed.text).toBe('SECRET-KEY');
  });
});

describe('what a restore hands the views (T091 · FR-027)', () => {
  it('broadcasts the RECOVERED content — so indentation is inferred from it, not the disk copy', async () => {
    // The disk copy is stale BY DEFINITION — that is why recovery exists. A file converted from
    // tabs to spaces just before the crash is still tab-indented on disk, so a view that inferred
    // its indentation from the disk copy would go straight back to inserting tabs into a file the
    // user had just finished converting — one keystroke at a time, invisibly (FR-018a/FR-018d).
    //
    // The renderer infers from the text the RESET carries (`reinferIndent(reset.text)`), so what
    // this has to prove is that the reset carries the recovered content and never the disk's.
    const file = join(root, 'converted.py');
    await writeFile(file, '\tif x:\n\t\treturn 1\n', 'utf8'); // …tabs, on disk

    const sent: { text: string }[] = [];
    const service = new EditorService(fs, () => DEFAULT_APP_SETTINGS);
    const coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
      recoveryDebounceMs: 10,
      relaySync: (_id, msg) => {
        if (msg.reset) sent.push({ text: msg.reset.text });
      },
      persistUndoHistory: () => true,
    });

    await coord.load(meta('p1', file));
    const spaces = '    if x:\n        return 1\n'; // …the user converted it, then throng died
    coord.restoreRecovered('p1', spaces);

    const reset = sent.at(-1);
    expect(reset?.text).toBe(spaces);
    expect(reset?.text).not.toContain('\t');
  });
});

describe('the history’s lifetime NEVER exceeds the snapshot’s (T112 · FR-027b)', () => {
  it('is deleted on a normal close, with the document’s content', async () => {
    const coord = makeCoordinator();
    coord.register(meta('p1', null), '');
    editDocument(coord, meta('p1', null), 'API_KEY=hunter2');
    await wait(40);
    expect(await recoveryFiles()).toHaveLength(1);

    coord.destroy('p1');
    await wait(40);

    // Nothing survives — not the text, and not the history that held what was cut out of it.
    expect(await recoveryFiles()).toEqual([]);
  });

  it('is deleted on a successful SAVE — the moment the disk holds the document', async () => {
    const file = join(root, 'doc.txt');
    await writeFile(file, 'seed\n', 'utf8');

    const coord = makeCoordinator();
    coord.register(meta('p1', file), 'seed\n');
    editDocument(coord, meta('p1', file), 'API_KEY=hunter2\n');
    await wait(40);
    expect(await recoveryFiles()).toHaveLength(1);

    await coord.save({ panelId: 'p1' });
    await wait(40);

    expect(await recoveryFiles()).toEqual([]);
  });

  it('is written ONLY to the snapshot’s own protected directory — nowhere else', async () => {
    // The exposure is bounded by there being exactly ONE file. If a second copy of the history were
    // ever written — a log line, a diagnostic dump, a debug trace — deleting the snapshot would stop
    // being enough, and every test above would still pass.
    const coord = makeCoordinator();
    coord.register(meta('p1', null), '');
    editDocument(coord, meta('p1', null), 'API_KEY=hunter2');
    await wait(40);

    // Exactly one artefact, in the recovery directory, and the deleted text appears nowhere in the
    // user's project tree.
    expect(await readdir(recoveryDir)).toHaveLength(1);
    expect(await readdir(root)).toEqual([]);
  });
});
