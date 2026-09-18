import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LINK_IDLE_SCAN_MS,
  MAX_LINK_CANDIDATES_PER_LINE,
  type LinkResolution,
  type LinkResolutionRequest,
} from '@throng/core';
import { __resetLinkCacheForTests, peekLink } from '../../src/renderer/links/link-cache.js';
import { createFileLinkProvider } from '../../src/renderer/terminal/file-link-provider.js';
import { askTerminalLink } from '../../src/renderer/terminal/terminal-link-activation.js';
import { createLinkIdleScan } from '../../src/renderer/terminal/link-idle-scan.js';

/**
 * 045 T178 — the terminal's IDLE SCAN (FR-137, FR-071, FR-072; contract §7 P13; data-model §14.2).
 *
 * FR-136 wants a link marked AT REST, and FR-137 squares that with FR-071/FR-072 — no existence
 * check on the output path — like this: the rows IN VIEW are resolved by a scan that starts only
 * after the output has been quiet for `LINK_IDLE_SCAN_MS`, is cancelled by the next write, is bounded
 * by the viewport and the per-line cap, and reads and fills the same cache a hover does.
 *
 * What the user sees today: a detected path in a terminal is marked only while the pointer is on it,
 * so they must sweep the pointer over the screen to find out what is clickable.
 *
 * ══ THE FAKE ══
 *
 * A terminal reduced to what the scan may know: that a write happened (never its data), how many
 * rows there are, and which of them are in view. The clock is vitest's fake one.
 *
 * ══ ONE DEPENDENCY BEYOND data-model §14.2 ══
 *
 * §14.2's deps are `onWriteQuiet`, `viewportRows` and `scanRow`. "A write during the scan cancels
 * it" needs the scan to LEARN of a write while it runs, which a quiet signal alone cannot tell it —
 * so the fake also offers `onWrite` (the bare write signal, no data). If T179 finds another way (the
 * quiet subscription re-arming, say), it drops the dep here; the assertions do not depend on it.
 */

class FakeTerminal {
  rows: string[] = [];
  viewport = { top: 0, bottom: 0 };
  private readonly writeListeners = new Set<() => void>();

  write(line: string): void {
    this.rows.push(line);
    for (const listener of this.writeListeners) listener();
  }

  onWrite(listener: () => void): () => void {
    this.writeListeners.add(listener);
    return () => this.writeListeners.delete(listener);
  }

  /** A faithful write-quiet signal: `listener` fires once `quietMs` pass with no write. */
  onWriteQuiet(listener: () => void, quietMs: number): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(listener, quietMs);
    };
    const stop = this.onWrite(arm);
    arm();
    return () => {
      stop();
      if (timer !== undefined) clearTimeout(timer);
    };
  }
}

let asked: LinkResolutionRequest[];

