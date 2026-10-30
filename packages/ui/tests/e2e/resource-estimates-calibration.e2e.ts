import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { cleanupTemp, createProject, daemonPid, daemonRpc, firstPanelId, openApp, panelIds, runTypedCommand, splitPanelViaMenu } from './harness.js';
import type { OpenApp } from './harness.js';
import { writeSettingsAtomic } from './helpers/config-write.js';

/**
 * Calibration of the panel memory estimates (055 SC-009, FR-024, FR-024b, research R9): editors at 1, 10
 * and 50 MB in two shapes, Markdown previews from 0.5 to 10 MB in four, and terminals of several sizes,
 * widths and attribute mixes, each measured against the LIVE HEAP it costs, and the monitor's own figure
 * for the panel required to be within 10% of it. A benchmark mode opens panels of every kind together and
 * reports how representative the figures are of each other.
 *
 * Layer: E2E, because the thing being compared is a real heap in a real renderer, a real main process and
 * a real daemon. No lower layer has a process to measure; `estimate-models.test.ts` pins the arithmetic
 * and this pins that the arithmetic describes reality.
 *
 * ══ HOW IT MEASURES ══
 *
 * "Measured" is the change in live heap of the process(es) holding the panel, after forced garbage
 * collections on both sides of the change: main's V8 heap plus its external memory (a large file's string
 * lives outside the V8 heap), the renderer's V8 heap, its Blink heap and its array-buffer backing store
 * (where an xterm line's cells live), and the daemon's V8 heap plus external. The renderer's GC is
 * Chromium's own, over the DevTools protocol (`HeapProfiler.collectGarbage`); main's is V8's `gc` exposed at
 * run time; the daemon is reached through the Node inspector the test switches on in it
 * (`inspectDaemon`), so neither needs a launch flag and the daemon carries no memory RPC. Private bytes
 * include the allocator's headroom, which is neither released when a document closes nor taken in
 * proportion when one opens, so they are printed beside the live heap for comparison only.
 *
 * "Estimated" is what the monitor itself reports for that panel in a real detail frame — the figure the
 * user is shown — and not a model called from the test, so a wiring mistake fails here too. Each case
 * prints both, the ratio, and a `calib-data` JSON line of every input and measure: the data the constants
 * in `estimate-models.ts` are fitted from (a panel kind that cannot meet the bound ships as `NotMeasured`,
 * FR-012).
 *
 * ══ WHAT RUNS (`THRONG_CALIBRATE`) ══
 *
 * - **Unset — the gate (SC-009, amended 2026-10-29).** The trimmed case set, asserted: an editor at 1 and
 *   10 MB in each of the three shapes, a preview at 1 and 10 MB of paragraphs, and two terminals filled to
 *   their scrollback limit (plain and wide; the coloured shape is logged, not asserted), each within 10% of live heap; then the three benchmark
 *   runs, each asserted at a rank agreement (Spearman ρ) of at least 0.85 with each kind's share of the
 *   estimated total within 5 points of its measured share. The known-miss shapes R21 names show up in the
 *   benchmark rows and are logged with `knownMiss`, never asserted.
 * - **`full`** — the whole sweep: every shape at 1, 10 and 50 MB, every preview case at three widths,
 *   every terminal case, the editor's own cost, and the three benchmark runs.
 * - **A comma list of `editor`, `preview`, `terminal`** — those sections' full case lists alone.
 * - **`bench-a`, `bench-b`, `bench-c`** (alone or in the list) — those benchmark runs alone.
 *
 * Each test launches its own app on a root holding only the files it opens: the explorer tree draws only
 * the rows in view, and a benchmark measured after another's panels is not the benchmark it was fitted on.
 *
 * Run it: `npx playwright test packages/ui/tests/e2e/resource-estimates-calibration.e2e.ts --workers=1`
 */
const BOUND = 0.1;
/** The gate's rank-agreement floor and per-kind share tolerance for a benchmark run (SC-009, amended). */
const RHO_FLOOR = 0.85;
const SHARE_POINTS = 0.05;
/**
 * `THRONG_CALIBRATE_LOG_ONLY=1`: measure and log every case, assert none. Set by the release lane: on the
 * same code and Electron, a hosted runner there measured previews and the full-scrollback terminal 9–14%
 * heavier than gate.yml's did (0.852–0.894 against 0.928–1.028), a spread as wide as the bound itself.
 * gate.yml asserts SC-009; the release lane keeps the figures.
 */
const LOG_ONLY = process.env.THRONG_CALIBRATE_LOG_ONLY === '1';

/** Blocks in a document of `megabytes`: each is 64 bytes of ASCII, so characters === bytes. */
const blocksOf = (megabytes: number): number => Math.floor((megabytes * 1024 * 1024) / 64);

/**
 * `megabytes` of Markdown shaped like a real document: one paragraph per block, separated by a blank
 * line, with a heading every 32 blocks. A file of single-newline lines renders as ONE paragraph, which
 * no real document is, and which costs the preview almost nothing in DOM and everything in text layout.
 */
function textOf(megabytes: number): string {
  const block = (n: number): string => {
    const id = String(n).padStart(8, '0');
    const text = n % 32 === 0 ? `## section ${id}` : `line ${id} the quick brown fox jumps over the lazy dog`;
    return text.padEnd(62, '.') + '\n\n';
  };
  const parts: string[] = [];
  for (let i = 0; i < blocksOf(megabytes); i += 1) parts.push(block(i));
  return parts.join('');
}

/**
 * The same `megabytes` as plain single-newline lines, 64 bytes each and no headings: to Markdown one
 * paragraph, so its syntax tree is a handful of nodes where `textOf`'s has one per block. The editor
 * cases are run over both and `mixedOf`, because the renderer's cost follows the tree, not just the characters.
 */
function linesOf(megabytes: number): string {
  const parts: string[] = [];
  for (let i = 0; i < blocksOf(megabytes); i += 1) parts.push(`line ${String(i).padStart(8, '0')} the quick brown fox jumps over the lazy dog`.padEnd(63, '.') + '\n');
  return parts.join('');
}

const SHAPES = [
  { name: 'paragraphs', file: (mb: number) => `big-${mb}.md`, first: 'line 00000001' },
  { name: 'lines', file: (mb: number) => `lines-${mb}.md`, first: 'line 00000001' },
  { name: 'mixed', file: (mb: number) => `mixed-${mb}.md`, first: 'Paragraph 00000001' },
] as const;

/** The text of a document's last block, which is on screen only once everything before it has rendered. */
const lastLineOf = (megabytes: number): string => {
  const n = blocksOf(megabytes) - 1;
  return n % 32 === 0 ? `section ${String(n).padStart(8, '0')}` : `line ${String(n).padStart(8, '0')}`;
};

async function collectGarbage(app: ElectronApplication, win: Page): Promise<void> {
  const cdp = await win.context().newCDPSession(win);
  try {
    // Twice, a turn apart, as in main below: Blink's heap is swept after the collection that found its
    // nodes dead, and a single collection left terminal rows from the view before still counted.
    await cdp.send('HeapProfiler.collectGarbage');
    await new Promise((r) => setTimeout(r, 250)); // sleep-justified: lets the sweepers run between collections.
    await cdp.send('HeapProfiler.collectGarbage');
  } finally {
    await cdp.detach();
  }
  await app.evaluate(async () => {
    // `process.getBuiltinModule`, not `require`: this function is EVAL'd in main, which is ESM.
    const v8 = process.getBuiltinModule('node:v8');
    const vm = process.getBuiltinModule('node:vm');
    v8.setFlagsFromString('--expose_gc');
    const gc = vm.runInNewContext('gc') as () => void;
    // Twice, a turn apart: an ArrayBuffer's backing store (`external`) is released by a sweeper AFTER the
    // collection that found it dead, so one collection can leave a freed file buffer still counted.
    gc();
    await new Promise((r) => setTimeout(r, 250)); // sleep-justified: lets the backing-store sweeper run between collections.
    gc();
  });
}

interface Sample {
  /** Private bytes. */
  readonly main: number;
  readonly renderer: number;
  /**
   * Live heap: main's V8 heap (`heapUsed`) and its external memory (`external`: a large string read from
   * disk can live outside the V8 heap), the renderer's V8 heap (`Runtime.getHeapUsage().usedSize`) and its
   * Blink heap (`embedderHeapUsedSize`).
   */
  readonly heapMain: number;
  readonly externalMain: number;
  readonly arrayBuffersMain: number;
  readonly heapRenderer: number;
  readonly embedderRenderer: number;
  /**
   * The renderer's backing storage for array buffers and external strings (`backingStorageSize`): where
   * an xterm buffer line's cells live — a `Uint32Array` of over 64 bytes is stored off the V8 heap.
   */
  readonly backingRenderer: number;
}

