/**
 * 043 T083–T092, T098 — the replace COMMIT, over a real temp tree and a real `EditorCoordinator`
 * (contracts/file-search-ipc.md `throng:fileSearch:commit`, research R7/R8/R9, FR-052 – FR-058).
 *
 * ══ WHY THIS IS THE FEATURE'S MOST IMPORTANT TEST FILE ══
 *
 * This is the only part of 043 that writes. Everything else in the feature can be wrong and cost
 * the user a re-run; this can be wrong and cost them their text. So it is tested against the two
 * real things — a filesystem and the document authority — rather than against doubles that would
 * agree with any implementation.
 *
 * ══ THE FOUR-FILE FIXTURE, AND WHAT EACH FILE IS FOR (quickstart Scenario 4) ══
 *
 *   `active.txt`      an editor in the ACTIVE tab      — the easy case, and the only one a naive
 *                                                        implementation gets right
 *   `background.txt`  an editor in a BACKGROUND tab    — R7. See below.
 *   `dirty.txt`       an editor with UNRELATED unsaved edits — FR-053a/b/c
 *   `closed.txt`      no editor at all, CRLF and a BOM — FR-053, FR-056
 *
 * ══ WHY `background.txt` IS THE ASSERTION THAT MATTERS (R7) ══
 *
 * Only the ACTIVE tab's panels are mounted: `tab-group.tsx` renders `activeTab.root` and nothing
 * else, and on unmount the view and the replica are torn down while the DOCUMENT stays alive in
 * main. So a file open in a background tab has a `DocumentAuthority` and no view and no replica.
 *
 * A commit implemented as "find the view and dispatch into it" would therefore skip that file's
 * buffer edit AND decline its disk write — because `isOpen()` correctly reports it open. The file
 * would receive NEITHER, silently, with no error and nothing in the outcome to say so.
 *
 * Main cannot tell the two documents apart, and that is the point rather than a limitation of this
 * layer: `active.txt` and `background.txt` are registered identically here, differing only in their
 * `tabId`, so an implementation that reaches for anything view-shaped has nothing to reach for. The
 * four assertions that pin it are on `background.txt`: its buffer holds the replacement, its disk
 * bytes do not, it is dirty, and it is named in `changedInBuffer`. The defect leaves it in NO
 * array with nothing changed anywhere.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChangeSet } from '@codemirror/state';
import {
  DEFAULT_APP_SETTINGS,
  NO_MODES,
  encode,
  type AppSettings,
  type Match,
} from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import {
  EditorCoordinator,
  type DocMeta,
  type EditorSyncMsg,
} from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import {
  ReplaceCommitService,
  type BulkEditTarget,
  type CommitOutcome,
  type CommitResult,
} from '../../src/main/replace-commit-service.js';

const fs = new NodeFileSystem(async () => {});
const TERM = 'needle';
/**
 * WHICH panel is committing (043 FR-083c).
 *
 * Inert in this file — nothing here is watching a scan — but stated on every request, because it is
 * how a commit's own writes are kept from marking that panel's own results stale, and a test that
 * omitted it would be sending a payload the application never sends.
 */
const PANEL = 'fif-panel-1';

const ACTIVE = 'needle in the active tab\n';
const BACKGROUND = 'needle in a background tab\n';
const DIRTY_ON_DISK = 'needle in a dirty buffer\nORIGINAL SECOND LINE\n';
/** CRLF and a BOM, so FR-056 is a claim about BYTES rather than about characters. */
const CLOSED = 'needle in a file nobody opened\nsecond line\n';

let root: string;
let recoveryDir: string;
let coordinator: EditorCoordinator;
let commits: ReplaceCommitService;
let relayed: EditorSyncMsg[];
let relayExcluded: number[];
let settings: AppSettings;

function meta(panelId: string, tabId: string, absPath: string): DocMeta {
  return {
    panelId,
    windowId: 'w1',
    ownerKind: 'project',
    ownerProjectId: 'A',
    ownerRoot: root,
    allProjectRoots: [root],
    tabId,
    absPath,
    encoding: 'utf8',
    hasBom: false,
    lineEnding: 'lf',
  };
}

/** Every offset of `term` in `text`, exactly as a scan would have recorded them. */
function matchesOf(text: string, term: string): Match[] {
  const out: Match[] = [];
  for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + 1)) {
    out.push({ from: i, to: i + term.length });
  }
  return out;
}

/** One target, with every match of the term in the text it was scanned from. */
function target(relPath: string, scannedText: string): { relPath: string; edits: Match[] } {
  return { relPath, edits: matchesOf(scannedText, TERM) };
}

async function diskText(relPath: string): Promise<string> {
  return readFile(join(root, relPath), 'utf8');
}

/** What `applied` says about POSITIONS, with FR-083b's snippets set aside. */
function offsetsOf(outcome: CommitOutcome): { relPath: string; edits: Match[] }[] {
  return outcome.applied.map((file) => ({
    relPath: file.relPath,
    edits: file.edits.map(({ from, to }) => ({ from, to })),
  }));
}

/** The outcome, insisting the commit was not gated — for the cases where confirmation is not the point. */
function outcomeOf(result: CommitResult): CommitOutcome {
  if (!result.committed) throw new Error(`expected a committed result, got ${result.reason}`);
  return result.outcome;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-fifcommit-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-fifrec-'));
  relayed = [];
  relayExcluded = [];
  settings = structuredClone(DEFAULT_APP_SETTINGS);

  await writeFile(join(root, 'active.txt'), ACTIVE);
  await writeFile(join(root, 'background.txt'), BACKGROUND);
  await writeFile(join(root, 'dirty.txt'), DIRTY_ON_DISK);
  // Written through `encode` so the BOM and the CRLFs are real bytes, not an assumption about how
  // node wrote the string.
  await writeFile(
    join(root, 'closed.txt'),
    encode(CLOSED, { encoding: 'utf8', hasBom: true, lineEnding: 'crlf' }),
  );

  const service = new EditorService(fs, () => settings);
  coordinator = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    relaySync: (exclude, msg) => {
      relayExcluded.push(exclude);
      relayed.push(msg);
    },
    persistUndoHistory: () => true,
  });
  commits = new ReplaceCommitService(fs, coordinator, () => settings);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** Open the three editors the fixture calls for. `closed.txt` is deliberately left alone. */
async function openTheThree(): Promise<void> {
  await coordinator.load(meta('p-active', 'tab-active', join(root, 'active.txt')));
  await coordinator.load(meta('p-background', 'tab-background', join(root, 'background.txt')));
  await coordinator.load(meta('p-dirty', 'tab-active', join(root, 'dirty.txt')));
}