beforeEach(() => {
  vi.useFakeTimers();
  asked = [];
  vi.stubGlobal('window', {
    throng: {
      links: {
        resolve: async (request: LinkResolutionRequest): Promise<LinkResolution> => {
          asked.push(request);
          return request.text.startsWith('src/')
            ? {
                ok: true,
                link: { path: `D:\\p\\${request.text}`, kind: 'file', inProject: true, executable: false, preview: 'none' },
              }
            : { ok: false };
        },
      },
    },
  });
  __resetLinkCacheForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function scanOver(terminal: FakeTerminal) {
  const scanned: number[] = [];
  const quietAsked: number[] = [];
  const scan = createLinkIdleScan({
    onWriteQuiet: (listener: () => void, quietMs: number) => {
      quietAsked.push(quietMs);
      return terminal.onWriteQuiet(listener, quietMs);
    },
    onWrite: (listener: () => void) => terminal.onWrite(listener),
    viewportRows: () => terminal.viewport,
    scanRow: (row: number) => void scanned.push(row),
  } as Parameters<typeof createLinkIdleScan>[0]);
  return { scan, scanned, quietAsked };
}

describe('LINK_IDLE_SCAN_MS is the quiet interval, not a private constant', () => {
  it('the scan asks for write-quiet of exactly LINK_IDLE_SCAN_MS', () => {
    const { quietAsked, scan } = scanOver(new FakeTerminal());
    expect(quietAsked).toEqual([LINK_IDLE_SCAN_MS]);
    scan.dispose();
  });
});

describe('P13 / FR-072 — nothing is scanned while output streams', () => {
  it('writes every 10 ms for two seconds: zero rows scanned, zero questions asked', async () => {
    const terminal = new FakeTerminal();
    terminal.viewport = { top: 0, bottom: 23 };
    const { scanned, scan } = scanOver(terminal);

    for (let i = 0; i < 200; i += 1) {
      terminal.write(`built src/file${i}.ts`);
      await vi.advanceTimersByTimeAsync(10);
    }

    expect(scanned).toEqual([]);
    expect(asked).toEqual([]);
    scan.dispose();
  });
});

describe('P13 — the scan starts only after LINK_IDLE_SCAN_MS of quiet', () => {
  it('not a millisecond before', async () => {
    const terminal = new FakeTerminal();
    for (let i = 0; i < 30; i += 1) terminal.rows.push(`row ${i}`);
    terminal.viewport = { top: 0, bottom: 23 };
    const { scanned, scan } = scanOver(terminal);
    terminal.write('last line');

    await vi.advanceTimersByTimeAsync(LINK_IDLE_SCAN_MS - 1);
    expect(scanned, 'still inside the quiet interval').toEqual([]);

    await vi.advanceTimersByTimeAsync(LINK_IDLE_SCAN_MS);
    expect(scanned.length, 'once quiet, the rows in view are scanned').toBeGreaterThan(0);
    scan.dispose();
  });
});

describe('P13 — a write during the scan cancels it', () => {
  it('no row is scanned after the write until the terminal is quiet again', async () => {
    const terminal = new FakeTerminal();
    for (let i = 0; i < 400; i += 1) terminal.rows.push(`row ${i}`);
    terminal.viewport = { top: 100, bottom: 399 };
    const { scanned, scan } = scanOver(terminal);
    terminal.write('go');

    await vi.advanceTimersByTimeAsync(LINK_IDLE_SCAN_MS); // the scan has just started
    const atWrite = scanned.length;
    terminal.write('more output'); // cancels it
    await vi.advanceTimersByTimeAsync(LINK_IDLE_SCAN_MS - 1);

    expect(scanned.length, 'the write stopped the scan where it stood').toBe(atWrite);

    await vi.advanceTimersByTimeAsync(LINK_IDLE_SCAN_MS * 4);
    expect(scanned.length, 'quiet again, and the scan resumes').toBeGreaterThan(atWrite);
    scan.dispose();
  });
});

describe('P13 — only rows in the viewport are scanned', () => {
  it('rows 100 – 123 of 500, each once, and nothing else', async () => {
    const terminal = new FakeTerminal();
    for (let i = 0; i < 500; i += 1) terminal.rows.push(`row ${i}`);
    terminal.viewport = { top: 100, bottom: 123 };
    const { scanned, scan } = scanOver(terminal);
    terminal.write('done');

    await vi.advanceTimersByTimeAsync(LINK_IDLE_SCAN_MS * 10);

    expect([...scanned].sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => 100 + i));
    scan.dispose();
  });
});

describe('P13 / FR-070 — the scan fills the SAME cache a hover reads, within the per-line cap', () => {
  it('a path in view is resolved without a hover, and the hover then finds it answered', async () => {
    const terminal = new FakeTerminal();
    terminal.rows = ['compiled src/foo.ts', Array.from({ length: 5_000 }, (_, i) => `d${i}/f${i}.ts`).join(' ')];
    terminal.viewport = { top: 0, bottom: 1 };
    const site = { panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: 'D:\\p' };
    const provider = createFileLinkProvider({
      detect: () => true,
      terminal: { buffer: { active: { getLine: (i: number) => (terminal.rows[i] === undefined ? undefined : { translateToString: () => terminal.rows[i]! }) } } },
      site: () => site,
      ask: askTerminalLink,
      onHover: () => {},
      follow: () => {},
    });
    const scan = createLinkIdleScan({
      onWriteQuiet: (listener: () => void, quietMs: number) => terminal.onWriteQuiet(listener, quietMs),
      onWrite: (listener: () => void) => terminal.onWrite(listener),
      viewportRows: () => terminal.viewport,
      // "the provider's own ask, cache-backed" (data-model §14.2): row index 0-based, xterm lines 1-based.
      scanRow: (row: number) => provider.provideLinks(row + 1, () => {}),
    } as Parameters<typeof createLinkIdleScan>[0]);

    terminal.write('');
    await vi.advanceTimersByTimeAsync(LINK_IDLE_SCAN_MS * 10);

    expect(
      peekLink({ text: 'src/foo.ts', kind: 'detectedPath', ...site }),
      'the answer is in the cache a hover peeks',
    ).toMatchObject({ ok: true });
    const fromTheLongRow = asked.filter((r) => /^d\d+\//.test(r.text));
    expect(fromTheLongRow.length, 'the per-line cap bounds the scan too').toBeLessThanOrEqual(MAX_LINK_CANDIDATES_PER_LINE);
    scan.dispose();
  });
});

describe('dispose', () => {
  it('a disposed scan never runs again', async () => {
    const terminal = new FakeTerminal();
    terminal.rows = ['a', 'b'];
    terminal.viewport = { top: 0, bottom: 1 };
    const { scanned, scan } = scanOver(terminal);
    scan.dispose();
    terminal.write('c');
    await vi.advanceTimersByTimeAsync(LINK_IDLE_SCAN_MS * 10);
    expect(scanned).toEqual([]);
  });
});