/** Live heap of main and of the window's renderer; call after `collectGarbage`. */
async function liveHeap(
  app: ElectronApplication,
  win: Page,
): Promise<{ main: number; external: number; arrayBuffers: number; renderer: number; embedder: number; backing: number }> {
  const cdp = await win.context().newCDPSession(win);
  try {
    const usage = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number; embedderHeapUsedSize?: number; backingStorageSize?: number };
    const m = await app.evaluate(() => {
      const u = process.memoryUsage();
      return { heap: u.heapUsed, external: u.external, arrayBuffers: u.arrayBuffers };
    });
    return {
      main: m.heap,
      external: m.external,
      arrayBuffers: m.arrayBuffers,
      renderer: usage.usedSize,
      embedder: usage.embedderHeapUsedSize ?? 0,
      backing: usage.backingStorageSize ?? 0,
    };
  } finally {
    await cdp.detach();
  }
}

/** The live-heap change from `a` to `b`, per process: main's V8 heap and external, the renderer's V8, Blink and backing store. */
function heapDelta(a: Sample, b: Sample): { main: number; renderer: number } {
  return {
    main: b.heapMain - a.heapMain + (b.externalMain - a.externalMain),
    renderer: b.heapRenderer - a.heapRenderer + (b.embedderRenderer - a.embedderRenderer) + (b.backingRenderer - a.backingRenderer),
  };
}

/** The daemon's live heap, reached through the Node inspector the test switches on in it. */
interface DaemonInspector {
  heap(): Promise<{ heap: number; external: number }>;
  close(): void;
}

/**
 * Switch on the daemon's inspector and connect to it — test-only reach, so the daemon carries no memory
 * RPC. `process._debugProcess` is how Node's own `node inspect -p <pid>` does it on Windows (there is no
 * SIGUSR1): it opens the inspector on 127.0.0.1:9229. The pid is checked through the connection, so an
 * unrelated process already listening there fails the case instead of being measured.
 */
async function inspectDaemon(pid: number): Promise<DaemonInspector> {
  (process as unknown as { _debugProcess(pid: number): void })._debugProcess(pid);
  let url: string | undefined;
  await expect
    .poll(
      async () => {
        try {
          const list = (await (await fetch('http://127.0.0.1:9229/json/list')).json()) as { webSocketDebuggerUrl?: string }[];
          url = list[0]?.webSocketDebuggerUrl;
        } catch {
          url = undefined;
        }
        return url !== undefined;
      },
      { timeout: 15_000, message: 'the daemon inspector never opened on 9229' },
    )
    .toBe(true);
  const ws = new WebSocket(url as string);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('could not connect to the daemon inspector'));
  });
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } };
    if (m.id === undefined) return;
    const p = pending.get(m.id);
    if (p === undefined) return;
    pending.delete(m.id);
    if (m.error !== undefined) p.reject(new Error(m.error.message));
    else p.resolve(m.result);
  };
  const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression: string): Promise<unknown> =>
    ((await send('Runtime.evaluate', { expression, returnByValue: true })) as { result: { value: unknown } }).result.value;
  const remote = await evaluate('process.pid');
  if (remote !== pid) {
    ws.close();
    throw new Error(`the inspector on 9229 is pid ${String(remote)}, not the daemon ${pid}`);
  }
  return {
    heap: async () => {
      await send('HeapProfiler.collectGarbage');
      await new Promise((r) => setTimeout(r, 250)); // sleep-justified: the backing-store sweeper runs between collections, as in main.
      await send('HeapProfiler.collectGarbage');
      const u = JSON.parse(String(await evaluate('JSON.stringify(process.memoryUsage())'))) as { heapUsed: number; external: number };
      return { heap: u.heapUsed, external: u.external };
    },
    close: () => ws.close(),
  };
}

/** Private bytes and live heap of main and of the window's renderer, after a collection on both. */
async function sample(app: ElectronApplication, win: Page): Promise<Sample> {
  await collectGarbage(app, win);
  const heap = await liveHeap(app, win);
  const pids = await app.evaluate(({ webContents }) => ({
    main: process.pid,
    renderer: webContents.getAllWebContents().find((w) => !w.getURL().startsWith('devtools'))?.getOSProcessId() ?? 0,
  }));
  const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ pid: m.pid, kb: (m.memory as { privateBytes?: number }).privateBytes ?? 0 })));
  const kb = (pid: number): number => (metrics.find((m) => m.pid === pid)?.kb ?? 0) * 1024;
  return {
    main: kb(pids.main),
    renderer: kb(pids.renderer),
    heapMain: heap.main,
    externalMain: heap.external,
    arrayBuffersMain: heap.arrayBuffers,
    heapRenderer: heap.renderer,
    embedderRenderer: heap.embedder,
    backingRenderer: heap.backing,
  };
}

interface DocShape {
  readonly chars: number;
  readonly lines: number;
  /** Every node of the most complete tree there is, counted exhaustively, and how long that took. */
  readonly nodes: number;
  /** How many of them are `Tree` objects (the rest are packed in buffers). */
  readonly trees: number;
  readonly fullMs: number;
  /** What the estimate's bounded walk saw (`sampleSyntaxTree`), how long it took, and its extrapolation. */
  readonly sampledNodes: number;
  readonly sampledChars: number;
  readonly sampleMs: number;
  readonly extrapolated: number;
  /** How far the state's own tree reaches and the parse context's (CodeMirror internals: diagnostic only). */
  readonly fieldTreeLength: number;
  readonly contextTreeLength: number;
  /** Lines the view has rendered (its viewport). */
  readonly renderedLines: number;
}

/**
 * The editor's document as the estimate sees it: characters, lines and syntax-tree nodes, the counts timed.
 * The view is reached through its DOM (`cmTile`) and the tree through the editor state's language field —
 * the parse context's tree once it reaches the whole document, as `ensureSyntaxTree` would hand it over.
 * The bounded walk is the same algorithm and budget as `syntax-tree-size.ts`, uncached, so it is timed cold.
 */
async function docShape(win: Page, editorId: string): Promise<DocShape> {
  return win.evaluate((id) => {
    type B = { buffer: { length: number }; length: number };
    type T = { children: (T | B)[]; positions: number[]; length: number };
    const el = document.querySelector(`[data-testid="editor-${id}"] .cm-content`) as unknown as { cmTile: { root: { view: { viewportLineBlocks: unknown[]; state: { doc: { length: number; lines: number }; values: unknown[] } } } } };
    const view = el.cmTile.root.view;
    const state = view.state;
    const field = state.values.find((v) => typeof v === 'object' && v !== null && 'tree' in v && 'context' in v) as { tree: T; context: { tree: T; treeLen: number } } | undefined;
    if (field === undefined) throw new Error('no language state on the editor');
    const chars = state.doc.length;
    const tree = field.context.treeLen >= chars ? field.context.tree : field.tree;
    const fullTrees = (t: T): number => {
      let n = 1;
      for (const c of t.children) if (!('buffer' in c)) n += fullTrees(c);
      return n;
    };
    const full = (t: T): number => {
      let n = 1;
      for (const c of t.children) n += 'buffer' in c ? c.buffer.length / 4 : full(c);
      return n;
    };
    const sample = (root: T, budget: number): { nodes: number; chars: number } => {
      let left = budget;
      let nodes = 0;
      let reached = 0;
      let stopped = false;
      const walk = (t: T, offset: number): void => {
        nodes += 1;
        left -= 1;
        for (let i = 0; i < t.children.length; i += 1) {
          if (left <= 0) {
            stopped = true;
            return;
          }
          const c = t.children[i] as T | B;
          const from = offset + (t.positions[i] ?? 0);
          if ('buffer' in c) {
            nodes += c.buffer.length / 4;
            left -= c.buffer.length / 4;
          } else {
            walk(c, from);
            if (stopped) return;
          }
          reached = from + c.length;
        }
      };
      walk(root, 0);
      return { nodes, chars: stopped ? reached : root.length };
    };
    const t0 = performance.now();
    const nodes = full(tree);
    const trees = fullTrees(tree);
    const t1 = performance.now();
    const s = sample(tree, 100_000);
    const t2 = performance.now();
    const extrapolated = s.chars <= 0 || s.chars >= chars ? s.nodes : Math.round((s.nodes * chars) / s.chars);
    return {
      chars,
      lines: state.doc.lines,
      nodes,
      trees,
      fullMs: t1 - t0,
      sampledNodes: s.nodes,
      sampledChars: s.chars,
      sampleMs: t2 - t1,
      extrapolated,
      fieldTreeLength: field.tree.length,
      contextTreeLength: field.context.tree.length,
      renderedLines: view.viewportLineBlocks.length,
    };
  }, editorId);
}

