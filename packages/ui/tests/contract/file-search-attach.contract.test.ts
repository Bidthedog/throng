/**
 * Contract: `throng:fileSearch:attach`, and the snapshot it answers with (043 T126, R23, FR-078,
 * FR-078a, contracts/file-search-ipc.md "Round two — cross-window delivery").
 *
 * ══ WHY A SECOND CONTRACT FILE RATHER THAN MORE OF THE FIRST ══
 *
 * `file-search-ipc.contract.test.ts` pins the scan channel as it was designed: one run per
 * (window, panel), one recipient, deltas only. Round two changes the KEY and adds a channel, and the
 * two statements have different lifetimes — the earlier file keeps the guarantees that did not move
 * (no broadcast, `event.sender`, a mandatory generation, the batch bound), and this one owns the
 * ones that arrived with #380. Merging them would bury the supersession inside a file whose header
 * says the opposite.
 *
 * ══ WHAT IT IS ACTUALLY PROTECTING ══
 *
 * Four independently compiled boundaries meet on this channel — the preload (CommonJS, unimportable
 * from this ESM process), the main registrar, the renderer's type declaration and the store that
 * folds the stream. The behaviour is proved over a real tree by
 * `packages/ui/tests/integration/file-search-viewers.integration.test.ts`; what THIS pins is the
 * drift that layer cannot see: a channel named on one side only (which `ipc-bridge-parity.test.ts`
 * would then report as a one-way channel), a subscriber taken from the payload instead of
 * `event.sender`, or a snapshot a consumer cannot tell from a delta — which is silently the worst of
 * the three, because it appends a whole result set to a list that already holds it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { ResultRow } from '@throng/core';
import {
  NO_FILE_SEARCH_RESULTS,
  applyFileSearchUpdate,
} from '../../src/renderer/find-in-files/find-in-files-store.js';

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

/**
 * The same source with its comments removed — what the NEGATIVE assertions read.
 *
 * `ipc-bridge-parity.test.ts` had to learn this and says why in its own header: this codebase
 * documents the mechanisms it deliberately does NOT use, so a guard that greps the whole file
 * reports every explanation as the thing it forbids. Round two's own comments name
 * `broadcastToWindows` and `getAllWindows()` precisely to record that they were rejected and why —
 * and that is worth more than the two lines of stripping it costs to keep asserting it.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const preload = source('../../src/preload/preload.cts');
const mainIpc = source('../../src/main/file-search-ipc.ts');
const service = source('../../src/main/file-search-service.ts');
const globals = source('../../src/renderer/global.d.ts');

function row(relPath: string, from: number): ResultRow {
  return {
    relPath,
    line: 1,
    column: from + 1,
    from,
    to: from + 6,
    snippet: { before: '', matched: 'needle', after: '', truncatedStart: false, truncatedEnd: false },
  };
}

describe('the attach channel (043 FR-078, contracts/file-search-ipc.md round two)', () => {
  it('is named in src/main AND in the preload, like every other channel', () => {
    // `ipc-bridge-parity.test.ts` collects channel LITERALS under each directory and fails the build
    // for one that appears on a single side. A channel main handles and the preload never sends is
    // dead; one the preload sends and main never handles is silence.
    expect(mainIpc, 'src/main must name throng:fileSearch:attach').toContain(
      'throng:fileSearch:attach',
    );
    expect(preload, 'the preload must name throng:fileSearch:attach').toContain(
      'throng:fileSearch:attach',
    );
  });

  it('is fire-and-forget on both sides, carrying the panel and nothing else', () => {
    // An `invoke` would make the panel's mount effect await main before it could render, for a
    // message whose whole answer arrives on the update channel anyway.
    expect(preload).toContain("ipcRenderer.send('throng:fileSearch:attach'");
    expect(mainIpc).toMatch(/ipcMain\.on\('throng:fileSearch:attach'[\s\S]{0,400}attach\(/);
    expect(globals).toContain('attach: (panelId: string) => void;');
  });

  it('takes its subscriber from event.sender, never from the payload', () => {
    /*
     * The rule `start`, `cancel` and `drop` already follow, and the one attach makes load-bearing.
     *
     * After R23 a window can receive updates for any panel it names — the weakening FR-078 asks for
     * — so the id of the window RECEIVING them is the last thing still deciding where one project's
     * file paths and match text can land. A payload-supplied one would let a window subscribe
     * another window to a scan.
     */
    expect(mainIpc).toMatch(
      /ipcMain\.on\('throng:fileSearch:attach'[\s\S]{0,600}event\.sender\.id/,
    );
    expect(mainIpc).not.toMatch(/webContentsId\s*[:=]\s*(payload|req|request)\b/);
  });

  it('still reaches the run’s viewers only — no broadcast, and getAllWindows is never asked', () => {
    /*
     * R23 rejected the house broadcast on Principle I rather than on taste: a scan update carries one
     * project's root-relative paths and the text around every match, and a sub-workspace window may
     * be holding a different project. `broadcastToWindows` plus a renderer-side filter satisfies
     * FR-018 at the RENDERING layer, which is one layer too late.
     */
    expect(code(mainIpc)).not.toContain('broadcastToWindows');
    expect(code(service)).not.toContain('broadcastToWindows');
    expect(code(mainIpc)).not.toContain('getAllWindows');
    expect(code(service)).not.toContain('getAllWindows');
    /*
     * The positive half, so this cannot be satisfied by a file that pushes nowhere at all: the
     * recipients are the run's own viewers, named one at a time.
     *
     * The loop gained a BODY in FR-078b — it builds a per-recipient payload now, because
     * `adoptQuery` is present for a following window and absent for the one driving the search — so
     * the two halves are matched separately rather than as one contiguous statement. What the
     * property actually needs is that the iteration is over `run.viewers` and that `push` is the
     * only way anything leaves; pinning the exact punctuation between them made this fail for a
     * change that did not touch the guarantee.
     */
    expect(code(service)).toMatch(/for\s*\(const viewer of \[\.\.\.run\.viewers\]\)/);
    expect(code(service)).toMatch(/this\.push\(viewer,/);
  });

  it('declares the snapshot flag on the wire, on both the producer and the consumer', () => {
    expect(service).toMatch(/snapshot\?:\s*true;/);
    expect(globals).toMatch(/fileSearch\?:[\s\S]{0,2600}snapshot\?:\s*true/);
  });
});

