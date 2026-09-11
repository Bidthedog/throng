/**
 * 043 T049/T051/T053/T053a/T053b — `FileSearchService` over a REAL temp tree
 * (contracts/file-search-ipc.md, research R2/R4/R5, FR-030, FR-030a, FR-041, FR-043, FR-043c,
 * FR-045e, FR-045f, FR-018).
 *
 * Why this layer. The scan is a walk, a read and a decode over an actual filesystem, and every
 * requirement here is about the ORDER and the SIZE of what comes out of it — batches arriving
 * before the walk ends, a superseded run producing nothing, a refused file contributing no rows.
 * A fake filesystem would let each of those pass while resolving instantly, which is precisely the
 * property under test. Nothing below sleeps for an outcome: every wait polls for the CONDITION.
 *
 * Two seams are injected rather than provoked, and both are stated here rather than hidden:
 *
 *   - the SIZE LIMIT is a function (`editor.maxOpenFileBytes`, read at scan time exactly as
 *     `ProjectFileIndexService` reads its globs), so the over-size case costs a few hundred bytes
 *     instead of writing an 11 MiB file to disk on every run;
 *   - a READ FAILURE is injected through an `IFileSystem` decorator, because there is no portable,
 *     deterministic way to make one real file unreadable on a Windows temp tree inside a test. The
 *     tree, the walk, the decode and the batching are all still real.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import {
  MAX_ROWS_PER_BATCH,
  NO_MODES,
  normaliseForCompare,
  type DirEntry,
  type IFileSystem,
  type ResultRow,
} from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import {
  FileSearchService,
  type FileSearchUpdate,
  type StartScanResult,
} from '../../src/main/file-search-service.js';
/*
 * The renderer's FOLD, imported into a main-process test on purpose (043 T115).
 *
 * FR-030a is a claim about what the panel is SHOWING, and on this wire the only thing that decides
 * that is `applyFileSearchUpdate` reading the generation. Asserting the emitted number alone would
 * pass a service that had merely renamed the field; reading the stream back through the same pure
 * function the window uses is what makes "the rows stay listed" the thing under test.
 */
import {
  NO_FILE_SEARCH_RESULTS,
  applyFileSearchUpdate,
  type FileSearchResults,
} from '../../src/renderer/find-in-files/find-in-files-store.js';

const TERM = 'needle';
const WINDOW = 1;
const PANEL = 'panel-1';

/** Generous, because these walks are real I/O; nothing here waits this long when it works. */
const BUDGET_MS = 30_000;