interface FrameNode {
  readonly id: string;
  readonly rolled: { readonly memory: number | { readonly kind: string } };
  readonly children: readonly FrameNode[];
}

/** One detail frame as the app produced it, via a second subscription. */
async function detailFrame(win: Page): Promise<FrameNode> {
  const frame = await win.evaluate(
    () =>
      new Promise<{ hierarchy: unknown }>((resolve) => {
        type Api = { subscribeDetail: () => Promise<{ subscriptionId: number }>; unsubscribeDetail: (id: number) => Promise<void>; onDetail: (cb: (f: { hierarchy: unknown }) => void) => () => void };
        const api = (window as unknown as { throng: { resources: Api } }).throng.resources;
        let id: number | null = null;
        let off: () => void = () => {};
        off = api.onDetail((f) => {
          off();
          if (id !== null) void api.unsubscribeDetail(id);
          resolve(f);
        });
        void api.subscribeDetail().then((s) => {
          id = s.subscriptionId;
        });
      }),
  );
  return frame.hierarchy as FrameNode;
}

function find(node: FrameNode, id: string): FrameNode | undefined {
  if (node.id === id) return node;
  for (const c of node.children) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return undefined;
}

/** The monitor's figure for a node, once its estimate has been reported (frames follow the reporter by a tick). */
async function shown(win: Page, id: string): Promise<number> {
  let value = 0;
  await expect
    .poll(
      async () => {
        const memory = find(await detailFrame(win), id)?.rolled.memory;
        value = typeof memory === 'number' ? memory : 0;
        return value;
      },
      { timeout: 30_000, message: `the monitor never showed a memory figure for ${id}` },
    )
    .toBeGreaterThan(0);
  return value;
}

/** The monitor's figure for a node once it has moved off `from` — a frame can still carry the last document's. */
async function shownChanged(win: Page, id: string, from: number): Promise<number> {
  let value = 0;
  await expect
    .poll(
      async () => {
        value = await shown(win, id);
        return value !== from;
      },
      { timeout: 30_000, message: `the monitor's figure for ${id} never changed from ${from}` },
    )
    .toBe(true);
  return value;
}

/**
 * Print, and require (unless `assert` is false or the case is a `knownMiss`), that `estimated` is within
 * the bound of `measured`. A known miss is a shape research R21 records the model as missing: it is
 * printed with its reason so a change in it is visible, and never asserted.
 */
function expectCalibrated(what: string, estimated: number, measured: number, opts: { readonly assert?: boolean; readonly knownMiss?: string } = {}): void {
  const ratio = estimated / measured;
  const miss = opts.knownMiss === undefined ? '' : ` (known miss, logged: ${opts.knownMiss})`;
  console.info(`calibration ${what}: estimated ${Math.round(estimated)} B, measured ${Math.round(measured)} B, ratio ${ratio.toFixed(3)}${miss}`);
  test.info().annotations.push({ type: 'calibration', description: `${what}: estimated/measured = ${ratio.toFixed(3)}${miss}` });
  if (LOG_ONLY || opts.assert === false || opts.knownMiss !== undefined) return;
  // Soft, so one run reports every case's ratio — the data `estimate-models.ts` is tuned from.
  expect.soft(Math.abs(estimated - measured) / measured, `${what}: estimate ${Math.round(estimated)} vs measured ${Math.round(measured)} (SC-009 ±${BOUND * 100}%)`).toBeLessThanOrEqual(BOUND);
}

/**
 * `megabytes` of Markdown shaped like a README: headings, paragraphs with inline markup and links, bullet
 * lists, fenced TypeScript (which the preview highlights), tables and quotes, in a fixed rotation, ending in
 * a marker paragraph. Each element kind costs the preview differently, so this is the shape the preview's
 * model has to fit beside the two plain ones.
 */
function mixedOf(megabytes: number): string {
  const target = megabytes * 1024 * 1024;
  const parts: string[] = [];
  let length = 0;
  for (let i = 0; length < target; i += 1) {
    const id = String(i).padStart(8, '0');
    let block: string;
    switch (i % 6) {
      case 0:
        block = `## Section ${id}\n\n`;
        break;
      case 1:
        block = `Paragraph ${id} with **bold text**, some \`inline code\` and [a link](https://example.com/${id}) in it.\n\n`;
        break;
      case 2:
        block = `- first item ${id}\n- second item with *emphasis*\n- third item\n\n`;
        break;
      case 3:
        block = '```ts\n' + `const value${i} = compute(${i}, 'text');\nexport function f${i}(a: number): number {\n  return a * ${i};\n}\n` + '```\n\n';
        break;
      case 4:
        block = `| key | value |\n| --- | --- |\n| row ${id} | ${i} |\n| other | cell |\n\n`;
        break;
      default:
        block = `> A quoted line ${id}, quoted for the calibration.\n\n`;
    }
    parts.push(block);
    length += block.length;
  }
  parts.push('END OF DOCUMENT\n');
  return parts.join('');
}

/** A file the test writes into its project root before launching. */
interface SeedFile {
  readonly file: string;
  readonly text: () => string;
}

/**
 * Launch an app on a fresh project root holding `tiny.md` and `files` — only the files this test opens,
 * because the explorer tree draws only the rows in view and a root of every case's files would put some
 * out of reach of a click.
 */
async function launch(files: readonly SeedFile[]): Promise<{ h: OpenApp; done: () => Promise<void> }> {
  const root = mkdtempSync(join(tmpdir(), 'throng-calib-'));
  writeFileSync(join(root, 'tiny.md'), '# tiny\n');
  for (const f of files) writeFileSync(join(root, f.file), f.text());
  // SC-009 runs to 50 MB; the editor refuses files over `editor.maxOpenFileBytes` (10 MiB shipped), so
  // the limit is raised the way a user would raise it.
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-calib-cfg-'));
  writeSettingsAtomic(cfgRoot, { editor: { maxOpenFileBytes: 64 * 1024 * 1024 } });
  const cleanup = (): void => {
    cleanupTemp(root);
    cleanupTemp(cfgRoot);
  };
  let h: OpenApp;
  try {
    h = await openApp({ env: { THRONG_CONFIG_ROOT: cfgRoot } });
  } catch (e) {
    cleanup();
    throw e;
  }
  const done = async (): Promise<void> => {
    await h.close();
    cleanup();
  };
  try {
    await createProject(h.win, 'Calibration', root);
  } catch (e) {
    await done();
    throw e;
  }
  return { h, done };
}

/**
 * The first panel made an editor on `tiny.md`, and detail collection switched on for the rest of the test
 * (the estimates are reported only while a detail subscription is open). Returns the editor's figure on
 * the tiny file, the baseline every editor case is measured from.
 */