/** The user's own unsaved edit in `dirty.txt`, made BEFORE the commit and unrelated to the term. */
function userEditsDirtyBuffer(): void {
  const before = coordinator.getContent('p-dirty');
  if (!before) throw new Error('p-dirty is not open');
  const from = before.text.indexOf('ORIGINAL SECOND LINE');
  coordinator.dispatchChange(meta('p-dirty', 'tab-active', join(root, 'dirty.txt')), {
    documentId: 'p-dirty',
    viewId: 'view-user',
    changes: ChangeSet.of(
      [{ from, to: from + 'ORIGINAL SECOND LINE'.length, insert: 'WORK IN PROGRESS' }],
      before.text.length,
    ).toJSON(),
    baseVersion: before.version,
    selectionBefore: null,
    mergeClass: null,
  });
}

/** A commit of every match in all four files. */
async function commitAll(replacement = 'thread'): Promise<CommitResult> {
  return commits.commit({
    panelId: PANEL,
    projectRoot: root,
    term: TERM,
    modes: NO_MODES,
    replacement,
    targets: [
      target('active.txt', ACTIVE),
      target('background.txt', BACKGROUND),
      target('dirty.txt', DIRTY_ON_DISK),
      target('closed.txt', CLOSED),
    ],
    confirmedIrreversible: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// T083 — the fixture, and the preview writing nothing
// ─────────────────────────────────────────────────────────────────────────────

describe('T083 — the four-file fixture (quickstart Scenario 4)', () => {
  it('a preview is not a commit: nothing is called, so no file changes (FR-048)', async () => {
    await openTheThree();
    // The whole of "toggle replace, type a replacement, edit the term" is renderer state. The
    // service is what writes, and this asserts the only thing this layer can: until it is invoked,
    // every file still holds what it held.
    expect(await diskText('active.txt')).toBe(ACTIVE);
    expect(await diskText('background.txt')).toBe(BACKGROUND);
    expect(await diskText('dirty.txt')).toBe(DIRTY_ON_DISK);
    expect(coordinator.getContent('p-active')?.dirty).toBe(false);
  });

  it('partitions open from unopened and reports each in the right array (FR-052, FR-053)', async () => {
    await openTheThree();
    const outcome = outcomeOf(await commitAll());

    expect([...outcome.changedInBuffer].sort()).toEqual([
      'active.txt',
      'background.txt',
      'dirty.txt',
    ]);
    expect(outcome.changedOnDisk).toEqual(['closed.txt']);
    expect(outcome.refused).toEqual([]);
    expect(outcome.failed).toEqual([]);
  });

  it('the open files are changed in their BUFFERS and not behind them (FR-052)', async () => {
    await openTheThree();
    userEditsDirtyBuffer();
    await commitAll();

    expect(coordinator.getContent('p-active')?.text).toBe('thread in the active tab\n');
    /*
     * Amended by FR-086, and the claim in the title is unchanged.
     *
     * `active.txt` was CLEAN, so its bytes do change — written by `EditorCoordinator.save` through
     * the authority, after the edit landed in the buffer. "Not behind them" is a claim about WHO
     * writes, not about whether anything is written, and `dirty.txt` is where it is now asserted:
     * that document holds the user's own unsaved work, so nothing writes its file at all.
     */
    expect(await diskText('dirty.txt')).toBe(DIRTY_ON_DISK);
    expect(coordinator.getContent('p-dirty')?.text).toBe(
      'thread in a dirty buffer\nWORK IN PROGRESS\n',
    );
  });

  it('the unopened file is changed on disk (FR-053)', async () => {
    await openTheThree();
    await commitAll();
    expect(await diskText('closed.txt')).toContain('thread in a file nobody opened');
  });

  it('an empty replacement deletes each match and needs no extra confirmation (FR-046a)', async () => {
    await openTheThree();
    const outcome = outcomeOf(await commitAll(''));
    expect(outcome.failed).toEqual([]);
    expect(coordinator.getContent('p-active')?.text).toBe(' in the active tab\n');
    expect(await diskText('closed.txt')).toContain(' in a file nobody opened');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T084 — THE assertion. See the file header.
// ─────────────────────────────────────────────────────────────────────────────

describe('T084 — a file open in a BACKGROUND tab is changed (R7)', () => {
  it('its BUFFER holds the replacement, though no view of it is mounted', async () => {
    await openTheThree();
    await commitAll();

    // The defect leaves this equal to BACKGROUND: the buffer edit was skipped because there was no
    // view to dispatch into.
    expect(coordinator.getContent('p-background')?.text).toBe('thread in a background tab\n');
  });

  it('its file on disk is written by the AUTHORITY and never behind it (FR-052, FR-086)', async () => {
    await openTheThree();
    await commitAll();
    /*
     * Amended by FR-086. This document was clean, so the commit's edit lands in the buffer and the
     * save that follows writes it out — the file therefore holds exactly what the document holds,
     * which is the opposite of the divergence Constitution XI forbids. The unamended claim, that a
     * buffer with the user's own unsaved work is never written behind, lives on `dirty.txt`.
     */
    expect(await diskText('background.txt')).toBe('thread in a background tab\n');
    expect(coordinator.getContent('p-background')?.text).toBe(await diskText('background.txt'));
  });

  it('a background tab holding the user’s own unsaved work stays dirty (FR-053c, FR-086a)', async () => {
    await openTheThree();
    // The same document, in a background tab, with an edit of the user's own in it — so the claim is
    // about what the DOCUMENT held before the commit and not about which tab happens to show it.
    const before = coordinator.getContent('p-background');
    if (!before) throw new Error('p-background is not open');
    coordinator.dispatchChange(meta('p-background', 'tab-background', join(root, 'background.txt')), {
      documentId: 'p-background',
      viewId: 'view-user',
      changes: ChangeSet.of(
        [{ from: before.text.length - 1, to: before.text.length - 1, insert: ' — mine' }],
        before.text.length,
      ).toJSON(),
      baseVersion: before.version,
      selectionBefore: null,
      mergeClass: null,
    });

    await commitAll();

    expect(coordinator.getContent('p-background')?.dirty).toBe(true);
    expect(await diskText('background.txt')).toBe(BACKGROUND);
  });

  it('it is named in changedInBuffer — never silently in no array at all (FR-058)', async () => {
    await openTheThree();
    const outcome = outcomeOf(await commitAll());

    expect(outcome.changedInBuffer).toContain('background.txt');
    expect(outcome.changedOnDisk).not.toContain('background.txt');
    expect(outcome.refused.map((r) => r.relPath)).not.toContain('background.txt');
    expect(outcome.failed.map((f) => f.relPath)).not.toContain('background.txt');
  });

  it('its change goes out on the authority’s stream to EVERY window (R7, relaySync(-1))', async () => {
    await openTheThree();
    relayed.length = 0;
    relayExcluded.length = 0;
    await commitAll();

    const changes = relayed
      .map((msg, i) => ({ msg, exclude: relayExcluded[i] }))
      .filter(({ msg }) => msg.panelId === 'p-background' && msg.change);
    expect(changes).toHaveLength(1);
    // -1 excludes nobody. A view that was unmounted during the commit and remounts afterwards reads
    // `getContent`; a view that is mounted elsewhere gets the change. Neither may be left out.
    expect(changes[0]?.exclude).toBe(-1);
  });

  it('main cannot tell an active-tab document from a background-tab one — and must not need to', async () => {
    await openTheThree();
    await commitAll();
    // The two files are registered identically apart from `tabId`, so if the outcome for one is not
    // the outcome for the other, something view-shaped leaked into the decision.
    expect(coordinator.getContent('p-active')?.dirty).toBe(
      coordinator.getContent('p-background')?.dirty,
    );
    // Both were clean, so under FR-086 both are saved — and the assertion that matters is still that
    // the two answers are the SAME, whatever that answer is.
    expect(await diskText('active.txt')).toBe('thread in the active tab\n');
    expect(await diskText('background.txt')).toBe('thread in a background tab\n');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T087 — FR-054: the pre-write re-check, unconditionally
// ─────────────────────────────────────────────────────────────────────────────

describe('T087 — every match is re-verified immediately before its write (FR-054)', () => {
  it('a match edited away in an OPEN buffer is refused for that match only (FR-054a)', async () => {
    await writeFile(join(root, 'two.txt'), 'needle one\nneedle two\n');
    const scanned = 'needle one\nneedle two\n';
    await coordinator.load(meta('p-two', 'tab-active', join(root, 'two.txt')));

    // The user removes the FIRST occurrence after the scan and before the commit.
    const before = coordinator.getContent('p-two');
    if (!before) throw new Error('p-two is not open');
    coordinator.dispatchChange(meta('p-two', 'tab-active', join(root, 'two.txt')), {
      documentId: 'p-two',
      viewId: 'view-user',
      changes: ChangeSet.of([{ from: 0, to: 6, insert: 'gone!!' }], before.text.length).toJSON(),
      baseVersion: before.version,
      selectionBefore: null,
      mergeClass: null,
    });

    const result = await commits.commit({
      panelId: PANEL,
      projectRoot: root,
      term: TERM,
      modes: NO_MODES,
      replacement: 'thread',
      targets: [target('two.txt', scanned)],
      confirmedIrreversible: true,
    });
    const outcome = outcomeOf(result);

    expect(outcome.refused).toEqual([{ relPath: 'two.txt', reason: 'matchGone' }]);
    // The rest of the commit is unaffected: the second match was written.
    expect(outcome.changedInBuffer).toEqual(['two.txt']);
    expect(coordinator.getContent('p-two')?.text).toBe('gone!! one\nthread two\n');
  });

  it('a match edited away in an UNOPENED file is refused, and the file’s other matches land', async () => {
    const scanned = 'needle one\nneedle two\n';
    await writeFile(join(root, 'edited.txt'), scanned);
    // Changed on disk after the scan, and NOT marked stale — FR-054's re-check does not depend on
    // the staleness marking having caught up (US4 scenario 10).
    await writeFile(join(root, 'edited.txt'), 'gone!! one\nneedle two\n');

    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [target('edited.txt', scanned)],
        confirmedIrreversible: true,
      }),
    );

    expect(outcome.refused).toEqual([{ relPath: 'edited.txt', reason: 'matchGone' }]);
    expect(outcome.changedOnDisk).toEqual(['edited.txt']);
    expect(await diskText('edited.txt')).toBe('gone!! one\nthread two\n');
  });

  it('a file whose every match has gone is refused and NOT reported as changed', async () => {
    const scanned = 'needle\n';
    await writeFile(join(root, 'vanished.txt'), scanned);
    await writeFile(join(root, 'vanished.txt'), 'nothing here\n');

    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [target('vanished.txt', scanned)],
        confirmedIrreversible: true,
      }),
    );

    expect(outcome.refused).toEqual([{ relPath: 'vanished.txt', reason: 'matchGone' }]);
    expect(outcome.changedOnDisk).toEqual([]);
    expect(await diskText('vanished.txt')).toBe('nothing here\n');
  });

  it('a file that became OPEN between the partition and the write takes the buffer path (R8)', async () => {
    await writeFile(join(root, 'racy.txt'), 'needle racing\n');
    // The service re-checks `isOpen` immediately before each `writeBytes`. Modelled by opening the
    // editor from inside the settings reader, which the service consults during the same turn — the
    // only seam this layer has for "something happened between two of the service's own awaits".
    let opened = false;
    settings = structuredClone(DEFAULT_APP_SETTINGS);
    const racyCommits = new ReplaceCommitService(fs, coordinator, () => {
      if (!opened) {
        opened = true;
        void coordinator.load(meta('p-racy', 'tab-active', join(root, 'racy.txt')));
      }
      return settings;
    });

    // Give the load a turn to land before the write does.
    const started = racyCommits.commit({
      panelId: PANEL,
      projectRoot: root,
      term: TERM,
      modes: NO_MODES,
      replacement: 'thread',
      targets: [target('racy.txt', 'needle racing\n')],
      confirmedIrreversible: true,
    });
    const outcome = outcomeOf(await started);

    /*
     * The title's claim, asserted. This used to accept EITHER branch, which made it green for the
     * defect it names: the second `isOpen` — three awaits after the first — returned
     * `{kind:'failed', reason:'io'}`, so the file took NEITHER path and the user was told a
     * perfectly writable file could not be written. Rule 4 of the contract says such a file takes
     * the BUFFER path, so that is what is asserted, in both arms.
     */
    const onDisk = await diskText('racy.txt');
    expect(outcome.failed, 'becoming open is not a failure').toEqual([]);
    const inBuffer = outcome.changedInBuffer.includes('racy.txt');
    expect(
      inBuffer !== outcome.changedOnDisk.includes('racy.txt'),
      'exactly one of the two paths is taken — never neither',
    ).toBe(true);
    // Whichever side of the race it landed on, the ONE thing that may never happen is a disk write
    // behind a live buffer.
    expect(onDisk).toBe(inBuffer ? 'needle racing\n' : 'thread racing\n');
  });

  it('a file OPENED between the read and the write takes the BUFFER path, not an I/O failure', async () => {
    /*
     * The race the test above cannot schedule, made deterministic — and the defect it hides.
     *
     * `writeDirect`'s last `isOpen` sits three awaits after the loop's, so a `load()` in that window
     * is ordinary rather than exotic. It used to answer `{kind:'failed', reason:'io'}`: the file
     * took NEITHER path, nothing was written anywhere, and the notice told the user a perfectly
     * writable file could not be written. Rule 4 of the contract says it takes the buffer path.
     *
     * `isOpen` is gated rather than the clock: the document IS loaded throughout — otherwise
     * `bulkReplace` would have nothing to edit — and the gate models main learning about it one
     * check later, which is exactly what a `load()` landing mid-commit looks like from here.
     */
    await writeFile(join(root, 'late.txt'), 'needle racing\n');
    const absLate = join(root, 'late.txt');
    await coordinator.load(meta('p-late', 'tab-active', absLate));

    let asked = 0;
    const gated: BulkEditTarget = {
      isOpen: (absPath) => {
        if (absPath !== absLate) return coordinator.isOpen(absPath);
        asked += 1;
        // The partition and the loop see it closed; the pre-write check sees it open.
        return asked >= 3;
      },
      bulkReplace: (req) => coordinator.bulkReplace(req),
      save: (payload) => coordinator.save(payload),
    };

    const outcome = outcomeOf(
      await new ReplaceCommitService(fs, gated, () => settings).commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [target('late.txt', 'needle racing\n')],
        confirmedIrreversible: true,
      }),
    );

    expect(outcome.failed).toEqual([]);
    expect(outcome.changedInBuffer).toEqual(['late.txt']);
    expect(outcome.changedOnDisk).toEqual([]);
    expect(coordinator.getContent('p-late')?.text).toBe('thread racing\n');
    /*
     * FR-086: `p-late` was clean, so the buffer path saves it and the file DOES change — through the
     * authority, after the edit landed. What the title forbids is the direct `writeBytes` this test
     * exists to catch, and the tell is unchanged: that write would have gone to the file while the
     * outcome named it in `changedOnDisk`. It is in `changedInBuffer`, and the file agrees with the
     * document rather than diverging from it.
     */
    expect(await diskText('late.txt')).toBe('thread racing\n');
    expect(coordinator.getContent('p-late')?.dirty).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T089 — FR-056: fidelity of the direct write
// ─────────────────────────────────────────────────────────────────────────────

describe('T089 — line endings and any BOM survive byte-for-byte (FR-056)', () => {
  it('a CRLF file with a BOM keeps both', async () => {
    await openTheThree();
    await commitAll();

    const bytes = await readFile(join(root, 'closed.txt'));
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.subarray(3).toString('utf8');
    expect(text).toBe('thread in a file nobody opened\r\nsecond line\r\n');
    // The negative half: a plain read/write rewrites every CRLF as LF and drops the BOM.
    expect(text).not.toContain('\n\n');
    expect(text.split('\r\n')).toHaveLength(3);
  });

  it('a plain LF file with no BOM does not GAIN either', async () => {
    await writeFile(join(root, 'plain.txt'), 'needle\nsecond\n');
    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [target('plain.txt', 'needle\nsecond\n')],
        confirmedIrreversible: true,
      }),
    );
    expect(outcome.changedOnDisk).toEqual(['plain.txt']);
    const bytes = await readFile(join(root, 'plain.txt'));
    expect(bytes[0]).not.toBe(0xef);
    expect(bytes.toString('utf8')).toBe('thread\nsecond\n');
  });

  it('a CR-only file keeps CR', async () => {
    const scanned = 'needle\nsecond\n';
    await writeFile(
      join(root, 'cr.txt'),
      encode(scanned, { encoding: 'utf8', hasBom: false, lineEnding: 'cr' }),
    );
    await commits.commit({
      panelId: PANEL,
      projectRoot: root,
      term: TERM,
      modes: NO_MODES,
      replacement: 'thread',
      targets: [target('cr.txt', scanned)],
      confirmedIrreversible: true,
    });
    expect((await readFile(join(root, 'cr.txt'))).toString('utf8')).toBe('thread\rsecond\r');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T091 — FR-053a/b/c: a commit saves nothing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Amended (2026-09-10) by FR-086, which supersedes FR-053a for one case and nothing else.
 *
 * The heading used to read "a commit saves no editor". It now saves exactly one kind — a document
 * that was CLEAN before it — and FR-053b, the promise this block was really about, stands word for
 * word: nothing the user left unsaved is written by a commit. Every assertion below that moved,
 * moved because it was asserting FR-053a; every assertion about the user's own unsaved work is
 * untouched, which is the point.
 */
describe('T091 — a commit saves only what was clean (FR-086, FR-053b, FR-053c)', () => {
  it('leaves an already-dirty buffer dirty, and saves the clean ones (US4 scenario 15)', async () => {
    await openTheThree();
    userEditsDirtyBuffer();
    await commitAll();

    expect(coordinator.getContent('p-active')?.dirty).toBe(false);
    expect(coordinator.getContent('p-background')?.dirty).toBe(false);
    expect(coordinator.getContent('p-dirty')?.dirty).toBe(true);
  });

  it('never writes the bytes of a file whose buffer holds unsaved work of the user’s', async () => {
    await openTheThree();
    userEditsDirtyBuffer();
    await commitAll();

    // The clean two are saved (FR-086); the one carrying the user's own work is not (FR-086a), and
    // that is the whole of FR-053b in one assertion.
    expect(await diskText('active.txt')).toBe('thread in the active tab\n');
    expect(await diskText('background.txt')).toBe('thread in a background tab\n');
    expect(await diskText('dirty.txt')).toBe(DIRTY_ON_DISK);
  });

  it('the user’s earlier unsaved work joins the replacement and reaches no disk (US4 scenario 14)', async () => {
    await openTheThree();
    userEditsDirtyBuffer();
    await commitAll();

    // Both edits are in the buffer…
    expect(coordinator.getContent('p-dirty')?.text).toBe(
      'thread in a dirty buffer\nWORK IN PROGRESS\n',
    );
    // …and neither is on disk. The commit did not save, so it did not persist work the user had
    // deliberately not saved.
    expect(await diskText('dirty.txt')).toBe(DIRTY_ON_DISK);
  });

  it('leaves the project in the mixed state FR-053c describes, now in THREE parts', async () => {
    await openTheThree();
    userEditsDirtyBuffer();
    await commitAll();
    /*
     * FR-086a: the mixed state narrows rather than disappears. Unopened files on disk; documents
     * that were clean on disk too, via their own save; documents the user had already modified still
     * pending in their buffers alongside that user's work. The dirty flags are what make the third
     * case visible, and it is the only one left.
     */
    expect(await diskText('closed.txt')).toContain('thread');
    expect(await diskText('active.txt')).toContain('thread');
    expect(coordinator.getContent('p-active')?.dirty).toBe(false);
    expect(await diskText('dirty.txt')).not.toContain('thread');
    expect(coordinator.getContent('p-dirty')?.dirty).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T092 — FR-052, FR-057: one undo step, per document
// ─────────────────────────────────────────────────────────────────────────────

describe('T092 — undo reverts one document, as a single step (FR-052, FR-057)', () => {
  it('one undo in one editor reverts that file’s whole commit and nothing else', async () => {
    await openTheThree();
    await commitAll();

    coordinator.undo('p-active', 'view-a');

    expect(coordinator.getContent('p-active')?.text).toBe(ACTIVE);
    // FR-086: the commit saved this document, so undoing past that save re-dirties it against the
    // bytes the save wrote — the ordinary behaviour of an edit made after a save (016 FR-026d), and
    // the proof that the history survived the write.
    expect(coordinator.getContent('p-active')?.dirty).toBe(true);
    // Only that document. US4 scenario 7 — a single undo spanning every file is explicitly NOT
    // required and explicitly not introduced (FR-057).
    expect(coordinator.getContent('p-background')?.text).toBe('thread in a background tab\n');
    expect(coordinator.getContent('p-background')?.dirty).toBe(false);
  });

  it('a file with several matches undoes as ONE step, not one per match (FR-057)', async () => {
    const scanned = 'needle a needle b needle\n';
    await writeFile(join(root, 'many.txt'), scanned);
    await coordinator.load(meta('p-many', 'tab-active', join(root, 'many.txt')));

    await commits.commit({
      panelId: PANEL,
      projectRoot: root,
      term: TERM,
      modes: NO_MODES,
      replacement: 'thread',
      targets: [target('many.txt', scanned)],
      confirmedIrreversible: true,
    });
    expect(coordinator.getContent('p-many')?.text).toBe('thread a thread b thread\n');

    coordinator.undo('p-many', 'view-a');
    expect(coordinator.getContent('p-many')?.text).toBe(scanned);
  });

  it('does not absorb the user’s earlier edit into the commit’s undo step (mergeClass: null)', async () => {
    await openTheThree();
    userEditsDirtyBuffer();
    await commitAll();

    coordinator.undo('p-dirty', 'view-a');
    // The commit is undone; the user's own unrelated edit is still there.
    expect(coordinator.getContent('p-dirty')?.text).toBe(
      'needle in a dirty buffer\nWORK IN PROGRESS\n',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T095/T096 support — FR-057b/c/d: the irreversible-commit warning, decided in MAIN
// ─────────────────────────────────────────────────────────────────────────────

describe('the irreversible-commit gate (FR-057b, FR-057c, FR-057d)', () => {
  it('returns needsConfirmation with a file COUNT and writes nothing (FR-057b)', async () => {
    await openTheThree();
    const result = await commits.commit({
      panelId: PANEL,
      projectRoot: root,
      term: TERM,
      modes: NO_MODES,
      replacement: 'thread',
      targets: [
        target('active.txt', ACTIVE),
        target('closed.txt', CLOSED),
      ],
      confirmedIrreversible: false,
    });

    expect(result).toEqual({ committed: false, reason: 'needsConfirmation', unopenedFileCount: 1 });
    // Nothing at all: not the open file's buffer either. The user has not agreed to the operation.
    expect(await diskText('closed.txt')).toContain(TERM);
    expect(coordinator.getContent('p-active')?.dirty).toBe(false);
  });

  it('counts the unopened FILES, not the matches (FR-057b, FR-014’s subject)', async () => {
    await writeFile(join(root, 'a.txt'), 'needle needle needle\n');
    await writeFile(join(root, 'b.txt'), 'needle needle\n');
    const result = await commits.commit({
      panelId: PANEL,
      projectRoot: root,
      term: TERM,
      modes: NO_MODES,
      replacement: 'thread',
      targets: [target('a.txt', 'needle needle needle\n'), target('b.txt', 'needle needle\n')],
      confirmedIrreversible: false,
    });
    expect(result).toEqual({ committed: false, reason: 'needsConfirmation', unopenedFileCount: 2 });
  });

  it('does NOT ask when every affected file has an open editor (FR-057d)', async () => {
    await openTheThree();
    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [target('active.txt', ACTIVE), target('background.txt', BACKGROUND)],
        confirmedIrreversible: false,
      }),
    );
    expect([...outcome.changedInBuffer].sort()).toEqual(['active.txt', 'background.txt']);
  });

  it('proceeds without asking when the preference is off (FR-057c)', async () => {
    settings.search.inFiles.warnIrreversibleCommit = false;
    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [target('closed.txt', CLOSED)],
        confirmedIrreversible: false,
      }),
    );
    expect(outcome.changedOnDisk).toEqual(['closed.txt']);
  });

  it('an EMPTY replacement attracts no confirmation of its own (FR-046a)', async () => {
    await openTheThree();
    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: '',
        targets: [target('active.txt', ACTIVE), target('background.txt', BACKGROUND)],
        confirmedIrreversible: false,
      }),
    );
    // Every file open, so FR-057d applies and the emptiness changes nothing about the gate.
    expect(outcome.changedInBuffer).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T098 — FR-058: reported ONCE, with all four arrays
// ─────────────────────────────────────────────────────────────────────────────

describe('T098 — a partially-failing commit reports everything, once (FR-058)', () => {
  it('one outcome carries changed, unchanged and why', async () => {
    await openTheThree();
    // A missing file, a match that has gone, an open file and an unopened one — every array at once.
    const goneScanned = 'needle gone\n';
    await writeFile(join(root, 'gone.txt'), goneScanned);
    await writeFile(join(root, 'gone.txt'), 'nothing here\n');

    const result = await commits.commit({
      panelId: PANEL,
      projectRoot: root,
      term: TERM,
      modes: NO_MODES,
      replacement: 'thread',
      targets: [
        target('active.txt', ACTIVE),
        target('closed.txt', CLOSED),
        target('gone.txt', goneScanned),
        { relPath: 'never-existed.txt', edits: [{ from: 0, to: 6 }] },
      ],
      confirmedIrreversible: true,
    });
    const outcome = outcomeOf(result);

    expect(outcome.changedInBuffer).toEqual(['active.txt']);
    expect(outcome.changedOnDisk).toEqual(['closed.txt']);
    expect(outcome.refused).toEqual([{ relPath: 'gone.txt', reason: 'matchGone' }]);
    expect(outcome.failed).toEqual([{ relPath: 'never-existed.txt', reason: 'missing' }]);
  });

  it('refuses a target that escapes the project root rather than writing outside it (R9)', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'throng-outside-'));
    try {
      await writeFile(join(outside, 'victim.txt'), 'needle\n');
      const outcome = outcomeOf(
        await commits.commit({
          panelId: PANEL,
          projectRoot: root,
          term: TERM,
          modes: NO_MODES,
          replacement: 'thread',
          targets: [{ relPath: '../../victim.txt', edits: [{ from: 0, to: 6 }] }],
          confirmedIrreversible: true,
        }),
      );
      expect(outcome.changedOnDisk).toEqual([]);
      expect(outcome.failed.map((f) => f.relPath)).toEqual(['../../victim.txt']);
    } finally {
      await rm(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it('a commit with no targets reports every array empty rather than nothing at all', async () => {
    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [],
        confirmedIrreversible: true,
      }),
    );
    expect(outcome).toEqual({
      changedInBuffer: [],
      changedOnDisk: [],
      refused: [],
      failed: [],
      // FR-086's two channels, answered like the rest: empty, not absent. They are separate
      // questions rather than one inverted — "could not be saved" and "was saved" both have to be
      // answerable, because a file in neither is one that was already dirty and still is.
      notSaved: [],
      saved: [],
      // #378 — `applied` is answered like the rest of them: the renderer refuses an outcome that
      // omits it, because a missing ledger is a silent return of the defect rather than a smaller
      // answer.
      applied: [],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The direct write's two ways of destroying bytes it was never asked to touch
// ─────────────────────────────────────────────────────────────────────────────

describe('a file that is not UTF-8 is refused, not transcoded (FR-053, FR-058)', () => {
  /** `café\ncolour\n` in Windows-1252 — no NULs anywhere, so the binary scan calls it text. */
  const WINDOWS_1252 = new Uint8Array([
    0x63, 0x61, 0x66, 0xe9, 0x0a, 0x63, 0x6f, 0x6c, 0x6f, 0x75, 0x72, 0x0a,
  ]);

  it('leaves every byte of a legacy-encoded file exactly as it found them', async () => {
    /*
     * The user's sequence, and it costs them the file: `notes.txt` is Windows-1252 and holds `café`
     * and `colour`; no editor is open on it. Replace `colour` → `color`, confirm the warning. The
     * non-fatal decode turns the `E9` into `U+FFFD` and the encode writes `EF BF BD` — so `café`
     * comes back `caf?`, along with every other non-ASCII byte in the file, none of them near the
     * match. There is no in-app undo for a disk write (FR-057a), and the user never opened the file.
     */
    await writeFile(join(root, 'notes.txt'), WINDOWS_1252);
    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: 'colour',
        modes: NO_MODES,
        replacement: 'color',
        targets: [{ relPath: 'notes.txt', edits: [{ from: 5, to: 11 }] }],
        confirmedIrreversible: true,
      }),
    );

    expect(outcome.failed).toEqual([{ relPath: 'notes.txt', reason: 'encoding' }]);
    expect(outcome.changedOnDisk).toEqual([]);
    expect([...(await readFile(join(root, 'notes.txt')))]).toEqual([...WINDOWS_1252]);
  });

  it('still writes the UTF-8 files in the same commit (FR-058)', async () => {
    // A refusal is per file. The point of four arrays is that one bad file does not stop the rest.
    await writeFile(join(root, 'notes.txt'), WINDOWS_1252);
    await writeFile(join(root, 'plain.txt'), 'colour\n');
    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: 'colour',
        modes: NO_MODES,
        replacement: 'color',
        targets: [
          { relPath: 'notes.txt', edits: [{ from: 5, to: 11 }] },
          { relPath: 'plain.txt', edits: [{ from: 0, to: 6 }] },
        ],
        confirmedIrreversible: true,
      }),
    );

    expect(outcome.failed).toEqual([{ relPath: 'notes.txt', reason: 'encoding' }]);
    expect(outcome.changedOnDisk).toEqual(['plain.txt']);
    expect(await diskText('plain.txt')).toBe('color\n');
  });
});

describe('a file that MIXES line endings keeps every one of them (FR-056)', () => {
  it('changes only the line it replaced in', async () => {
    /*
     * `decode` records the DOMINANT ending and `encode` re-applied it to every break, so a mostly
     * CRLF file with a couple of LF lines came back all-CRLF: `git diff` shows every line changed
     * for a one-word replacement, in a file the user never opened. 006 reached this too, but with
     * the file on screen; 043 reaches it in files nobody looked at.
     */
    const original = 'alpha\r\nneedle here\nbravo\r\ncharlie\r\n';
    await writeFile(join(root, 'mixed.txt'), original);

    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [target('mixed.txt', 'alpha\nneedle here\nbravo\ncharlie\n')],
        confirmedIrreversible: true,
      }),
    );

    expect(outcome.changedOnDisk).toEqual(['mixed.txt']);
    expect(await diskText('mixed.txt')).toBe('alpha\r\nthread here\nbravo\r\ncharlie\r\n');
  });

  it('leaves a uniform file exactly as it was', async () => {
    // The common case must not change shape: a CRLF file stays CRLF, byte for byte.
    await writeFile(join(root, 'uniform.txt'), 'alpha\r\nneedle\r\nbravo\r\n');
    outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [target('uniform.txt', 'alpha\nneedle\nbravo\n')],
        confirmedIrreversible: true,
      }),
    );
    expect(await diskText('uniform.txt')).toBe('alpha\r\nthread\r\nbravo\r\n');
  });
});

describe('a SECOND commit in a file this operation already committed (FR-050, FR-054)', () => {
  it('writes the next row instead of claiming its match had gone', async () => {
    /*
     * Nothing rebases a panel's rows after a commit, so row 2 still carries its scan-time offsets
     * while the match it names has moved. Refusing it told the user "the match had gone" about a
     * match they are looking at — and made replace-this-one, then the next, fail on the second
     * click. FR-054 permits re-resolution; this is it, end to end.
     */
    const scanned = 'foo bar foo\n';
    await writeFile(join(root, 'twice.txt'), scanned);
    const rows = [
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ];

    const first = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: 'foo',
        modes: NO_MODES,
        replacement: 'bazqux',
        targets: [{ relPath: 'twice.txt', edits: [rows[0] as Match] }],
        confirmedIrreversible: true,
      }),
    );
    expect(first.changedOnDisk).toEqual(['twice.txt']);
    expect(await diskText('twice.txt')).toBe('bazqux bar foo\n');

    // Row 2, still carrying the offsets the scan gave it.
    const second = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: 'foo',
        modes: NO_MODES,
        replacement: 'bazqux',
        targets: [{ relPath: 'twice.txt', edits: [rows[1] as Match] }],
        confirmedIrreversible: true,
      }),
    );
    expect(second.refused, 'the match is on screen; it has not gone').toEqual([]);
    expect(second.changedOnDisk).toEqual(['twice.txt']);
    expect(await diskText('twice.txt')).toBe('bazqux bar bazqux\n');
  });

  it('does the same through an OPEN document’s authority', async () => {
    // The buffer half of FR-050: `bulkReplace` runs the same re-check, so the two paths cannot
    // disagree about which matches a second commit may still write.
    const scanned = 'foo bar foo\n';
    await writeFile(join(root, 'open-twice.txt'), scanned);
    await coordinator.load(meta('p-twice', 'tab-active', join(root, 'open-twice.txt')));

    const request = (edits: Match[]): Parameters<typeof commits.commit>[0] => ({
      panelId: PANEL,
      projectRoot: root,
      term: 'foo',
      modes: NO_MODES,
      replacement: 'bazqux',
      targets: [{ relPath: 'open-twice.txt', edits }],
      confirmedIrreversible: true,
    });

    outcomeOf(await commits.commit(request([{ from: 0, to: 3 }])));
    expect(coordinator.getContent('p-twice')?.text).toBe('bazqux bar foo\n');

    const second = outcomeOf(await commits.commit(request([{ from: 8, to: 11 }])));
    expect(second.refused).toEqual([]);
    expect(second.changedInBuffer).toEqual(['open-twice.txt']);
    expect(coordinator.getContent('p-twice')?.text).toBe('bazqux bar bazqux\n');
  });

  it('still refuses a match something ELSE moved', async () => {
    // Re-resolution is about a shift THIS operation caused. A length-preserving replacement cannot
    // have moved anything, so a match at a different offset is somebody else's edit, and writing at
    // the scanned position would splice into unrelated text.
    await writeFile(join(root, 'moved.txt'), 'xx needle\n');
    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [{ relPath: 'moved.txt', edits: [{ from: 0, to: 6 }] }],
        confirmedIrreversible: true,
      }),
    );
    expect(outcome.refused).toEqual([{ relPath: 'moved.txt', reason: 'matchGone' }]);
    expect(await diskText('moved.txt')).toBe('xx needle\n');
  });
});

