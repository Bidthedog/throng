/**
 * 043 T077/T078 — per-file staleness, riding the watch that already exists (FR-045a, FR-045c,
 * FR-045d, US3 scenarios 14 and 16).
 *
 * ══ THE REQUIREMENT WITH THE STRONGEST CONSTRAINT IN THE FEATURE ══
 *
 * FR-045d: do not add a watcher where an existing project watch can serve. Issues #272 and #306
 * exist because throng already holds too many. So the thing under test here is deliberately NOT
 * "a watcher fires" — it is that the SCAN SERVICE, handed the directory signal that
 * `ExplorerWatcher` already broadcasts to every window, re-stats the result files it holds under
 * that directory and marks the ones that moved.
 *
 * This file wires the REAL `ExplorerWatcher` over the REAL `NodeFileWatcher` over a REAL temp tree,
 * and hangs the service off the same emit callback `main.ts` broadcasts from. That is the whole
 * point: if a second watch were needed, this test could not be written this way — the chain it
 * exercises is exactly the one the composition root builds, and it constructs one watcher.
 *
 * ══ WHY THE SIGNAL CANNOT ANSWER THIS ON ITS OWN (research R6) ══
 *
 * Neither existing signal reports a CONTENT change. `throng:files:changed` carries `{ relDir }` and
 * nothing else — no filename, no event kind — and the file index is a MEMBERSHIP index, so a
 * modified file produces no delta at all. The directory signal is therefore a prompt to LOOK, and
 * the looking is the re-stat below. An assertion that the watcher fired would prove nothing about
 * FR-045a, because the watcher fires for a file nobody searched just as readily.
 *
 * ══ WHY INTEGRATION AND NOT UNIT ══
 *
 * A fake clock and a fake filesystem would let a same-second, same-size edit pass unnoticed while
 * the test stayed green — and a same-size edit (`needle` → `cattle`) is the ordinary case here, not
 * the exotic one. Only a real write to a real file settles whether the stamp this service compares
 * actually moves.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { Text } from '@codemirror/state';
import { DEFAULT_APP_SETTINGS, NO_MODES, type Match } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import { ExplorerWatcher } from '../../src/main/explorer-watcher.js';
import { FileSearchService, type FileSearchUpdate } from '../../src/main/file-search-service.js';
import {
  ReplaceCommitService,
  type BulkEditTarget,
} from '../../src/main/replace-commit-service.js';

const TERM = 'needle';
const WINDOW = 1;
const PANEL = 'panel-1';
const BUDGET_MS = 30_000;

async function waitFor<T>(what: string, probe: () => T | undefined, budgetMs = BUDGET_MS): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() - started > budgetMs) throw new Error(`timed out after ${budgetMs}ms: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const roots: string[] = [];
const watchers: ExplorerWatcher[] = [];
const services: FileSearchService[] = [];

async function seed(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body);
  }
}

interface Rig {
  root: string;
  service: FileSearchService;
  sent: FileSearchUpdate[];
  /** Every `staleFiles` this panel has been told about, most recent last. */
  stale: () => string[];
  /** The same, for one named panel — FR-083c is per panel, not per project. */
  staleFor: (panelId: string) => string[];
  scan: () => Promise<void>;
  /** A second run, over the same tree, belonging to a DIFFERENT panel. */
  scanAs: (panelId: string) => Promise<void>;
}

/**
 * The chain `main.ts` builds: one `ExplorerWatcher`, whose emit both broadcasts to the windows and
 * — the new part — hands the directory to the scan service.
 */
async function rig(files: Record<string, string>): Promise<Rig> {
  const root = await mkdtemp(join(tmpdir(), 'throng-fif-stale-'));
  roots.push(root);
  await seed(root, files);

  const fs = new NodeFileSystem(async () => {});
  const sent: FileSearchUpdate[] = [];
  const service = new FileSearchService(
    fs,
    () => [],
    () => [],
    () => 10 * 1024 * 1024,
    (_id, payload) => sent.push(payload),
  );
  services.push(service);

  const watcher = new ExplorerWatcher(new NodeFileWatcher(50), (evt, absRoot) => {
    // Exactly what the composition root does at the broadcast site: a SECOND consumer of one watch.
    void service.noteDirectoryChanged(absRoot, evt.relDir);
  });
  watchers.push(watcher);
  watcher.setRoot(root);
  // Let the recursive watch arm before anything is written.
  await new Promise((r) => setTimeout(r, 200));

  const scanAs = async (panelId: string): Promise<void> => {
    const before = sent.length;
    await service.start(WINDOW, {
      panelId,
      projectRoot: root,
      scopeSubPath: null,
      term: TERM,
      modes: NO_MODES,
    });
    await waitFor(`the scan for ${panelId} to complete`, () =>
      sent.slice(before).find((u) => u.panelId === panelId && u.status === 'complete')
        ? true
        : undefined,
    );
  };

  const scan = async (): Promise<void> => {
    sent.length = 0;
    await scanAs(PANEL);
  };

  const staleFor = (panelId: string): string[] =>
    sent.filter((u) => u.panelId === panelId).flatMap((u) => u.staleFiles ?? []);

  return {
    root,
    service,
    sent,
    stale: () => staleFor(PANEL),
    staleFor,
    scan,
    scanAs,
  };
}