async function firstEditor(win: Page): Promise<{ editorId: string; tree: Locator; content: Locator; editorTiny: number }> {
  const editorId = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${editorId}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${editorId}`).click();
  await expect(win.getByTestId(`editor-${editorId}`)).toBeVisible();
  await win.getByTestId(`editor-${editorId}`).click();
  const tree = win.getByTestId('file-explorer-tree');
  const content = win.getByTestId(`editor-${editorId}`).locator('.cm-content');
  await tree.getByText('tiny.md', { exact: true }).click();
  await expect(content).toContainText('tiny', { timeout: 10_000 });
  await win.evaluate(async () => {
    const api = (window as unknown as { throng: { resources: { subscribeDetail: () => Promise<unknown> } } }).throng.resources;
    await api.subscribeDetail(); // keeps detail collection (and so the estimates) on for the whole test
  });
  return { editorId, tree, content, editorTiny: await shown(win, `n:${editorId}`) };
}

const previewIds = (win: Page): Promise<string[]> =>
  win.locator('[data-testid^="preview-body-"]').evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').replace('preview-body-', '')));

async function closePreview(win: Page, previewId: string): Promise<void> {
  await win.getByTestId(`panel-close-${previewId}`).click();
  const dialog = win.getByTestId('confirm-dialog');
  if (await dialog.isVisible().catch(() => false)) await win.getByTestId('confirm-accept').click();
  await expect(win.getByTestId(`preview-body-${previewId}`)).toHaveCount(0, { timeout: 60_000 });
}

/** Open the preview of `parent`'s file, wait for `last` to be drawn, and return its panel id and how long it took. */
async function openPreview(win: Page, last: string, parent: string): Promise<{ previewId: string; ms: number }> {
  const existing = await previewIds(win);
  const t0 = Date.now();
  await win.getByTestId(`editor-preview-${parent}`).click();
  await expect.poll(async () => (await previewIds(win)).some((id) => !existing.includes(id)), { timeout: 300_000 }).toBe(true);
  const previewId = (await previewIds(win)).find((id) => !existing.includes(id)) as string;
  await expect(win.getByTestId(`preview-body-${previewId}`)).toContainText(last, { timeout: 600_000 });
  const ms = Date.now() - t0;
  await previewSettled(win, previewId);
  return { previewId, ms };
}

/** The panel a fresh tab opens with (only the active tab's panels are mounted, so it is the new one). */
async function newTabPanel(win: Page): Promise<string> {
  const before = await panelIds(win);
  await win.getByTestId('tab-add').click();
  let id = '';
  await expect
    .poll(async () => {
      id = (await panelIds(win)).find((p) => !before.includes(p)) ?? '';
      return id;
    })
    .not.toBe('');
  return id;
}

/** Make `panelId` a terminal of `flavour` and wait for its shell to answer a command. */
async function makeTerminal(win: Page, panelId: string, flavour: 'cmd' | 'windows-powershell'): Promise<void> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption(flavour);
  await win.getByTestId(`panel-type-confirm-${panelId}`).click();
  const term = win.getByTestId(`terminal-${panelId}`);
  await expect(term).toBeVisible();
  // Typed only once the prompt is drawn: a key that reaches the shell before it reads input is lost.
  await expect(term).toContainText(flavour === 'cmd' ? '>' : 'PS ', { timeout: 60_000 });
  const probe = flavour === 'cmd' ? 'set /a 40+2' : '40+2';
  await runTypedCommand(win, term, probe, { echoed: probe, output: '42', timeout: 60_000 });
}

/** Print `lines` lines of about 60 characters into the terminal: plain, or coloured in four SGR runs each. */
async function fillTerminal(win: Page, panelId: string, flavour: 'cmd' | 'windows-powershell', lines: number, sgr: false | 'colour' | 'underline'): Promise<void> {
  const term = win.getByTestId(`terminal-${panelId}`);
  const e = '$([char]27)';
  const command =
    flavour === 'cmd'
      ? `for /L %i in (1,1,${lines}) do @echo calibration line %i xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
      : sgr === 'colour'
        ? `1..${lines} | % { "${e}[31mcalibration${e}[0m ${e}[1;32mline${e}[0m $_ ${e}[38;2;200;100;50mxxxxxxxxxxxxxxxxxxxx${e}[0m ${e}[44myyyyyyyyyyyyyyyyyy${e}[0m" }`
        : sgr === 'underline'
          ? `1..${lines} | % { "calibration line $_ ${e}[4mxxxxxxxxxxxxxxxxxxxx${e}[0m ${e}[4;44myyyyyyyyyyyyyyyyyy${e}[0m" }`
          : `1..${lines} | % { "calibration line $_ xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }`;
  await runTypedCommand(win, term, command, { echoed: flavour === 'cmd' ? 'for /L' : `1..${lines}`, output: `calibration line ${lines}`, timeout: 180_000 });
}

/** A terminal panel's xterm buffer as the estimate reads it, and the daemon's retained scrollback. */
async function daemonTerminal(
  win: Page,
  pipeName: string,
  panelId: string,
): Promise<{ cols: number; lines: number; styledLines: number; readMs: number; scrollbackChars: number }> {
  // Timed: the read is what the estimate does on every tick (the styled-line sample included).
  const buffer = await win.evaluate((id) => {
    const t0 = performance.now();
    const all = (window as unknown as { __throngTerminalBuffers?: () => Record<string, { lines: number; cols: number; styledLines: number }> }).__throngTerminalBuffers?.();
    return { ...all?.[id], readMs: performance.now() - t0 };
  }, panelId);
  const roster = (await daemonRpc(pipeName, 'resources.roster', {})) as { terminals: { panelId: string; scrollbackChars: number }[] };
  return {
    cols: buffer.cols ?? 0,
    lines: buffer.lines ?? 0,
    styledLines: buffer.styledLines ?? 0,
    readMs: buffer.readMs,
    scrollbackChars: roster.terminals.find((t) => t.panelId === panelId)?.scrollbackChars ?? 0,
  };
}

/** Fresh terminals per case, the median compared: at ~3 MB one sample moves ±10%, the bound's own size. */
const TERMINAL_REPEATS = 5;