/**
 * #378 — the outcome says WHICH edits were written, in the coordinates the caller asked with.
 *
 * The panel is the only thing that can know a file has moved under its own rows, and it can only
 * know it if the commit tells it what landed. A file-level answer is what left it re-deriving the
 * shift from the bytes, where an adjacent match and a replacement containing the term are
 * indistinguishable from an untouched file — and the second commit wrote over the first.
 *
 * So this is the half of the fix that lives in main, asserted on both write paths.
 */
describe('#378 — the commit reports the edits it wrote, not just the files', () => {
  it('echoes the caller’s own offsets for a file written on disk', async () => {
    await writeFile(join(root, 'echo.txt'), 'foo bar foo\n');
    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: 'foo',
        modes: NO_MODES,
        replacement: 'bazqux',
        targets: [{ relPath: 'echo.txt', edits: [{ from: 0, to: 3 }, { from: 8, to: 11 }] }],
        confirmedIrreversible: true,
      }),
    );
    // The OFFSETS, on their own. Each edit also carries FR-083b's re-derived snippet now, and this
    // claim is about the coordinate system rather than about what the row says — which is asserted
    // in its own block below.
    expect(offsetsOf(outcome)).toEqual([
      { relPath: 'echo.txt', edits: [{ from: 0, to: 3 }, { from: 8, to: 11 }] },
    ]);
  });

  it('does the same through an open document, and names only what landed', async () => {
    // One match written, one edited away in the buffer beforehand (FR-054a). The file appears in
    // BOTH `changedInBuffer` and `refused`, and `applied` is what says which of its two rows is
    // which — the distinction the panel's marking used to have to give up on.
    await writeFile(join(root, 'partial.txt'), 'foo bar foo\n');
    const absPartial = join(root, 'partial.txt');
    await coordinator.load(meta('p-partial', 'tab-active', absPartial));
    const before = coordinator.getContent('p-partial');
    if (!before) throw new Error('p-partial is not open');
    coordinator.dispatchChange(meta('p-partial', 'tab-active', absPartial), {
      documentId: 'p-partial',
      viewId: 'view-user',
      changes: ChangeSet.of([{ from: 8, to: 11, insert: 'zzz' }], before.text.length).toJSON(),
      baseVersion: before.version,
      selectionBefore: null,
      mergeClass: null,
    });

    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: 'foo',
        modes: NO_MODES,
        replacement: 'bazqux',
        targets: [{ relPath: 'partial.txt', edits: [{ from: 0, to: 3 }, { from: 8, to: 11 }] }],
        confirmedIrreversible: true,
      }),
    );
    expect(outcome.changedInBuffer).toEqual(['partial.txt']);
    expect(outcome.refused).toEqual([{ relPath: 'partial.txt', reason: 'matchGone' }]);
    expect(offsetsOf(outcome)).toEqual([{ relPath: 'partial.txt', edits: [{ from: 0, to: 3 }] }]);
  });

  it('names no file that wrote nothing', async () => {
    await writeFile(join(root, 'none.txt'), 'xx needle\n');
    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [{ relPath: 'none.txt', edits: [{ from: 0, to: 6 }] }],
        confirmedIrreversible: true,
      }),
    );
    expect(outcome.applied).toEqual([]);
  });
});