afterEach(async () => {
  for (const w of watchers.splice(0)) w.dispose();
  for (const s of services.splice(0)) s.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('a file that contributed results changes (FR-045a, US3 scenario 14)', () => {
  it('marks THAT file stale and no other', async () => {
    const r = await rig({
      'src/a.ts': `const a = ${TERM};\n`,
      'src/b.ts': `const b = ${TERM};\n`,
      'lib/c.ts': `const c = ${TERM};\n`,
    });
    await r.scan();

    // Same LENGTH as what it replaces, so only the modification time can tell the difference —
    // the ordinary case for a find-and-replace, and the one a size-only check would miss.
    await writeFile(join(r.root, 'src/a.ts'), `const a = cattle;\n`);

    const marked = await waitFor('src/a.ts to be marked stale', () => {
      const held = r.stale();
      return held.includes('src/a.ts') ? held : undefined;
    });
    expect(marked).toContain('src/a.ts');
    expect(marked).not.toContain('src/b.ts');
    expect(marked).not.toContain('lib/c.ts');
  });

  it('marks a result file that has been deleted', async () => {
    const r = await rig({ 'src/a.ts': `const a = ${TERM};\n`, 'src/b.ts': `const b = ${TERM};\n` });
    await r.scan();

    await rm(join(r.root, 'src/a.ts'));

    const marked = await waitFor('the deleted file to be marked stale', () => {
      const held = r.stale();
      return held.includes('src/a.ts') ? held : undefined;
    });
    expect(marked).not.toContain('src/b.ts');
  });

  it('says nothing about a file that produced no results', async () => {
    const r = await rig({ 'src/a.ts': `const a = ${TERM};\n`, 'src/quiet.ts': 'const q = 1;\n' });
    await r.scan();

    await writeFile(join(r.root, 'src/quiet.ts'), 'const q = 2;\n');
    // Then touch a file that DID contribute, so there is a signal to wait for rather than a sleep.
    await writeFile(join(r.root, 'src/a.ts'), `const a = ${TERM}; // touched\n`);

    await waitFor('src/a.ts to be marked stale', () =>
      r.stale().includes('src/a.ts') ? true : undefined,
    );
    expect(r.stale()).not.toContain('src/quiet.ts');
  });

  it('keeps the marking cumulative for the run', async () => {
    const r = await rig({ 'src/a.ts': `const a = ${TERM};\n`, 'src/b.ts': `const b = ${TERM};\n` });
    await r.scan();

    await writeFile(join(r.root, 'src/a.ts'), `const a = cattle;\n`);
    await waitFor('a', () => (r.stale().includes('src/a.ts') ? true : undefined));
    await writeFile(join(r.root, 'src/b.ts'), `const b = cattle;\n`);

    const both = await waitFor('both files to be marked', () => {
      const held = r.sent.flatMap((u) => u.staleFiles ?? []);
      const last = r.sent.filter((u) => u.staleFiles).at(-1)?.staleFiles ?? [];
      return last.includes('src/a.ts') && last.includes('src/b.ts') ? held : undefined;
    });
    expect(both).toContain('src/a.ts');
    expect(both).toContain('src/b.ts');
  });
});

describe('re-running clears staleness (FR-045c, US3 scenario 16)', () => {
  it('the fresh run carries no stale file', async () => {
    const r = await rig({ 'src/a.ts': `const a = ${TERM};\n` });
    await r.scan();
    await writeFile(join(r.root, 'src/a.ts'), `const a = ${TERM}; // edited\n`);
    await waitFor('src/a.ts to be marked stale', () =>
      r.stale().includes('src/a.ts') ? true : undefined,
    );

    await r.scan(); // clears `sent`, so what follows is entirely the new run's

    expect(r.stale()).toEqual([]);
  });

  it('and a change after the re-run marks it again', async () => {
    const r = await rig({ 'src/a.ts': `const a = ${TERM};\n` });
    await r.scan();
    await writeFile(join(r.root, 'src/a.ts'), `const a = ${TERM}; // one\n`);
    await waitFor('the first marking', () => (r.stale().includes('src/a.ts') ? true : undefined));

    await r.scan();
    await writeFile(join(r.root, 'src/a.ts'), `const a = ${TERM}; // two\n`);

    await waitFor('the second marking', () =>
      r.stale().includes('src/a.ts') ? true : undefined,
    );
    // The generation is the new run's, so the renderer will not drop it as superseded.
    const marking = r.sent.filter((u) => u.staleFiles && u.staleFiles.length > 0).at(-1);
    const complete = r.sent.find((u) => u.status === 'complete');
    expect(marking?.generation).toBe(complete?.generation);
  });
});

/**
 * 043 T210 — FR-083c: a commit does not mark its OWN file stale.
 *
 * ══ WHY THIS IS A REAL DEFECT AND NOT TIDINESS ══
 *
 * Staleness is derived from watcher ticks, and a tick sees that a file changed — never WHO changed
 * it. So a commit to an unopened file changes that file and marks it stale in the very panel that
 * just made the list agree with the disk. Before FR-083 that was noise; now the rows claim to show
 * the file as it is while the heading above them says the list disagrees with the disk. One panel,
 * one moment, two contradictory statements.
 *
 * ══ WHY IT HAS TO BE INTEGRATION, AND WHY IT USES THE REAL COMMIT ══
 *
 * The claim is about a race between two real things: a write, and a debounced watcher that re-stats
 * afterwards. A fake clock or a fake filesystem would let the same-length case through — and a
 * same-length replacement (`needle` → `cattle`) is the ordinary find-and-replace, not the exotic
 * one. The commit is the real `ReplaceCommitService` for the same reason: what must not mark the
 * file is the WRITE PATH, and a test that called the sparing method directly would prove only that
 * the method exists.
 *
 * ══ THE ANTI-VACUITY HALVES ══
 *
 * Two, because "never mark anything" would pass the first assertion alone. A file the commit wrote
 * AND something else then changed must still go stale, and another panel's run over the same file
 * must go stale outright — the panel is the authority on its own writes and on nobody else's.
 */
describe('a commit does not mark its own file stale (FR-083c)', () => {
  const stub: BulkEditTarget = {
    // Nothing is open in this test, which is what puts every commit on the DISK path — the only
    // path a watcher can see.
    isOpen: () => false,
    bulkReplace: () => null,
  };

  /** Replace every match of the term in one file, through the real commit, as one panel. */
  async function commitInto(r: Rig, relPath: string, panelId: string): Promise<void> {
    const text = await readFile(join(r.root, relPath), 'utf8');
    const edits: Match[] = [];
    for (let i = text.indexOf(TERM); i !== -1; i = text.indexOf(TERM, i + 1)) {
      edits.push({ from: i, to: i + TERM.length });
    }
    expect(edits.length, `${relPath} holds no match to commit`).toBeGreaterThan(0);

    const commits = new ReplaceCommitService(
      new NodeFileSystem(async () => {}),
      stub,
      () => structuredClone(DEFAULT_APP_SETTINGS),
      r.service,
    );
    const result = await commits.commit({
      panelId,
      projectRoot: r.root,
      term: TERM,
      modes: NO_MODES,
      // Same LENGTH as what it replaces, so only the modification time can tell the difference.
      replacement: 'cattle',
      targets: [{ relPath, edits }],
      confirmedIrreversible: true,
    });
    expect(result.committed, 'the commit did not go through').toBe(true);
  }

  it('leaves a file its own commit changed unmarked', async () => {
    const r = await rig({
      'src/a.ts': `const a = ${TERM};\n`,
      'src/b.ts': `const b = ${TERM};\n`,
    });
    await r.scan();

    await commitInto(r, 'src/a.ts', PANEL);
    // A signal to wait for rather than a sleep: something ELSE changes, so the tick that would have
    // marked `src/a.ts` has demonstrably happened by the time this assertion runs.
    await writeFile(join(r.root, 'src/b.ts'), `const b = cattle;\n`);

    await waitFor('src/b.ts to be marked stale', () =>
      r.stale().includes('src/b.ts') ? true : undefined,
    );
    expect(r.stale()).not.toContain('src/a.ts');
  });

  it('still marks that file when something ELSE changes it afterwards', async () => {
    const r = await rig({ 'src/a.ts': `const a = ${TERM};\n` });
    await r.scan();

    await commitInto(r, 'src/a.ts', PANEL);
    await writeFile(join(r.root, 'src/a.ts'), 'const a = someone else entirely;\n');

    await waitFor('src/a.ts to be marked stale by the second writer', () =>
      r.stale().includes('src/a.ts') ? true : undefined,
    );
  });

  it('marks it in ANOTHER panel’s run — a panel is the authority on its own writes only', async () => {
    const r = await rig({ 'src/a.ts': `const a = ${TERM};\n` });
    await r.scan();
    await r.scanAs('panel-2');

    await commitInto(r, 'src/a.ts', PANEL);

    await waitFor('the other panel to be told its file changed', () =>
      r.staleFor('panel-2').includes('src/a.ts') ? true : undefined,
    );
    expect(r.staleFor(PANEL)).not.toContain('src/a.ts');
  });

  /*
   * ══ AND THE BUFFER PATH, WHICH FR-086 MADE A WRITER ══
   *
   * Every test above puts the commit on the DISK path, because before FR-086 that was the only path
   * that touched a file — an open document's replacement went into its buffer and nothing on disk
   * moved, so there was nothing for a watcher to see and nothing to declare.
   *
   * FR-086 changed that: a document that was clean is now SAVED, and a save writes. FR-083c names
   * this case in as many words — "including a save made under FR-086" — so the commonest path in an
   * ordinary session now needs the declaration that the rarer one already had. Without it the panel
   * marks its own results stale at the exact moment it has made them agree with the disk.
   *
   * The stub's `save` writes the file, which is what `EditorCoordinator.save` does for real. That is
   * the whole point of the test: FR-083c is about a panel not being told off for its OWN write,
   * whoever physically performs it.
   */
  it('leaves a file its own commit SAVED unmarked, on the buffer path (FR-083c, FR-086)', async () => {
    const r = await rig({
      'src/a.ts': `const a = ${TERM};\n`,
      'src/b.ts': `const b = ${TERM};\n`,
    });
    await r.scan();

    const absA = join(r.root, 'src/a.ts');
    const openStub: BulkEditTarget = {
      // The file IS open, so the commit takes the buffer path.
      isOpen: (p) => p.replace(/\\/g, '/').toLowerCase() === absA.replace(/\\/g, '/').toLowerCase(),
      bulkReplace: (req) => ({
        applied: [...req.edits],
        applicable: [...req.edits],
        refused: 0,
        after: Text.of([`const a = cattle;\n`]),
        documentId: 'doc-a',
        // Clean before the edit, so FR-086 owes it a save.
        wasClean: true,
      }),
      // What a real save does that matters here: it writes.
      save: async () => {
        await writeFile(absA, `const a = cattle;\n`);
        return { ok: true };
      },
    };

    const commits = new ReplaceCommitService(
      new NodeFileSystem(async () => {}),
      openStub,
      () => structuredClone(DEFAULT_APP_SETTINGS),
      r.service,
    );
    const text = await readFile(absA, 'utf8');
    const at = text.indexOf(TERM);
    const result = await commits.commit({
      panelId: PANEL,
      projectRoot: r.root,
      term: TERM,
      modes: NO_MODES,
      replacement: 'cattle',
      targets: [{ relPath: 'src/a.ts', edits: [{ from: at, to: at + TERM.length }] }],
      confirmedIrreversible: true,
    });
    expect(result.committed).toBe(true);

    // The same wait-for-a-signal shape the disk-path tests use: something else changes, so the tick
    // that would have marked `src/a.ts` has demonstrably happened by the time this is asserted.
    await writeFile(join(r.root, 'src/b.ts'), `const b = cattle;\n`);
    await waitFor('src/b.ts to be marked stale', () =>
      r.stale().includes('src/b.ts') ? true : undefined,
    );

    expect(
      r.stale(),
      'the panel marked its own save stale — the badge would claim the list disagrees with a disk ' +
        'the list is now correct about',
    ).not.toContain('src/a.ts');
  });
});

describe('no watcher is added (FR-045d)', () => {
  it('the service exposes no watch of its own — the directory arrives from outside it', () => {
    // A structural claim, and the cheapest honest form of it: `noteDirectoryChanged` is a method
    // someone else calls. Were the service watching, it would need a root, a disposal and a
    // failure path, and none of those exist on its surface.
    const service = new FileSearchService(
      new NodeFileSystem(async () => {}),
      () => [],
      () => [],
      () => 1,
      () => {},
    );
    services.push(service);
    expect(typeof service.noteDirectoryChanged).toBe('function');
    expect((service as unknown as { watch?: unknown }).watch).toBeUndefined();
    expect((service as unknown as { setRoot?: unknown }).setRoot).toBeUndefined();
  });
});