/** Poll for a condition rather than sleeping for it. */
async function waitFor<T>(what: string, probe: () => T | undefined, budgetMs = BUDGET_MS): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() - started > budgetMs) throw new Error(`timed out after ${budgetMs}ms: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * A real {@link NodeFileSystem} that RECORDS every absolute path it was asked to list or read, and
 * can be told to fail one read.
 *
 * The recording is not incidental: project isolation (FR-018) is a claim about paths the scan never
 * touches, and the only way to assert a path was never touched is to watch the seam it would have
 * been touched through.
 */
class ObservedFs implements IFileSystem {
  readonly listed: string[] = [];

  readonly read: string[] = [];

  readonly failReads = new Set<string>();

  private readonly inner = new NodeFileSystem(async () => {});

  list(dir: string): Promise<DirEntry[]> {
    this.listed.push(dir);
    return this.inner.list(dir);
  }

  readBytes(path: string): Promise<Uint8Array> {
    this.read.push(path);
    if (this.failReads.has(normaliseForCompare(path))) {
      return Promise.reject(new Error('EACCES: permission denied'));
    }
    return this.inner.readBytes(path);
  }

  size(path: string): Promise<number> {
    return this.inner.size(path);
  }

  modifiedAt(path: string): Promise<{ mtimeMs: number; size: number }> {
    return this.inner.modifiedAt(path);
  }

  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }

  stat(path: string): Promise<{ kind: 'file' | 'folder'; isSymlink: boolean }> {
    return this.inner.stat(path);
  }

  realpath(path: string): Promise<string> {
    return this.inner.realpath(path);
  }

  mkdir(path: string): Promise<void> {
    return this.inner.mkdir(path);
  }

  rename(path: string, newName: string): Promise<string> {
    return this.inner.rename(path, newName);
  }

  move(src: string, destDir: string): Promise<string> {
    return this.inner.move(src, destDir);
  }

  copy(src: string, destDir: string, newName?: string): Promise<string> {
    return this.inner.copy(src, destDir, newName);
  }

  delete(path: string): Promise<void> {
    return this.inner.delete(path);
  }

  trash(path: string): Promise<void> {
    return this.inner.trash(path);
  }

  restoreFromTrash(originalPath: string, deletedAt: number): Promise<void> {
    return this.inner.restoreFromTrash(originalPath, deletedAt);
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    return this.inner.writeBytes(path, bytes);
  }
}

interface Sent {
  id: number;
  payload: FileSearchUpdate;
}

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'throng-file-search-'));
  roots.push(root);
  return root;
}

async function seed(root: string, files: Record<string, string | Uint8Array>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof body === 'string' ? body : Buffer.from(body));
  }
}

/** `n` lines each carrying exactly one occurrence of the term. */
function linesWithTerm(n: number): string {
  return Array.from({ length: n }, (_, i) => `const x${i} = ${TERM}();`).join('\n');
}

class Harness {
  readonly sent: Sent[] = [];

  globs: string[] = [];

  hidden = new Map<string, string[]>();

  maxFileBytes = 10 * 1024 * 1024;

  readonly fs = new ObservedFs();

  readonly service: FileSearchService;

  constructor() {
    this.service = new FileSearchService(
      this.fs,
      () => this.globs,
      (root) => this.hidden.get(root) ?? [],
      () => this.maxFileBytes,
      (id, payload) => this.sent.push({ id, payload }),
    );
  }

  updates(panelId = PANEL): FileSearchUpdate[] {
    return this.sent.filter((s) => s.payload.panelId === panelId).map((s) => s.payload);
  }

  /** The terminal update for a run, or `undefined` while it is still going. */
  settled(panelId = PANEL): FileSearchUpdate | undefined {
    return this.updates(panelId).find(
      (u) => u.status === 'complete' || u.status === 'cancelled' || u.status === 'scopeMissing',
    );
  }

  rows(panelId = PANEL): ResultRow[] {
    return this.updates(panelId).flatMap((u) => u.rows ?? []);
  }

  start(request: { projectRoot: string; scopeSubPath?: string | null; term?: string }): Promise<StartScanResult> {
    return this.service.start(WINDOW, {
      panelId: PANEL,
      projectRoot: request.projectRoot,
      scopeSubPath: request.scopeSubPath ?? null,
      term: request.term ?? TERM,
      modes: NO_MODES,
    });
  }
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop() as string;
    await rm(root, { recursive: true, force: true }).catch(() => {
      /* a temp tree that will not go is the OS's business, not this suite's */
    });
  }
});

describe('file search scan (043 T049)', () => {
  /*
   * "Before the scan completes", not "before the walk completes", and the distinction is real:
   * `walkFiles` enumerates the tree in one pass and returns a sorted list, so the ENUMERATION is a
   * prelude and the reads are what stream. That is the shipped walk, reused rather than replaced
   * (research R5), and FR-041's requirement is about results appearing progressively rather than
   * only on completion — which is exactly what `status: 'running'` on the first batch asserts.
   */
  it('FR-041 — rows stream in batches BEFORE the scan completes, none over the bound', async () => {
    const root = await makeRoot();
    const files: Record<string, string> = {};
    for (let i = 0; i < 8; i++) files[`src/f${i}.ts`] = linesWithTerm(60);
    await seed(root, files);

    const harness = new Harness();
    expect(await harness.start({ projectRoot: root })).toEqual({ started: true });
    await waitFor('the scan to settle', () => harness.settled());

    const updates = harness.updates();
    const carrying = updates.filter((u) => (u.rows?.length ?? 0) > 0);
    // More than one batch, and the FIRST of them was sent while the scan was still running — which
    // is the whole of FR-041. One update carrying everything at the end would pass "results appear"
    // and fail "progressively".
    expect(carrying.length).toBeGreaterThan(1);
    expect(carrying[0].status).toBe('running');
    for (const u of updates) {
      expect(u.rows?.length ?? 0).toBeLessThanOrEqual(MAX_ROWS_PER_BATCH);
      expect(u.generation).toBe(1);
    }
    expect(harness.rows()).toHaveLength(480);
    expect(harness.settled()?.status).toBe('complete');
    expect(harness.settled()?.totalMatches).toBe(480);
  });

  it('FR-043c — a second start SUPERSEDES rather than compounds', async () => {
    const root = await makeRoot();
    const files: Record<string, string> = {};
    for (let i = 0; i < 8; i++) files[`src/f${i}.ts`] = linesWithTerm(60);
    await seed(root, files);

    const harness = new Harness();
    // Deliberately not awaited between the two: the generation bump is synchronous, so the second
    // start supersedes the first before it has read a single byte.
    const first = harness.start({ projectRoot: root });
    const second = harness.start({ projectRoot: root });
    expect(await first).toEqual({ started: true });
    expect(await second).toEqual({ started: true });
    await waitFor('the surviving scan to settle', () => harness.settled());
    // Nothing else may arrive after the terminal update.
    await new Promise((r) => setTimeout(r, 250));

    const updates = harness.updates();
    expect(updates.filter((u) => u.status === 'complete')).toHaveLength(1);
    // Compounding is the failure this guards: two runs over one panel yielding 960 rows, or a
    // second `complete` that resets a list the user is already reading.
    expect(harness.rows()).toHaveLength(480);
    expect(Math.max(...updates.map((u) => u.generation))).toBe(2);
    expect(updates.every((u) => u.generation === 2)).toBe(true);
  });

  it('FR-043 — a cancelled walk yields NOTHING, not a truncated set', async () => {
    const root = await makeRoot();
    const files: Record<string, string> = {};
    for (let d = 0; d < 20; d++) {
      for (let i = 0; i < 20; i++) files[`d${d}/f${i}.ts`] = linesWithTerm(20);
    }
    await seed(root, files);

    const harness = new Harness();
    expect(await harness.start({ projectRoot: root })).toEqual({ started: true });
    // A run is keyed by the WINDOW as well as the panel: a synced sub-workspace view carries the
    // same panel id in a second window, and one window's cancel must not reach the other's scan.
    harness.service.cancel(WINDOW, PANEL);
    await waitFor('the cancelled scan to settle', () => harness.settled());
    await new Promise((r) => setTimeout(r, 250));

    expect(harness.settled()?.status).toBe('cancelled');
    // A truncated set would be worse than nothing: it looks like a complete answer to a question
    // nobody finished asking.
    expect(harness.rows()).toHaveLength(0);
  });
});

describe('files the scan skips (043 T051, FR-045e/FR-045f)', () => {
  it('excluded, binary, over-size and unreadable files produce no rows and ONE skipped count', async () => {
    const root = await makeRoot();
    await seed(root, {
      'plain.ts': linesWithTerm(2),
      // Excluded by the project's own rules. NOT counted as skipped: FR-045e's set is what the scan
      // refuses "beyond FR-045's exclusion rules", and counting an ignored `node_modules` would
      // report tens of thousands of files the user deliberately excluded.
      'node_modules/dep/index.js': linesWithTerm(3),
      'assets/blob.bin': new Uint8Array([...Buffer.from(TERM), 0, 1, 2, ...Buffer.from(TERM)]),
      'big.ts': linesWithTerm(60),
      'locked.ts': linesWithTerm(2),
    });

    const harness = new Harness();
    harness.globs = ['node_modules'];
    harness.maxFileBytes = 200;
    harness.fs.failReads.add(normaliseForCompare(join(root, 'locked.ts')));

    expect(await harness.start({ projectRoot: root })).toEqual({ started: true });
    await waitFor('the scan to settle', () => harness.settled());

    expect(harness.rows().map((r) => r.relPath)).toEqual(['plain.ts', 'plain.ts']);
    const settled = harness.settled() as FileSearchUpdate;
    // Three refusals — binary, too large, read failed — as ONE number for the whole scan.
    expect(settled.skipped).toBe(3);
    expect(settled.status).toBe('complete');
    // The excluded folder was never even descended into (W3), so it costs nothing rather than
    // costing everything and then being filtered.
    expect(harness.fs.listed.some((p) => p.includes('node_modules'))).toBe(false);
    expect(harness.fs.read.some((p) => p.includes('node_modules'))).toBe(false);
  });
});

describe('scope (043 T053, FR-030/FR-030a)', () => {
  it('FR-030 — a sub-directory scope reads NOTHING above it', async () => {
    const root = await makeRoot();
    await seed(root, {
      'top.ts': linesWithTerm(4),
      'sub/inner.ts': linesWithTerm(2),
      'sub/deeper/x.ts': linesWithTerm(1),
      'other/y.ts': linesWithTerm(5),
    });

    const harness = new Harness();
    expect(await harness.start({ projectRoot: root, scopeSubPath: 'sub' })).toEqual({ started: true });
    await waitFor('the scan to settle', () => harness.settled());

    // Root-relative, as the contract requires — a scope narrows what is read, it does not re-root
    // the identity of what is found.
    expect([...new Set(harness.rows().map((r) => r.relPath))].sort()).toEqual([
      'sub/deeper/x.ts',
      'sub/inner.ts',
    ]);
    const scope = normaliseForCompare(join(root, 'sub'));
    for (const path of [...harness.fs.listed, ...harness.fs.read]) {
      expect(normaliseForCompare(path).startsWith(scope)).toBe(true);
    }
  });

  it('FR-030a — a missing scope directory yields scopeMissing and no rows', async () => {
    const root = await makeRoot();
    await seed(root, { 'top.ts': linesWithTerm(4) });

    const harness = new Harness();
    const result = await harness.start({ projectRoot: root, scopeSubPath: 'gone' });
    expect(result).toEqual({ started: false, reason: 'scopeMissing' });
    await waitFor('the scopeMissing update', () => harness.settled());

    expect(harness.settled()?.status).toBe('scopeMissing');
    expect(harness.rows()).toHaveLength(0);
    // Nothing above the missing scope was read to find that out.
    expect(harness.fs.read).toHaveLength(0);
  });

  it('an empty term starts nothing and keeps the panel as it was', async () => {
    const root = await makeRoot();
    await seed(root, { 'top.ts': linesWithTerm(4) });
    const harness = new Harness();
    expect(await harness.start({ projectRoot: root, term: '' })).toEqual({
      started: false,
      reason: 'emptyTerm',
    });
    expect(harness.updates()).toHaveLength(0);
  });
});

/**
 * 043 T115 — FR-030a's two halves, US3 scenario 30.
 *
 * ══ WHY THE GENERATION IS THE ASSERTION ══
 *
 * FR-030a is not "the panel says the scope is gone". It is that saying so costs the user NOTHING:
 * "results already listed MUST stay listed and fully usable … with no row disabled, hidden or
 * reordered". On this wire a NEW generation is the one and only way the renderer is told a re-run
 * replaced the list, so a refusal that carries one wipes precisely the rows the requirement
 * protects — silently, and without any code in the renderer looking wrong. Reading the whole update
 * stream back through `applyFileSearchUpdate` is what turns that into the user's claim rather than
 * a claim about a number.
 *
 * ══ AND WHY THE SIGNAL IS `noteDirectoryChanged` ══
 *
 * Scenario 30 says "when that directory is deleted", not "when they next search". The service
 * already consumes `throng:files:changed` for staleness (FR-045d, research R6), and FR-045d forbids
 * adding a watcher, so the directory signal that is already arriving is the whole detection budget.
 */
describe('a missing scope is raised when it goes, and costs the listed rows nothing (043 T115)', () => {
  /** Scan `sub`, and hand back the updates that produced the listed rows. */
  async function listedFromSub(harness: Harness, root: string): Promise<FileSearchUpdate[]> {
    expect(await harness.start({ projectRoot: root, scopeSubPath: 'sub' })).toEqual({
      started: true,
    });
    await waitFor('the first scan to settle', () => harness.settled());
    expect(harness.rows()).toHaveLength(3);
    return harness.updates();
  }

  /** What the panel would be showing, having read every update in order. */
  function asRead(updates: readonly FileSearchUpdate[]): FileSearchResults {
    let state = NO_FILE_SEARCH_RESULTS;
    for (const u of updates) state = applyFileSearchUpdate(state, u);
    return state;
  }

  it('FR-030a — a re-run over a scope that has gone keeps the rows the panel is showing', async () => {
    const root = await makeRoot();
    await seed(root, { 'sub/inner.ts': linesWithTerm(3), 'top.ts': linesWithTerm(2) });

    const harness = new Harness();
    const listed = await listedFromSub(harness, root);
    const generation = listed.at(-1)?.generation;

    await rm(join(root, 'sub'), { recursive: true, force: true });
    harness.sent.length = 0;

    expect(await harness.start({ projectRoot: root, scopeSubPath: 'sub' })).toEqual({
      started: false,
      reason: 'scopeMissing',
    });
    await waitFor('the scopeMissing update', () => harness.settled());
    const refusal = harness.settled() as FileSearchUpdate;

    // Nothing STARTED, so nothing was superseded — the same clause the empty-term guard above
    // already relies on, applied to the other refusal that reaches this panel.
    expect(refusal.generation).toBe(generation);
    expect(refusal.rows ?? []).toHaveLength(0);

    const state = asRead([...listed, refusal]);
    // 043 T118 — the refusal carries the FINISHED run's generation, so it is a fact about the
    // directory and not a scan state: the readout stays the completed run's, over the rows the
    // requirement protects. The condition reaches the scope control from `update.status`, which
    // the store's `receive` reads separately.
    expect(state.status).toBe('complete');
    expect(state.rows).toHaveLength(3);
  });

  it('US3 scenario 30 — the condition is raised when the directory GOES, not at the next search', async () => {
    const root = await makeRoot();
    await seed(root, { 'sub/inner.ts': linesWithTerm(3), 'top.ts': linesWithTerm(2) });

    const harness = new Harness();
    const listed = await listedFromSub(harness, root);
    const generation = listed.at(-1)?.generation;

    await rm(join(root, 'sub'), { recursive: true, force: true });
    harness.sent.length = 0;

    // Exactly what `main.ts` calls at the EXISTING `throng:files:changed` broadcast site: the
    // parent of the scope is what a subtree delete surfaces on. No watcher is opened here.
    await harness.service.noteDirectoryChanged(root, '');

    const raised = harness.updates().find((u) => u.status === 'scopeMissing');
    expect(raised).toBeDefined();
    expect(raised?.generation).toBe(generation);
    expect(raised?.rows ?? []).toHaveLength(0);

    const state = asRead([...listed, ...harness.updates()]);
    // 043 T118, as above: raised at the run's own generation, so the run's readout survives it.
    expect(state.status).toBe('complete');
    expect(state.rows).toHaveLength(3);
  });

  it('says nothing while the scoped directory is still there — a stale file is not a missing scope', async () => {
    const root = await makeRoot();
    await seed(root, { 'sub/inner.ts': linesWithTerm(3) });

    const harness = new Harness();
    await listedFromSub(harness, root);
    harness.sent.length = 0;

    await writeFile(join(root, 'sub', 'inner.ts'), linesWithTerm(4));
    await harness.service.noteDirectoryChanged(root, 'sub');

    expect(harness.updates().find((u) => u.status === 'scopeMissing')).toBeUndefined();
    // The staleness half is untouched: the file moved, and that is what gets said (FR-045a).
    expect(harness.updates().at(-1)?.staleFiles).toEqual(['sub/inner.ts']);
  });

  it('never raises it for a whole-root search, whose scope is the project itself', async () => {
    const root = await makeRoot();
    await seed(root, { 'top.ts': linesWithTerm(3) });

    const harness = new Harness();
    expect(await harness.start({ projectRoot: root })).toEqual({ started: true });
    await waitFor('the scan to settle', () => harness.settled());
    harness.sent.length = 0;

    await harness.service.noteDirectoryChanged(root, '');

    expect(harness.updates().find((u) => u.status === 'scopeMissing')).toBeUndefined();
  });
});

describe('project isolation (043 T053a, FR-018, Constitution I)', () => {
  it('a search reads only the active project, never the other project root', async () => {
    const projectA = await makeRoot();
    const projectB = await makeRoot();
    await seed(projectA, { 'only-in-a.ts': linesWithTerm(9) });
    await seed(projectB, { 'only-in-b.ts': linesWithTerm(3) });

    const harness = new Harness();
    expect(await harness.start({ projectRoot: projectB })).toEqual({ started: true });
    await waitFor('the scan to settle', () => harness.settled());

    expect([...new Set(harness.rows().map((r) => r.relPath))]).toEqual(['only-in-b.ts']);
    expect(harness.rows()).toHaveLength(3);
    // The assertion that carries Principle I: not merely that A's rows are absent from the result,
    // but that A's tree was never listed and none of its files was ever opened.
    const a = normaliseForCompare(resolve(projectA));
    for (const path of [...harness.fs.listed, ...harness.fs.read]) {
      expect(normaliseForCompare(path).startsWith(a)).toBe(false);
    }
  });
});

describe("SC-004's scan half (043 T053b)", () => {
  it('streams a 5,000-file corpus in bounded batches, the first before the scan ends', async () => {
    const root = await makeRoot();
    const DIRS = 40;
    const PER_DIR = 125;
    for (let d = 0; d < DIRS; d++) {
      const dir = join(root, `pkg${d}`);
      await mkdir(dir, { recursive: true });
      await Promise.all(
        Array.from({ length: PER_DIR }, (_, i) =>
          writeFile(join(dir, `f${i}.ts`), `export const a${i} = ${TERM};\n`),
        ),
      );
    }

    const harness = new Harness();
    expect(await harness.start({ projectRoot: root })).toEqual({ started: true });
    await waitFor('the 5,000-file scan to settle', () => harness.settled());

    const updates = harness.updates();
    const carrying = updates.filter((u) => (u.rows?.length ?? 0) > 0);
    expect(harness.rows()).toHaveLength(DIRS * PER_DIR);
    // The falsifiable half: asserting the CONSTANT rather than "it is bounded", which no
    // implementation can fail.
    for (const u of carrying) expect(u.rows?.length).toBeLessThanOrEqual(MAX_ROWS_PER_BATCH);
    expect(carrying.length).toBeGreaterThanOrEqual(Math.ceil((DIRS * PER_DIR) / MAX_ROWS_PER_BATCH));
    expect(carrying[0].status).toBe('running');
    expect(carrying.at(-1)?.status === 'complete' || harness.settled()?.status === 'complete').toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 043 T245 (FR-092, FR-092a) — a scope that names a FILE
 *
 * The first assertion below is the shipped defect, and it was red before a line of the service
 * changed: the walk called `readdir` on the file, the `ENOTDIR` was swallowed as an unreadable
 * directory, and the scan completed having read nothing — so the panel said "No matches" about a
 * file full of them. A false negative is worse than a refusal, because nothing on screen says the
 * search did not happen.
 * ────────────────────────────────────────────────────────────────────────── */

describe('a scope that names a single file (043 T245, FR-092)', () => {
  it('searches that file, and only that file, even with siblings holding the term', async () => {
    const root = await makeRoot();
    await seed(root, {
      'src/app.ts': linesWithTerm(3),
      'src/sibling.ts': linesWithTerm(5),
      'top.ts': linesWithTerm(2),
    });

    const harness = new Harness();
    expect(await harness.start({ projectRoot: root, scopeSubPath: 'src/app.ts' })).toEqual({
      started: true,
    });
    await waitFor('the scan to settle', () => harness.settled());

    expect(harness.settled()?.status).toBe('complete');
    expect(harness.rows()).toHaveLength(3);
    // ROOT-relative, exactly as a folder scope's rows are — so a double-click, an Open In target
    // and a commit all resolve the file they would from anywhere else.
    expect([...new Set(harness.rows().map((r) => r.relPath))]).toEqual(['src/app.ts']);
    // Only the named file was read, and no directory was listed to find it.
    expect(harness.fs.read.map((p) => normaliseForCompare(p))).toEqual([
      normaliseForCompare(join(root, 'src', 'app.ts')),
    ]);
    expect(harness.fs.listed).toEqual([]);
  });

  it('holds the file for staleness under its root-relative path (FR-045a)', async () => {
    const root = await makeRoot();
    await seed(root, { 'src/app.ts': linesWithTerm(1) });
    const harness = new Harness();
    await harness.start({ projectRoot: root, scopeSubPath: 'src/app.ts' });
    await waitFor('the scan to settle', () => harness.settled());

    await writeFile(join(root, 'src', 'app.ts'), linesWithTerm(4));
    await harness.service.noteDirectoryChanged(root, 'src');

    expect(harness.updates().at(-1)?.staleFiles).toEqual(['src/app.ts']);
  });

  it('skips a BINARY file named as the scope, and says so as one skipped file', async () => {
    const root = await makeRoot();
    await seed(root, {
      'assets/blob.bin': new Uint8Array([...Buffer.from(TERM), 0, 1, 2, ...Buffer.from(TERM)]),
    });
    const harness = new Harness();
    await harness.start({ projectRoot: root, scopeSubPath: 'assets/blob.bin' });
    await waitFor('the scan to settle', () => harness.settled());

    const settled = harness.settled() as FileSearchUpdate;
    expect(harness.rows()).toHaveLength(0);
    // The same per-file rule a folder scope applies — a file scope acquires no rules of its own.
    expect(settled.skipped).toBe(1);
    expect(settled.filesScanned).toBe(0);
  });

  it('skips a file over the size limit, rather than reading it', async () => {
    const root = await makeRoot();
    await seed(root, { 'big.ts': linesWithTerm(60) });
    const harness = new Harness();
    harness.maxFileBytes = 200;
    await harness.start({ projectRoot: root, scopeSubPath: 'big.ts' });
    await waitFor('the scan to settle', () => harness.settled());

    expect(harness.settled()?.skipped).toBe(1);
    expect(harness.fs.read).toEqual([]);
  });

  it('SEARCHES an excluded file that the scope names explicitly', async () => {
    /*
     * FR-092, derived from what a folder scope already does: the walk tests every entry it reaches
     * against the exclusions and never tests the scope itself. A user who names one file has
     * answered the question the exclusions exist to ask on their behalf.
     */
    const root = await makeRoot();
    await seed(root, { 'node_modules/dep/index.js': linesWithTerm(2) });
    const harness = new Harness();
    harness.globs = ['node_modules'];
    await harness.start({ projectRoot: root, scopeSubPath: 'node_modules/dep/index.js' });
    await waitFor('the scan to settle', () => harness.settled());

    expect(harness.rows().map((r) => r.relPath)).toEqual([
      'node_modules/dep/index.js',
      'node_modules/dep/index.js',
    ]);
  });

  it('FR-092a — a scoped file that is deleted is marked missing, and the rows stay listed', async () => {
    const root = await makeRoot();
    await seed(root, { 'src/app.ts': linesWithTerm(2) });
    const harness = new Harness();
    await harness.start({ projectRoot: root, scopeSubPath: 'src/app.ts' });
    await waitFor('the scan to settle', () => harness.settled());
    const generation = harness.settled()?.generation;

    await rm(join(root, 'src', 'app.ts'));
    await harness.service.noteDirectoryChanged(root, 'src');

    const raised = harness.updates().find((u) => u.status === 'scopeMissing');
    expect(raised?.generation).toBe(generation);
    expect(raised?.rows ?? []).toHaveLength(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 043 T247 (FR-091, FR-091a) — clearing a panel's run, for every window that watches it
 *
 * ══ WHY THE RUN IS KEPT RATHER THAN RELEASED ══
 *
 * `drop` releases a run and forgets it. Doing that here would let the NEXT scan open a fresh run at
 * generation 1 — and the renderer, still holding the cleared run's higher number, drops anything
 * from a lower generation as superseded. The panel would never show another result. So a clear
 * empties the run and moves it on a generation, and the last test below reads the stream back
 * through the renderer's own fold to prove the next search is shown.
 * ────────────────────────────────────────────────────────────────────────── */

describe('clearing a panel (043 T247, FR-091a)', () => {
  function asRead(updates: readonly FileSearchUpdate[]): FileSearchResults {
    let state = NO_FILE_SEARCH_RESULTS;
    for (const u of updates) state = applyFileSearchUpdate(state, u);
    return state;
  }

  it('tells EVERY window watching the run that the panel has not been run, with no rows', async () => {
    const root = await makeRoot();
    await seed(root, { 'a.ts': linesWithTerm(3) });
    const harness = new Harness();
    const MIRROR = 2;
    harness.service.attach(MIRROR, PANEL);
    await harness.start({ projectRoot: root });
    await waitFor('the scan to settle', () => harness.settled());
    const generation = harness.settled()?.generation ?? 0;
    harness.sent.length = 0;

    harness.service.clear(WINDOW, PANEL);

    const cleared = harness.sent.filter((s) => s.payload.status === 'notRun');
    expect(cleared.map((s) => s.id).sort()).toEqual([WINDOW, MIRROR]);
    for (const { payload } of cleared) {
      expect(payload.generation).toBe(generation + 1);
      expect(payload.rows ?? []).toHaveLength(0);
      expect(payload.totalMatches).toBe(0);
    }
  });

  it('empties the query for the OTHER window, and makes the clearing window its owner (FR-078b)', async () => {
    const root = await makeRoot();
    await seed(root, { 'a.ts': linesWithTerm(1) });
    const harness = new Harness();
    const MIRROR = 2;
    harness.service.attach(MIRROR, PANEL);
    await harness.start({ projectRoot: root });
    await waitFor('the scan to settle', () => harness.settled());
    harness.sent.length = 0;

    // The MIRROR clears — so the mirror's box is now the authoritative one, and the window that
    // started the search is the follower that must be told the term is gone.
    harness.service.clear(MIRROR, PANEL);

    const toStarter = harness.sent.find((s) => s.id === WINDOW)?.payload;
    const toMirror = harness.sent.find((s) => s.id === MIRROR)?.payload;
    expect(toStarter?.adoptQuery?.term).toBe('');
    expect(toMirror?.adoptQuery).toBeUndefined();
  });

  it('a window that is not watching the panel cannot clear it', async () => {
    const root = await makeRoot();
    await seed(root, { 'a.ts': linesWithTerm(2) });
    const harness = new Harness();
    await harness.start({ projectRoot: root });
    await waitFor('the scan to settle', () => harness.settled());
    harness.sent.length = 0;

    harness.service.clear(99, PANEL);

    expect(harness.sent).toEqual([]);
  });

  it('stops a scan that is still walking, and nothing from it arrives afterwards', async () => {
    const root = await makeRoot();
    const files: Record<string, string> = {};
    for (let i = 0; i < 200; i += 1) files[`f${i}.ts`] = linesWithTerm(5);
    await seed(root, files);
    const harness = new Harness();
    void harness.start({ projectRoot: root });
    await waitFor('the first batch', () => (harness.rows().length > 0 ? true : undefined));

    harness.service.clear(WINDOW, PANEL);
    const clearedAt = harness.sent.length;
    const clearGeneration = harness.sent.at(-1)?.payload.generation ?? 0;
    // Long enough for the rest of a 200-file walk to have landed, had it kept going.
    await new Promise((r) => setTimeout(r, 300));

    const after = harness.sent.slice(clearedAt).map((s) => s.payload);
    expect(after.filter((u) => u.generation >= clearGeneration)).toEqual([]);
    expect(asRead(harness.updates()).rows).toHaveLength(0);
  });

  it('releases what the run held, so a later change to a file re-states nothing', async () => {
    const root = await makeRoot();
    await seed(root, { 'a.ts': linesWithTerm(2) });
    const harness = new Harness();
    await harness.start({ projectRoot: root });
    await waitFor('the scan to settle', () => harness.settled());
    harness.service.clear(WINDOW, PANEL);
    harness.sent.length = 0;

    await writeFile(join(root, 'a.ts'), linesWithTerm(4));
    await harness.service.noteDirectoryChanged(root, '');

    expect(harness.sent).toEqual([]);
  });

  it('does not raise a missing scope over a cleared panel whose old scope has since gone', async () => {
    const root = await makeRoot();
    await seed(root, { 'sub/a.ts': linesWithTerm(1) });
    const harness = new Harness();
    await harness.start({ projectRoot: root, scopeSubPath: 'sub' });
    await waitFor('the scan to settle', () => harness.settled());
    harness.service.clear(WINDOW, PANEL);
    harness.sent.length = 0;

    await rm(join(root, 'sub'), { recursive: true, force: true });
    await harness.service.noteDirectoryChanged(root, '');

    expect(harness.sent).toEqual([]);
  });

  it('is a no-op for a panel that has never been searched', () => {
    const harness = new Harness();
    harness.service.attach(WINDOW, PANEL);
    harness.service.clear(WINDOW, PANEL);
    expect(harness.sent).toEqual([]);
  });

  it('leaves the panel able to show the NEXT search — the reason the run is kept', async () => {
    const root = await makeRoot();
    await seed(root, { 'a.ts': linesWithTerm(2) });
    const harness = new Harness();
    await harness.start({ projectRoot: root });
    await waitFor('the first scan', () => harness.settled());
    harness.service.clear(WINDOW, PANEL);

    const beforeSecond = harness.sent.length;
    await harness.start({ projectRoot: root });
    await waitFor('the second scan', () =>
      harness.sent.slice(beforeSecond).some((s) => s.payload.status === 'complete') ? true : undefined,
    );

    // Read through the renderer's own fold: a second run at a LOWER generation than the clear would
    // be dropped here as superseded, and the panel would sit empty forever.
    const state = asRead(harness.updates());
    expect(state.status).toBe('complete');
    expect(state.rows).toHaveLength(2);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 043 T263 (FR-045a, SC-012, FR-030a) — a scope typed in a different case from the disk
 *
 * A typed scope keeps the user's spelling (FR-092b), so a scope typed `SRC` over `src/` produces
 * rows — and `held` staleness keys — spelled `SRC/…`. The watcher reports the directory as the disk
 * spells it, `src`, and both the staleness filter and the missing-scope check compared the two
 * CASE-SENSITIVELY. So an edited file was never marked stale, and a deleted nested scope never marked
 * missing, on the one platform this app ships for — where `SRC` and `src` are the same folder and
 * every other comparison in the app already treats them so (`normaliseForCompare`).
 *
 * Skipped where the filesystem is case-sensitive, because there is no `SRC` there to type.
 * ────────────────────────────────────────────────────────────────────────── */

describe('a scope typed in a different case from the disk (043 T263)', () => {
  async function caseInsensitive(root: string): Promise<boolean> {
    await seed(root, { 'probe/x.txt': 'x' });
    return new NodeFileSystem(async () => {}).exists(join(root, 'PROBE', 'x.txt'));
  }

  it('marks an edited file stale when the scope was typed SRC over src/', async () => {
    const root = await makeRoot();
    if (!(await caseInsensitive(root))) return;
    await seed(root, { 'src/a.ts': linesWithTerm(2) });

    const harness = new Harness();
    expect(await harness.start({ projectRoot: root, scopeSubPath: 'SRC' })).toEqual({ started: true });
    await waitFor('the scan to settle', () => harness.settled());
    expect(harness.rows().length).toBeGreaterThan(0);

    await writeFile(join(root, 'src', 'a.ts'), linesWithTerm(5));
    // The watcher's spelling — the disk's — not the one the user typed.
    await harness.service.noteDirectoryChanged(root, 'src');

    const stale = harness.updates().at(-1)?.staleFiles ?? [];
    expect(stale.map((p) => p.toLowerCase())).toEqual(['src/a.ts']);
  });

  it('marks a nested scope missing when it is deleted, whatever case it was typed in', async () => {
    const root = await makeRoot();
    if (!(await caseInsensitive(root))) return;
    await seed(root, { 'src/deep/a.ts': linesWithTerm(1) });

    const harness = new Harness();
    await harness.start({ projectRoot: root, scopeSubPath: 'SRC/deep' });
    await waitFor('the scan to settle', () => harness.settled());
    harness.sent.length = 0;

    await rm(join(root, 'src', 'deep'), { recursive: true, force: true });
    await harness.service.noteDirectoryChanged(root, 'src');

    expect(harness.updates().some((u) => u.status === 'scopeMissing')).toBe(true);
  });
});