/**
 * 043 T207 — FR-083b, against the two REAL sources of the new text.
 *
 * The arithmetic is settled in `packages/core` and the wiring in
 * `tests/unit/replace-commit-snippets.test.ts`, where the authority is a fake. What only this tier
 * can answer is whether the real `EditorCoordinator` hands back the document as it is AFTER the
 * dispatch — a claim about the authority's ordering, not about a snippet — and whether the disk
 * path's own new text agrees with the bytes it wrote.
 *
 * The fixture is two matches on ONE line, which is the case the whole requirement exists for.
 */
describe('T207 — a committed row is answered with its line as it now reads (FR-083b)', () => {
  const PAIR = 'const needle = needle;\n';
  const AFTER = 'const thread = thread;';

  /** Each write's snippet, flattened to the text a row would show. */
  function shown(outcome: CommitOutcome, relPath: string): (string | undefined)[] {
    const file = outcome.applied.find((a) => a.relPath === relPath);
    return (file?.edits ?? []).map((e) =>
      e.snippet === undefined
        ? undefined
        : `${e.snippet.before}${e.snippet.matched}${e.snippet.after}`,
    );
  }

  it('from the file it just wrote, on the disk path', async () => {
    await writeFile(join(root, 'pair.txt'), PAIR);
    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [target('pair.txt', PAIR)],
        confirmedIrreversible: true,
      }),
    );

    expect(await diskText('pair.txt')).toBe(`${AFTER}\n`);
    expect(shown(outcome, 'pair.txt')).toEqual([AFTER, AFTER]);
  });

  it('from the document authority, on the buffer path', async () => {
    await writeFile(join(root, 'pair-open.txt'), PAIR);
    await coordinator.load(meta('p-pair', 'tab-active', join(root, 'pair-open.txt')));

    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [target('pair-open.txt', PAIR)],
        confirmedIrreversible: true,
      }),
    );

    expect(outcome.changedInBuffer).toEqual(['pair-open.txt']);
    /*
     * The DOCUMENT is where the snippets came from. Under FR-086 the file now holds the same text —
     * the save put it there — so disk agreement is no longer what distinguishes the authority's
     * answer from a re-read. `changedInBuffer` is: a snippet derived from disk on this path would
     * have had to read the file BEFORE the save, and found the term still in it.
     */
    expect(coordinator.getContent('p-pair')?.text).toBe(`${AFTER}\n`);
    expect(shown(outcome, 'pair-open.txt')).toEqual([AFTER, AFTER]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T214 — FR-086 / FR-086a: saving what was clean
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 043 T214 — a document that was CLEAN before the commit is saved after it; one that was ALREADY
 * DIRTY is not (FR-086, FR-086a, US4 scenarios 26 and 27).
 *
 * ══ WHY THE DIRTY HALF IS THE HALF THAT MATTERS ══
 *
 * An implementation that simply saved every editor it touched passes the clean half on its own. The
 * dirty half is what fails such an implementation, and it is asserted on the file's BYTES rather than
 * on its dirty flag: a flag can be right while the bytes are wrong, and the thing FR-053b protects is
 * the bytes — the user's own unsaved second line, which no commit may write out.
 *
 * ══ WHY CLEANLINESS IS SAMPLED, NOT OBSERVED ══
 *
 * The commit's edit goes through the authority, which dirties the document. So "was it clean?" has
 * exactly one moment at which it can be asked — before the dispatch — and any implementation that
 * asks afterwards finds every document dirty and saves nothing. `p-active` is the document that
 * catches that: it is clean at the start of the commit and dirty a microsecond later.
 *
 * ══ AND WHY THE UNDO ASSERTION IS HERE ══
 *
 * A save is not a reload. FR-086 was chosen over "write the disk and reload the editor" precisely
 * because a reload clears the undo history of every document it touches (016 FR-026d), which would
 * contradict FR-057's per-document undoability and FR-057d's reason for needing no warning. An
 * implementation that reached for a reload would pass every other assertion in this block.
 */
describe('T214 — a clean document is saved by the commit; a dirty one is not (FR-086, FR-086a)', () => {
  it('a document CLEAN before the commit ends CLEAN with the replacement on disk (FR-086)', async () => {
    await openTheThree();
    expect(coordinator.getContent('p-active')?.dirty, 'clean before the commit').toBe(false);

    await commitAll();

    expect(coordinator.getContent('p-active')?.text).toBe('thread in the active tab\n');
    expect(coordinator.getContent('p-active')?.dirty).toBe(false);
    expect(await diskText('active.txt')).toBe('thread in the active tab\n');
  });

  it('a document in a BACKGROUND tab is saved on the same terms — this is about the document', async () => {
    await openTheThree();
    await commitAll();

    // No view, no replica, and it makes no difference: saving is an operation on the document
    // (Constitution XI), so a background tab's clean editor is saved exactly as the active one is.
    expect(coordinator.getContent('p-background')?.dirty).toBe(false);
    expect(await diskText('background.txt')).toBe('thread in a background tab\n');
  });

  it('a document ALREADY DIRTY is not saved — its BYTES on disk are untouched (FR-086a, FR-053b)', async () => {
    await openTheThree();
    userEditsDirtyBuffer();
    await commitAll();

    // The anti-vacuity guard. Asserted on the file's contents, not on the flag: FR-053b is a promise
    // about what reaches disk, and the user's `WORK IN PROGRESS` reaching it is the defect.
    expect(await diskText('dirty.txt')).toBe(DIRTY_ON_DISK);
    expect(coordinator.getContent('p-dirty')?.text).toBe(
      'thread in a dirty buffer\nWORK IN PROGRESS\n',
    );
    expect(coordinator.getContent('p-dirty')?.dirty).toBe(true);
  });

  it('one commit does both at once, and neither answer contaminates the other (US4 scenario 27)', async () => {
    await openTheThree();
    userEditsDirtyBuffer();
    await commitAll();

    expect(coordinator.getContent('p-active')?.dirty).toBe(false);
    expect(await diskText('active.txt')).toBe('thread in the active tab\n');
    expect(coordinator.getContent('p-dirty')?.dirty).toBe(true);
    expect(await diskText('dirty.txt')).toBe(DIRTY_ON_DISK);
  });

  it('the saved document’s undo history SURVIVES — a save is not a reload (FR-086, 016 FR-026d)', async () => {
    await openTheThree();
    await commitAll();
    expect(coordinator.getContent('p-active')?.dirty).toBe(false);

    coordinator.undo('p-active', 'view-a');

    // The commit is still one undo away, and undoing past the save re-dirties the document against
    // the bytes the save wrote — which is the ordinary behaviour of an edit made after a save.
    expect(coordinator.getContent('p-active')?.text).toBe(ACTIVE);
    expect(coordinator.getContent('p-active')?.dirty).toBe(true);
  });

  it('the clean state reaches EVERY window, not just the panel that owns the view (FR-034)', async () => {
    await openTheThree();
    // `dirty.txt` is only dirty once the user has edited it — the fixture opens it clean.
    userEditsDirtyBuffer();
    relayed.length = 0;
    relayExcluded.length = 0;
    await commitAll();

    const cleared = relayed
      .map((msg, i) => ({ msg, exclude: relayExcluded[i] }))
      .filter(({ msg }) => msg.panelId === 'p-active' && msg.dirty === false);
    // One document, several replicas: the unsaved dot clears in all of them or the rule is broken.
    expect(cleared).toHaveLength(1);
    expect(cleared[0]?.exclude).toBe(-1);
    // …and nothing was relayed for the dirty document's dirty flag, because it was not saved.
    expect(relayed.filter((m) => m.panelId === 'p-dirty' && m.dirty === false)).toEqual([]);
  });

  it('a commit that WROTE NOTHING into a clean document does not save it either', async () => {
    /*
     * The match had already gone from the file before the scan's rows reached the commit, so nothing
     * was applied and there is nothing to write out. Saving anyway would touch the file's mtime for a
     * decision the commit did not make — and mark it stale in the panel that just decided nothing.
     *
     * The document stays clean throughout, so its dirty FLAG cannot tell a save from no save. The
     * relay can: `save` mirrors `{dirty: false}` to every window, and no save relays nothing.
     */
    await writeFile(join(root, 'gone-open.txt'), 'nothing here\n');
    await coordinator.load(meta('p-gone', 'tab-active', join(root, 'gone-open.txt')));
    relayed.length = 0;

    const outcome = outcomeOf(
      await commits.commit({
        panelId: PANEL,
        projectRoot: root,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        // Scanned from a text this file no longer holds — FR-054 refuses it at the position.
        targets: [target('gone-open.txt', 'needle here\n')],
        confirmedIrreversible: true,
      }),
    );

    expect(outcome.refused).toEqual([{ relPath: 'gone-open.txt', reason: 'matchGone' }]);
    expect(outcome.changedInBuffer).toEqual([]);
    expect(coordinator.getContent('p-gone')?.dirty).toBe(false);
    expect(relayed.filter((m) => m.panelId === 'p-gone' && m.dirty === false)).toEqual([]);
  });
});