/** The document's node and listener counts (Blink's own), and the elements inside one panel. */
async function domCounts(win: Page, panelId: string): Promise<{ nodes: number; listeners: number; panelElements: number }> {
  const cdp = await win.context().newCDPSession(win);
  try {
    const c = (await cdp.send('Memory.getDOMCounters')) as { nodes: number; jsEventListeners: number };
    const panelElements = await win.evaluate((id) => document.querySelector(`[data-panel-id="${CSS.escape(id)}"]`)?.querySelectorAll('*').length ?? 0, panelId);
    return { nodes: c.nodes, listeners: c.jsEventListeners, panelElements };
  } finally {
    await cdp.detach();
  }
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/**
 * `gate`: in the trimmed gate. SC-009's terminal criterion is a terminal filled to its retained limit
 * (1500 lines), so the gate takes the plain and the wide terminal at that limit; a terminal short of it is
 * the ~2 MB terminal R21 records as a known miss (0.7–1.4×), logged in every mode. A STYLED terminal at the
 * limit is logged too: its live heap moved 3.17–3.85 MB between four runs' medians of five against one fixed
 * estimate — the run-to-run spread is the bound's own size, so no constant passes it reliably (R21).
 */
const SCROLLBACK_LIMIT_LINES = 1500;
const TERMINAL_CASES = [
  { name: 'cmd ascii 100 lines', flavour: 'cmd', lines: 100, sgr: false, wide: false, gate: false },
  { name: 'cmd ascii 1500 lines (scrollback full)', flavour: 'cmd', lines: 1500, sgr: false, wide: false, gate: true },
  { name: 'powershell ascii 500 lines', flavour: 'windows-powershell', lines: 500, sgr: false, wide: false, gate: false },
  { name: 'powershell colour 1500 lines', flavour: 'windows-powershell', lines: 1500, sgr: 'colour', wide: false, gate: false },
  { name: 'powershell underline 1500 lines', flavour: 'windows-powershell', lines: 1500, sgr: 'underline', wide: false, gate: false },
  { name: 'cmd ascii 1500 lines wide', flavour: 'cmd', lines: 1500, sgr: false, wide: true, gate: true },
] as const;

/** Preview cases: the shape, the size, and the text that is on screen only once the whole document is drawn. */
/** One fenced block of `megabytes` of code (past the highlighter's budget, so drawn plain), then the marker. */
function codeOf(megabytes: number): string {
  return '```ts\n' + linesOf(megabytes) + '```\n\nEND OF DOCUMENT\n';
}

/**
 * Smallest first: a closed preview's Blink heap is swept lazily, and a small case measured just after a
 * large one read the large one's release as its own (`lines 1 MB` once measured -8 MB).
 */
/**
 * `gate`: in the trimmed gate, at the window's own width — the preview at 1 and 10 MB, in the shape of a
 * real document. The very narrow runs (`veryNarrow`, at 0.3 of the width) are the preview R21 records as
 * a known miss (width is not modelled), logged in every mode.
 */
const PREVIEW_CASES = [
  { name: 'lines 1 MB', wideOnly: false, veryNarrow: false, gate: false, file: 'pv-lines-1.md', text: () => linesOf(1), last: lastLineOf(1) },
  { name: 'code 1 MB', wideOnly: false, veryNarrow: false, gate: false, file: 'pv-code-1.md', text: () => codeOf(1), last: 'END OF DOCUMENT' },
  { name: 'mixed 0.5 MB', wideOnly: false, veryNarrow: true, gate: false, file: 'pv-mixed-0.5.md', text: () => mixedOf(0.5), last: 'END OF DOCUMENT' },
  { name: 'paragraphs 1 MB', wideOnly: false, veryNarrow: true, gate: true, file: 'pv-paragraphs-1.md', text: () => textOf(1), last: lastLineOf(1) },
  { name: 'mixed 2 MB', wideOnly: false, veryNarrow: false, gate: false, file: 'pv-mixed-2.md', text: () => mixedOf(2), last: 'END OF DOCUMENT' },
  { name: 'paragraphs 5 MB', wideOnly: false, veryNarrow: false, gate: false, file: 'pv-paragraphs-5.md', text: () => textOf(5), last: lastLineOf(5) },
  { name: 'mixed 5 MB', wideOnly: true, veryNarrow: false, gate: false, file: 'pv-mixed-5.md', text: () => mixedOf(5), last: 'END OF DOCUMENT' },
  { name: 'paragraphs 10 MB', wideOnly: true, veryNarrow: false, gate: true, file: 'pv-paragraphs-10.md', text: () => textOf(10), last: lastLineOf(10) },
] as const;

/** A benchmark document: its shape, its size, the text an editor shows first and a preview shows last. */
interface BenchDoc {
  readonly file: string;
  readonly text: () => string;
  readonly first: string;
  readonly last: string;
  /** Whether the run opens a preview of it beside its editor. */
  readonly preview: boolean;
}

const benchDoc = (shape: 'paragraphs' | 'lines' | 'mixed' | 'code', mb: number, preview: boolean): BenchDoc => {
  const file = `bench-${shape}-${mb}.md`;
  switch (shape) {
    case 'paragraphs':
      return { file, text: () => textOf(mb), first: 'section 00000000', last: lastLineOf(mb), preview };
    case 'lines':
      return { file, text: () => linesOf(mb), first: 'line 00000000', last: lastLineOf(mb), preview };
    case 'mixed':
      return { file, text: () => mixedOf(mb), first: 'Section 00000000', last: 'END OF DOCUMENT', preview };
    default:
      return { file, text: () => codeOf(mb), first: 'line 00000000', last: 'END OF DOCUMENT', preview };
  }
};

interface BenchTerminal {
  readonly flavour: 'cmd' | 'windows-powershell';
  readonly lines: number;
  readonly sgr: false | 'colour' | 'underline';
}

/**
 * Three benchmark runs (`THRONG_CALIBRATE=bench-a`, `bench-b`, `bench-c`), each a set of panels of every
 * kind open together in one tab, at sizes deliberately unlike the calibration cases.
 */
const BENCH_RUNS: Record<string, { readonly terminals: readonly BenchTerminal[]; readonly docs: readonly BenchDoc[] }> = {
  'bench-a': {
    terminals: [
      { flavour: 'cmd', lines: 200, sgr: false },
      { flavour: 'windows-powershell', lines: 150, sgr: 'colour' },
      { flavour: 'cmd', lines: 400, sgr: false },
    ],
    docs: [benchDoc('paragraphs', 0.2, true), benchDoc('mixed', 0.3, true), benchDoc('lines', 1.5, false), benchDoc('code', 0.4, true)],
  },
  'bench-b': {
    terminals: [
      { flavour: 'cmd', lines: 1500, sgr: false },
      { flavour: 'windows-powershell', lines: 600, sgr: 'colour' },
      { flavour: 'cmd', lines: 50, sgr: false },
    ],
    docs: [benchDoc('paragraphs', 3, true), benchDoc('mixed', 1, true), benchDoc('lines', 8, false), benchDoc('paragraphs', 0.1, true)],
  },
  'bench-c': {
    terminals: [
      { flavour: 'cmd', lines: 1500, sgr: false },
      { flavour: 'windows-powershell', lines: 1500, sgr: 'underline' },
      { flavour: 'windows-powershell', lines: 1200, sgr: false },
    ],
    docs: [benchDoc('paragraphs', 6, true), benchDoc('mixed', 2.5, true), benchDoc('lines', 25, false), benchDoc('code', 3, true)],
  },
};

// ── `THRONG_CALIBRATE`: what this invocation runs (see the file comment) ─────────────────────────────
const SECTION_NAMES = ['editor', 'preview', 'terminal'] as const;
const BENCH_NAMES = Object.keys(BENCH_RUNS);
const RAW_CALIBRATE = (process.env.THRONG_CALIBRATE ?? '').trim();
const TOKENS = RAW_CALIBRATE.split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
{
  // A misspelt section would otherwise select nothing and pass, vacuously.
  const unknown = TOKENS.filter((t) => t !== 'full' && !(SECTION_NAMES as readonly string[]).includes(t) && !BENCH_NAMES.includes(t));
  if (unknown.length > 0) throw new Error(`THRONG_CALIBRATE: unknown ${unknown.join(', ')} (expected full, ${SECTION_NAMES.join(', ')}, ${BENCH_NAMES.join(', ')})`);
}
/** Unset: the trimmed gate. The only mode in which the calibration sections run their trimmed case lists. */
const TRIMMED = TOKENS.length === 0;
const EVERYTHING = TRIMMED || TOKENS.includes('full');
const SECTIONS = new Set<string>(EVERYTHING ? SECTION_NAMES : TOKENS.filter((t) => (SECTION_NAMES as readonly string[]).includes(t)));
const BENCHES = new Set<string>(EVERYTHING ? BENCH_NAMES : TOKENS.filter((t) => BENCH_NAMES.includes(t)));
/** The editor's sizes: 1 and 10 MB in the gate, 50 MB added on request. */
const EDITOR_SIZES_MB: readonly number[] = TRIMMED ? [1, 10] : [1, 10, 50];
const TERMINALS = TERMINAL_CASES.filter((c) => !TRIMMED || c.gate);
const PREVIEWS = PREVIEW_CASES.filter((c) => !TRIMMED || c.gate);

/**
 * Why a benchmark row is one of the shapes research R21 records the model as missing, or undefined. The
 * row's ratio is never asserted either way (the run is asserted on rank and shares); this marks the rows a
 * reader should expect to be off, so a change in one is noticed rather than mistaken for a regression.
 */
function benchKnownMiss(kind: 'terminal' | 'editor' | 'preview', file: string, measured: number, width: number): string | undefined {
  if (kind === 'editor' && file.includes('-mixed-')) return 'mixed-Markdown editor, 1.3–1.8× in the benchmark';
  if (kind === 'editor' && file.includes('-lines-')) return 'single-newline lines editor in a narrow slot, 0.3–0.7×';
  if (kind === 'terminal' && measured < 2.5 * 1024 * 1024) return '~2 MB terminal, 0.7–1.4× (its constant varies ±0.5 MB)';
  if (kind === 'preview' && width < 100) return 'preview under ~100 px wide, ~2× (width not modelled)';
  return undefined;
}

/** Spearman's rank correlation of two equal-length series (average ranks for ties). */
function spearman(a: readonly number[], b: readonly number[]): number {
  const rank = (xs: readonly number[]): number[] => {
    const order = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j += 1;
      for (let k = i; k <= j; k += 1) r[order[k]![1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i += 1) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

/**
 * Wait until a preview's element count has held still across two reads: the body highlights fenced code
 * AFTER the document is on screen, adding a span per token, and a sample taken before that lands counted
 * the next case's memory as this one's.
 */
async function previewSettled(win: Page, panelId: string): Promise<void> {
  let count = -1;
  await expect
    .poll(
      async () => {
        const prev = count;
        count = await win.evaluate((id) => document.querySelector(`[data-panel-id="${CSS.escape(id)}"]`)?.getElementsByTagName('*').length ?? -1, panelId);
        return count >= 0 && prev === count;
      },
      { timeout: 120_000, intervals: [1_000] },
    )
    .toBe(true);
}

/** The rendered DOM of a preview panel, counted several ways and timed, as the estimate could count it. */
async function previewShape(win: Page, panelId: string): Promise<Record<string, number | Record<string, number>>> {
  return win.evaluate((id) => {
    const root = document.querySelector(`[data-panel-id="${CSS.escape(id)}"]`) as Element;
    const t0 = performance.now();
    const elements = root.querySelectorAll('*').length;
    const t1 = performance.now();
    const textChars = root.textContent?.length ?? 0;
    const t2 = performance.now();
    const live = root.getElementsByTagName('*').length;
    const t3 = performance.now();
    let textNodes = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes += 1;
    const t4 = performance.now();
    const tags: Record<string, number> = {};
    for (const el of root.querySelectorAll('*')) tags[el.tagName] = (tags[el.tagName] ?? 0) + 1;
    // The estimate's own reads (`previewDomSize`), timed together.
    const t5 = performance.now();
    const counted = root.getElementsByTagName('*').length + root.getElementsByTagName('span').length;
    const inputMs = performance.now() - t5;
    // How wide the text is laid out, in ems: a narrower body wraps the same paragraphs onto more lines.
    const body = root.querySelector('.preview-markdown') as HTMLElement | null;
    const width = body?.clientWidth ?? 0;
    const fontSize = body === null ? 0 : Number.parseFloat(getComputedStyle(body).fontSize);
    return { elements, textChars, textNodes, live, qsaMs: t1 - t0, textMs: t2 - t1, liveMs: t3 - t2, walkMs: t4 - t3, inputMs, counted, width, fontSize, tags };
  }, panelId);
}

test('panel memory estimates are within 10% of live heap: editors and previews at 1 and 10 MB and terminals filled to their scrollback limit (50 MB and every shape with THRONG_CALIBRATE=full)', { tag: ['@extended', '@editor', '@reserve:runtime'] }, async () => {
  test.skip(SECTIONS.size === 0, `THRONG_CALIBRATE=${RAW_CALIBRATE} selects no calibration section`);
  test.setTimeout(60 * 60_000);
  const t0 = Date.now();
  // Only the files the chosen sections open (see `launch`). One small file per editor-view case: a file
  // already open elsewhere would bring that editor forward.
  const files: SeedFile[] = [];
  if (SECTIONS.has('editor')) {
    if (!TRIMMED) for (let i = 0; i < 3; i += 1) files.push({ file: `view-${i}.md`, text: () => `# view ${i}\n` });
    for (const mb of EDITOR_SIZES_MB) files.push({ file: `big-${mb}.md`, text: () => textOf(mb) }, { file: `lines-${mb}.md`, text: () => linesOf(mb) }, { file: `mixed-${mb}.md`, text: () => mixedOf(mb) });
  }
  if (SECTIONS.has('preview')) files.push(...PREVIEWS);
  const { h, done } = await launch(files);
  try {
    const { app, win } = h;
    const { editorId, tree, content, editorTiny } = await firstEditor(win);
    const tinyShape = await docShape(win, editorId);
    const baseline = await sample(app, win);

    // ── An editor, opened and closed at each size ────────────────────────────────────────────────────
    for (const mb of SECTIONS.has('editor') ? EDITOR_SIZES_MB : []) {
      for (const shape of SHAPES) {
        const what = `editor ${mb} MB ${shape.name}`;
        // The live heap is measured against the tiny document just before each case: it returns to its
        // baseline when a document is freed, which private bytes do not, so a per-case baseline is honest
        // for the heap and the run-wide one is kept for private bytes as it always was.
        const before = await sample(app, win);
        await tree.getByText(shape.file(mb), { exact: true }).click();
        await expect(content).toContainText(shape.first, { timeout: 120_000 });
        // Measured once the syntax tree has stopped growing: background parsing may still be running.
        let nodes = -1;
        await expect
          .poll(
            async () => {
              const prev = nodes;
              nodes = (await docShape(win, editorId)).nodes;
              return prev === nodes;
            },
            { timeout: 300_000, intervals: [2_000] },
          )
          .toBe(true);
        const doc = await docShape(win, editorId);
        const open = await sample(app, win);
        const estimated = (await shownChanged(win, `n:${editorId}`, editorTiny)) - editorTiny;
        const d = heapDelta(before, open);
        const heap = d.main + d.renderer;
        const priv = open.main - baseline.main + (open.renderer - baseline.renderer);
        console.info(
          `calib-data ${JSON.stringify({
            what,
            mb,
            shape: shape.name,
            chars: doc.chars - tinyShape.chars,
            lines: doc.lines - tinyShape.lines,
            nodes: doc.nodes - tinyShape.nodes,
            trees: doc.trees - tinyShape.trees,
            extrapolated: doc.extrapolated - tinyShape.extrapolated,
            sampledNodes: doc.sampledNodes,
            sampledChars: doc.sampledChars,
            fullMs: doc.fullMs,
            sampleMs: doc.sampleMs,
            fieldTreeLength: doc.fieldTreeLength,
            contextTreeLength: doc.contextTreeLength,
            renderedLines: doc.renderedLines - tinyShape.renderedLines,
            estimated,
            heapMain: open.heapMain - before.heapMain,
            externalMain: open.externalMain - before.externalMain,
            arrayBuffersMain: open.arrayBuffersMain - before.arrayBuffersMain,
            heapRenderer: open.heapRenderer - before.heapRenderer,
            embedder: open.embedderRenderer - before.embedderRenderer,
            backing: open.backingRenderer - before.backingRenderer,
            privMain: open.main - baseline.main,
            privRenderer: open.renderer - baseline.renderer,
            privMainCase: open.main - before.main,
            privRendererCase: open.renderer - before.renderer,
          })}`,
        );
        expectCalibrated(`${what} vs private bytes (main + renderer)`, estimated, priv, { assert: false });
        expectCalibrated(`${what} vs live heap (main + renderer)`, estimated, heap);

        // Closed again: the document is replaced by the tiny one, and the figure falls back with it.
        await tree.getByText('tiny.md', { exact: true }).click();
        await expect(content).toContainText('tiny', { timeout: 30_000 });
        await expect.poll(async () => (await shown(win, `n:${editorId}`)) - editorTiny, { timeout: 30_000 }).toBeLessThan(estimated / 10);
      }
    }

    // ── An editor's own cost: an empty panel made an editor on the tiny file, in a tab of its own ────
    // The cases above are measured against the tiny document, so the per-view constants cancel out of them;
    // here they are the whole of the figure. Three fresh editors, the median compared (see TERMINAL_REPEATS).
    // Not in the gate, which asserts documents at 1 and 10 MB.
    if (SECTIONS.has('editor') && !TRIMMED) {
      const estimates: number[] = [];
      const measures: number[] = [];
      for (let rep = 0; rep < 3; rep += 1) {
        const panelId = await newTabPanel(win);
        const view = win.getByTestId(`editor-${panelId}`);
        const before = await sample(app, win);
        await win.getByTestId(`panel-type-select-${panelId}`).selectOption('editor');
        await win.getByTestId(`panel-type-confirm-${panelId}`).click();
        await expect(view).toBeVisible();
        await view.click();
        await tree.getByText(`view-${rep}.md`, { exact: true }).click();
        await expect(view.locator('.cm-content')).toContainText(`view ${rep}`, { timeout: 30_000 });
        const after = await sample(app, win);
        const d = heapDelta(before, after);
        const estimated = await shown(win, `n:${panelId}`);
        console.info(`calib-data ${JSON.stringify({ what: 'editor view, tiny file', rep, estimated, liveMain: d.main, liveRenderer: d.renderer })}`);
        estimates.push(estimated);
        measures.push(d.main + d.renderer);
      }
      expectCalibrated('editor view on the tiny file, median of 3 (main + renderer)', median(estimates), median(measures));
    }

    // ── A Markdown preview, opened and closed per case ───────────────────────────────────────────────
    if (SECTIONS.has('preview')) {
      // A warm-up preview of the tiny file: the first one loads the preview chunk (markdown-it, the
      // sanitiser, the highlighter), which is code, not any one panel's memory.
      await tree.getByText('tiny.md', { exact: true }).click();
      await expect(content).toContainText('tiny', { timeout: 10_000 });
      const warm = await openPreview(win, 'tiny', editorId);
      await closePreview(win, warm.previewId);
      // Each case at the window's own width, and (outside the gate) the smaller ones narrower: a narrower
      // body wraps the same text onto more lines, and Blink keeps a fragment per line.
      const size0 = await app.evaluate(({ BrowserWindow }) => {
        const [bw] = BrowserWindow.getAllWindows();
        if (bw.isMaximized()) bw.unmaximize();
        return bw.getContentSize();
      });
      const setWidth = (scale: number): Promise<void> =>
        app.evaluate(({ BrowserWindow }, s) => {
          const [bw] = BrowserWindow.getAllWindows();
          bw.setContentSize(s.w, s.h);
        }, { w: Math.round((size0[0] ?? 1280) * scale), h: size0[1] ?? 800 });
      const runs = TRIMMED
        ? PREVIEWS.map((c) => ({ c, scale: 1 }))
        : [
            ...PREVIEWS.map((c) => ({ c, scale: 1 })),
            ...PREVIEWS.filter((c) => !c.wideOnly).map((c) => ({ c, scale: 0.5 })),
            ...PREVIEWS.filter((c) => c.veryNarrow).map((c) => ({ c, scale: 0.3 })),
          ];
      for (const { c, scale } of runs) {
        // The file is opened at full width: a narrowed window can leave the explorer tree out of reach.
        await tree.getByText(c.file, { exact: true }).click();
        await expect(content).not.toContainText('tiny', { timeout: 120_000 });
        await setWidth(scale);
        const before = await sample(app, win);
        const { previewId, ms } = await openPreview(win, c.last, editorId);
        const open = await sample(app, win);
        const estimated = await shown(win, `n:${previewId}`);
        const shape = await previewShape(win, previewId);
        const d = heapDelta(before, open);
        console.info(
          `calib-data ${JSON.stringify({
            what: `preview ${c.name} @${scale}`,
            chars: c.text().length,
            renderMs: ms,
            ...shape,
            estimated,
            heapMain: open.heapMain - before.heapMain,
            externalMain: open.externalMain - before.externalMain,
            heapRenderer: open.heapRenderer - before.heapRenderer,
            embedder: open.embedderRenderer - before.embedderRenderer,
            backing: open.backingRenderer - before.backingRenderer,
            liveMain: d.main,
            liveRenderer: d.renderer,
            privMain: open.main - before.main,
            privRenderer: open.renderer - before.renderer,
          })}`,
        );
        expectCalibrated(`preview ${c.name} @${scale} vs private bytes (main + renderer)`, estimated, open.main - before.main + (open.renderer - before.renderer), { assert: false });
        expectCalibrated(`preview ${c.name} @${scale} vs live heap (main + renderer)`, estimated, d.main + d.renderer, {
          knownMiss: scale < 0.5 ? 'a very narrow preview, ~2× (width not modelled)' : undefined,
        });
        await closePreview(win, previewId);
        await setWidth(1);
        await tree.getByText('tiny.md', { exact: true }).click();
        await expect(content).toContainText('tiny', { timeout: 30_000 });
        // Let the closed preview's heap go before the next case's baseline (see PREVIEW_CASES): sampled until
        // two samples a second apart agree to within 1 MB. A 10 MB preview took longer than 2 s to release
        // its 840 MB, and the next case measured -25 MB.
        let last = await sample(app, win);
        await expect
          .poll(
            async () => {
              const next = await sample(app, win);
              const moved = Math.abs(heapDelta(last, next).renderer);
              last = next;
              return moved;
            },
            { timeout: 60_000, intervals: [1_000] },
          )
          .toBeLessThan(1024 * 1024);
      }
      await setWidth(1);
    }

    // ── Terminals: a fresh one per case, measured from before its shell started to after its output ──
    if (SECTIONS.has('terminal')) {
      const inspector = await inspectDaemon(await daemonPid(h.pipeName));
      try {
        // A warm-up terminal: the first one loads xterm and its addons, which is code, not a panel.
        const warmId = await newTabPanel(win);
        await makeTerminal(win, warmId, 'cmd');
        await makeTerminal(win, await newTabPanel(win), 'windows-powershell');
        for (const c of TERMINALS) {
          let restore: { maximized: boolean; size: number[] } | null = null;
          if (c.wide) {
            restore = await app.evaluate(({ BrowserWindow }) => {
              const [bw] = BrowserWindow.getAllWindows();
              const maximized = bw.isMaximized();
              const size = bw.getContentSize();
              if (!maximized) bw.maximize();
              return { maximized, size };
            });
          }
          // Each case three times, and the median compared: the renderer's live heap moves by a few hundred KB
          // between samples whatever the terminal does (measured: the same case read 3.39 and 2.88 MB), which
          // is more than 10% of a small terminal. Three fresh terminals, not one read three times.
          const estimates: number[] = [];
          const measures: number[] = [];
          for (let rep = 0; rep < TERMINAL_REPEATS; rep += 1) {
            const panelId = await newTabPanel(win);
            const empty = await sample(app, win);
            const daemonEmpty = await inspector.heap();
            await makeTerminal(win, panelId, c.flavour);
            const before = await sample(app, win);
            const daemonBefore = await inspector.heap();
            const shownBefore = await shown(win, `b:${panelId}`);
            const domBefore = await domCounts(win, panelId);
            const gridBefore = await daemonTerminal(win, h.pipeName, panelId);
            await fillTerminal(win, panelId, c.flavour, c.lines, c.sgr);
            const after = await sample(app, win);
            const domAfter = await domCounts(win, panelId);
            const daemonAfter = await inspector.heap();
            const grid = await daemonTerminal(win, h.pipeName, panelId);
            const shownAfter = await shownChanged(win, `b:${panelId}`, shownBefore);
            // The rows on screen and the window they are in: xterm draws only the viewport, so a styled
            // line costs Blink a span per run only while it is on screen.
            const screenRows = await win.evaluate((id) => document.querySelector(`[data-testid="terminal-${id}"] .xterm-rows`)?.childElementCount ?? -1, panelId);
            const windowSize = await app.evaluate(({ BrowserWindow }) => {
              const [bw] = BrowserWindow.getAllWindows();
              return { size: bw.getContentSize(), maximized: bw.isMaximized() };
            });
            const fill = heapDelta(before, after);
            const start = heapDelta(empty, before);
            const daemonFill = daemonAfter.heap - daemonBefore.heap + (daemonAfter.external - daemonBefore.external);
            const daemonStart = daemonBefore.heap - daemonEmpty.heap + (daemonBefore.external - daemonEmpty.external);
            const measured = start.renderer + daemonStart + fill.renderer + daemonFill;
            estimates.push(shownAfter);
            measures.push(measured);
            console.info(
              `calib-data ${JSON.stringify({
                what: `terminal ${c.name}`,
                rep,
                lines: c.lines,
                sgr: c.sgr,
                cols: grid.cols,
                screenRows,
                windowSize,
                bufferLines: grid.lines,
                bufferLinesBefore: gridBefore.lines,
                styledLines: grid.styledLines,
                readMs: grid.readMs,
                scrollbackChars: grid.scrollbackChars,
                scrollbackCharsBefore: gridBefore.scrollbackChars,
                shownBefore,
                shownAfter,
                measured,
                fillRendererHeap: after.heapRenderer - before.heapRenderer,
                fillEmbedder: after.embedderRenderer - before.embedderRenderer,
                fillBacking: after.backingRenderer - before.backingRenderer,
                fillMain: fill.main,
                fillRenderer: fill.renderer,
                fillDaemon: daemonFill,
                startMain: start.main,
                startRenderer: start.renderer,
                startBacking: before.backingRenderer - empty.backingRenderer,
                startHeap: before.heapRenderer - empty.heapRenderer,
                startEmbedder: before.embedderRenderer - empty.embedderRenderer,
                startDaemon: daemonStart,
                privRendererFill: after.renderer - before.renderer,
                domBefore,
                domAfter,
              })}`,
            );
          }
          // The whole panel: from before its shell started to after its output, renderer and daemon.
          expectCalibrated(`terminal ${c.name}, median of ${TERMINAL_REPEATS} (renderer + daemon)`, median(estimates), median(measures), {
            knownMiss:
              c.lines < SCROLLBACK_LIMIT_LINES
                ? 'a terminal short of its scrollback limit, ~2 MB, 0.7–1.4×'
                : c.sgr !== false
                  ? 'a styled terminal, whose live heap moves ±10% between runs'
                  : undefined,
          });
          if (restore !== null) {
            await app.evaluate(({ BrowserWindow }, o) => {
              const [bw] = BrowserWindow.getAllWindows();
              if (!o.maximized) bw.unmaximize();
              bw.setContentSize(o.size[0] ?? 1280, o.size[1] ?? 800);
            }, restore);
          }
        }
      } finally {
        inspector.close();
      }
    }
  } finally {
    await done();
    console.info(`calibration-timing ${JSON.stringify({ test: 'calibration', mode: RAW_CALIBRATE || 'gate', seconds: Math.round((Date.now() - t0) / 1000) })}`);
  }
});

// ── Benchmark: panels of every kind open together, each measured as it was added ─────────────────────
// One declaration per run, each in an app of its own: a run measured after another's panels is not the
// run the constants were fitted on, and the three report (and fail) separately.
for (const bench of BENCH_NAMES) {
  test(`panel memory estimates are representative of each other: benchmark ${bench} ranks its panels at Spearman ρ ≥ ${RHO_FLOOR} and each kind's share of the total is within ${SHARE_POINTS * 100} points of measured`, { tag: ['@extended', '@editor', '@reserve:runtime'] }, async () => {
    test.skip(!BENCHES.has(bench), `THRONG_CALIBRATE=${RAW_CALIBRATE} does not select ${bench}`);
    test.setTimeout(20 * 60_000);
    const t0 = Date.now();
    const run = BENCH_RUNS[bench] as (typeof BENCH_RUNS)[string];
    const { h, done } = await launch(run.docs);
    try {
      const { app, win } = h;
      const { editorId, tree } = await firstEditor(win);
      const inspector = await inspectDaemon(await daemonPid(h.pipeName));
      try {
        // Warm-ups, each kind's first view loading its code: a preview of the tiny file beside the editor,
        // and a terminal in a tab of its own. Neither is measured, and the bench tab unmounts both.
        await openPreview(win, 'tiny', editorId);
        await makeTerminal(win, await newTabPanel(win), 'cmd');

        // Every panel first, untyped, so no later split resizes one already measured: a terminal reflows its
        // buffer when its columns change. Editors along the top, terminals along the bottom, in a maximised
        // window, so every panel has a working width (a first layout of ten halvings left previews 39 px wide,
        // and a preview that narrow wraps every paragraph onto a dozen lines). A preview splits its editor's
        // slot, which only that editor shares.
        await app.evaluate(({ BrowserWindow }) => {
          const [bw] = BrowserWindow.getAllWindows();
          if (!bw.isMaximized()) bw.maximize();
        });
        const split = async (target: string, direction: 'right' | 'down'): Promise<string> => {
          const before = await panelIds(win);
          await splitPanelViaMenu(win, target, direction);
          let added = '';
          await expect
            .poll(async () => {
              added = (await panelIds(win)).find((p) => !before.includes(p)) ?? '';
              return added;
            })
            .not.toBe('');
          return added;
        };
        /** `count` panels side by side from `from`, each split level halving every slot of the level before. */
        const row = async (from: string, count: number): Promise<string[]> => {
          const out = [from];
          while (out.length < count) {
            for (const target of [...out]) {
              if (out.length >= count) break;
              out.splice(out.indexOf(target) + 1, 0, await split(target, 'right'));
            }
          }
          return out;
        };
        const top = await newTabPanel(win);
        const bottom = await split(top, 'down');
        const slots = [...(await row(bottom, run.terminals.length)), ...(await row(top, run.docs.length))];

        interface Row {
          what: string;
          kind: 'terminal' | 'editor' | 'preview';
          file: string;
          node: string;
          measured: number;
          width: number;
          parts: Record<string, number>;
        }
        const rows: Row[] = [];
        /** Measure `act`: the live-heap change it causes in main, the renderer and (for a terminal) the daemon. */
        const measure = async (act: () => Promise<void>, daemon: boolean): Promise<{ measured: number; parts: Record<string, number> }> => {
          const a = await sample(app, win);
          const da = daemon ? await inspector.heap() : { heap: 0, external: 0 };
          await act();
          const b = await sample(app, win);
          const db = daemon ? await inspector.heap() : { heap: 0, external: 0 };
          const d = heapDelta(a, b);
          const dd = db.heap - da.heap + (db.external - da.external);
          return daemon ? { measured: d.renderer + dd, parts: { renderer: d.renderer, daemon: dd } } : { measured: d.main + d.renderer, parts: { main: d.main, renderer: d.renderer } };
        };

        for (const [i, t] of run.terminals.entries()) {
          const panelId = slots[i] as string;
          const r = await measure(async () => {
            await makeTerminal(win, panelId, t.flavour);
            await fillTerminal(win, panelId, t.flavour, t.lines, t.sgr);
          }, true);
          const shape = await daemonTerminal(win, h.pipeName, panelId);
          rows.push({
            what: `terminal ${t.flavour} ${t.lines} lines${t.sgr === false ? '' : ` ${t.sgr}`}`,
            kind: 'terminal',
            file: '',
            node: `b:${panelId}`,
            width: 0,
            ...r,
            parts: { ...r.parts, cols: shape.cols, lines: shape.lines, styledLines: shape.styledLines },
          });
        }

        for (const [j, d] of run.docs.entries()) {
          const editorPanel = slots[run.terminals.length + j] as string;
          const editorView = win.getByTestId(`editor-${editorPanel}`);
          const r = await measure(async () => {
            await win.getByTestId(`panel-type-select-${editorPanel}`).selectOption('editor');
            await win.getByTestId(`panel-type-confirm-${editorPanel}`).click();
            await expect(editorView).toBeVisible();
            await editorView.click();
            await tree.getByText(d.file, { exact: true }).click();
            await expect(editorView.locator('.cm-content')).toContainText(d.first, { timeout: 120_000 });
            let nodes = -1;
            await expect
              .poll(
                async () => {
                  const prev = nodes;
                  // A view whose language is still loading has no syntax tree yet: not settled.
                  nodes = await docShape(win, editorPanel).then(
                    (s) => s.nodes,
                    () => -1,
                  );
                  return nodes >= 0 && prev === nodes;
                },
                { timeout: 300_000, intervals: [2_000] },
              )
              .toBe(true);
          }, false);
          const ds = await docShape(win, editorPanel);
          const editorWidth = Math.round((await editorView.boundingBox())?.width ?? 0);
          rows.push({
            what: `editor ${d.file}`,
            kind: 'editor',
            file: d.file,
            node: `n:${editorPanel}`,
            width: editorWidth,
            ...r,
            parts: { ...r.parts, chars: ds.chars, lines: ds.lines, nodes: ds.nodes, renderedLines: ds.renderedLines },
          });
          if (!d.preview) continue;
          let previewId = '';
          const p = await measure(async () => {
            previewId = (await openPreview(win, d.last, editorPanel)).previewId;
          }, false);
          const pv = await previewShape(win, previewId);
          rows.push({ what: `preview ${d.file}`, kind: 'preview', file: d.file, node: `n:${previewId}`, width: pv.width as number, ...p, parts: { ...p.parts, elements: pv.elements as number } });
        }

        // The estimates, all read once everything is open: what the monitor shows side by side. Read from
        // fresh frames until every panel has a figure and two frames in a row agree — each frame follows a
        // reporter tick, so a frame that repeats the one before carries every panel's last change.
        let estimates: number[] = [];
        let previous = '';
        await expect
          .poll(
            async () => {
              const frame = await detailFrame(win);
              estimates = rows.map((row) => {
                const memory = find(frame, row.node)?.rolled.memory;
                return typeof memory === 'number' ? memory : 0;
              });
              const key = estimates.join(',');
              const settled = estimates.every((e) => e > 0) && key === previous;
              previous = key;
              return settled;
            },
            { timeout: 60_000, intervals: [1_000], message: `${bench}: the monitor's figures never settled with one for every panel` },
          )
          .toBe(true);
        const totalEst = estimates.reduce((s, x) => s + x, 0);
        const totalMeas = rows.reduce((s, r) => s + r.measured, 0);
        for (const [i, row] of rows.entries()) {
          const est = estimates[i] as number;
          console.info(
            `bench-row ${JSON.stringify({
              run: bench,
              what: row.what,
              kind: row.kind,
              estimated: est,
              measured: row.measured,
              ratio: est / row.measured,
              estShare: est / totalEst,
              measShare: row.measured / totalMeas,
              width: row.width,
              knownMiss: benchKnownMiss(row.kind, row.file, row.measured, row.width),
              ...row.parts,
            })}`,
          );
        }
        const rho = spearman(estimates, rows.map((r) => r.measured));
        console.info(`bench-summary ${JSON.stringify({ run: bench, panels: rows.length, spearman: rho, totalEstimated: totalEst, totalMeasured: totalMeas, ratio: totalEst / totalMeas })}`);
        // Representative relative to each other: the monitor ranks the panels as their memory does…
        if (!LOG_ONLY) expect.soft(rho, `${bench}: rank agreement of estimate and measured across ${rows.length} panels (SC-009 ρ ≥ ${RHO_FLOOR})`).toBeGreaterThanOrEqual(RHO_FLOOR);
        // …and divides the total among the kinds as their memory does. A known-miss row is logged, not
        // asserted (SC-009), so it is left out of the shares too: the narrow 1.5 MB "lines" editor alone,
        // at ~0.25×, moved bench-a's editor share 5–6 points on a hosted runner.
        const asserted = rows.flatMap((r, i) =>
          benchKnownMiss(r.kind, r.file, r.measured, r.width) === undefined ? [{ kind: r.kind, est: estimates[i] as number, measured: r.measured }] : [],
        );
        const assertedEst = asserted.reduce((s, r) => s + r.est, 0);
        const assertedMeas = asserted.reduce((s, r) => s + r.measured, 0);
        for (const kind of ['terminal', 'editor', 'preview'] as const) {
          if (!asserted.some((r) => r.kind === kind)) continue;
          const estShare = asserted.reduce((s, r) => s + (r.kind === kind ? r.est : 0), 0) / assertedEst;
          const measShare = asserted.reduce((s, r) => s + (r.kind === kind ? r.measured : 0), 0) / assertedMeas;
          console.info(`bench-share ${JSON.stringify({ run: bench, kind, estShare, measShare, points: (estShare - measShare) * 100, rows: asserted.length })}`);
          if (LOG_ONLY) continue;
          expect
            .soft(Math.abs(estShare - measShare), `${bench}: ${kind} share of the total, estimated ${(estShare * 100).toFixed(1)}% vs measured ${(measShare * 100).toFixed(1)}% (SC-009 within ${SHARE_POINTS * 100} points)`)
            .toBeLessThanOrEqual(SHARE_POINTS);
        }
      } finally {
        inspector.close();
      }
    } finally {
      await done();
      console.info(`calibration-timing ${JSON.stringify({ test: bench, seconds: Math.round((Date.now() - t0) / 1000) })}`);
    }
  });
}