describe('a snapshot is distinguishable from a delta (FR-078a)', () => {
  /**
   * A FUNCTION, not a shared constant — the fold appends IN PLACE within a generation.
   *
   * A `const gen3` at describe scope is one array that every test in the block mutates, so the
   * delta case below would leave the supersession case asserting against four rows it never
   * produced. That is the store's documented trade (see its header), not an accident, and a fixture
   * that ignores it reads as a failure in the code under test.
   */
  const running = (): ReturnType<typeof applyFileSearchUpdate> =>
    applyFileSearchUpdate(NO_FILE_SEARCH_RESULTS, {
      panelId: 'p',
      generation: 3,
      status: 'running',
      rows: [row('a.ts', 0), row('a.ts', 20)],
      totalMatches: 2,
      filesScanned: 1,
    });

  it('REPLACES the rows, where a delta at the same generation appends', () => {
    const gen3 = running();
    /*
     * The two messages differ by one field and by nothing else, so this asserts the pair: the same
     * rows arriving as a delta must append. Without the flag, a window that re-attached — a remount,
     * a tab switched back to — would show every row twice and a total that disagreed with the list.
     */
    const snapshot = applyFileSearchUpdate(gen3, {
      panelId: 'p',
      generation: 3,
      status: 'complete',
      snapshot: true,
      rows: [row('a.ts', 0), row('a.ts', 20)],
      totalMatches: 2,
      filesScanned: 1,
    });
    expect(snapshot.rows).toHaveLength(2);

    const delta = applyFileSearchUpdate(running(), {
      panelId: 'p',
      generation: 3,
      status: 'complete',
      rows: [row('a.ts', 0), row('a.ts', 20)],
      totalMatches: 2,
      filesScanned: 1,
    });
    expect(delta.rows).toHaveLength(4);
  });

  it('carries the run’s totals and cumulative staleness, so a late window is not half-informed', () => {
    const snapshot = applyFileSearchUpdate(NO_FILE_SEARCH_RESULTS, {
      panelId: 'p',
      generation: 3,
      status: 'complete',
      snapshot: true,
      rows: [row('a.ts', 0), row('b.ts', 0)],
      totalMatches: 2,
      filesScanned: 7,
      skipped: 1,
      staleFiles: ['b.ts'],
    });
    expect(snapshot.status).toBe('complete');
    expect(snapshot.totalMatches).toBe(2);
    expect(snapshot.filesScanned).toBe(7);
    expect(snapshot.skipped).toBe(1);
    expect(snapshot.staleFiles).toEqual(['b.ts']);
    expect(snapshot.rows.map((r) => r.relPath)).toEqual(['a.ts', 'b.ts']);
  });

  it('is still dropped when it belongs to a run the panel has already superseded', () => {
    // The one guarantee the flag must NOT buy its way past. A snapshot is a full re-statement of a
    // run, and a full re-statement of an ABANDONED run would undo the supersession it lost to.
    const gen3 = running();
    const late = applyFileSearchUpdate(gen3, {
      panelId: 'p',
      generation: 2,
      status: 'complete',
      snapshot: true,
      rows: [row('z.ts', 0)],
      totalMatches: 1,
    });
    expect(late).toBe(gen3);
    expect(late.rows.map((r) => r.relPath)).toEqual(['a.ts', 'a.ts']);
  });
});
