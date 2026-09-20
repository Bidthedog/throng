import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LINK_CANDIDATES_PER_LINE } from '@throng/core';
import type { LinkPosition, LinkResolution, LinkResolutionRequest } from '@throng/core';
import {
  createFileLinkProvider,
  type FileLinkProviderDeps,
  type LinkProviderTerminal,
  type ProvidedLink,
} from '../../src/renderer/terminal/file-link-provider.js';
import type { HoveredLink } from '../../src/renderer/terminal/hovered-link.js';
import type { TerminalLinkSite } from '../../src/renderer/terminal/terminal-link-activation.js';

/**
 * 045 T069 (FR-070, FR-071, FR-072; P1/P2) — **the structural performance assertion**, and Open
 * item O1 settled with it.
 *
 * ══ WHY THIS IS A STRUCTURE TEST AND NOT A STOPWATCH ══
 *
 * FR-072 asks for a test that no existence check runs while output is being delivered. A timing test
 * would answer a different question — "is it fast enough on this machine today" — and would flake on
 * a shared runner by construction. The requirement is structural: the terminal's data path must have
 * **no resolver on it at all**.
 *
 * So the assertion is a count, and the count is zero. 50,000 lines in, nothing asked. That is a
 * claim about the SHAPE of the code, and it stays true on any hardware.
 *
 * ══ ROUND FOUR (T262; FR-155, SC-021): NOTHING IS ASKED TO DRAW A LINK AT ALL ══
 *
 * Validity is syntactic, so `provideLinks` answers xterm SYNCHRONOUSLY from the grammar
 * (`scanLinkLine`) — no existence check, no held reply, no answer deadline, no superseding.
 * The held-reply and late-answer cases (T069's "first hover", T149 / FR-123) described a reply that
 * waited for main; there is no longer anything to wait for, so they are replaced below by the
 * synchronous answer they were protecting. Main is asked only when a link is FOLLOWED — the provider
 * hands the follow the request, built from the site as it is at the click (FR-023).
 */

const SITE: TerminalLinkSite = { panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: 'D:\\p' };

/**
 * The narrowest thing that behaves like an xterm `Terminal` for this provider: rows to read, and the
 * two subscriptions a provider must never make.
 */
class FakeTerminal implements LinkProviderTerminal {
  readonly rows: string[] = [];
  subscriptions: string[] = [];

  buffer = {
    active: {
      getLine: (index: number) =>
        this.rows[index] === undefined
          ? undefined
          : { translateToString: () => this.rows[index] as string },
    },
  };

  /** The data path. Writing to it is what a running program does, tens of thousands of times. */
  write(line: string): void {
    this.rows.push(line);
  }

  onData(): void {
    this.subscriptions.push('onData');
  }

  onWriteParsed(): void {
    this.subscriptions.push('onWriteParsed');
  }
}

/** Every `throng:links:*` request, whatever the channel — the count this file is about. */
let asked: { channel: string; request: LinkResolutionRequest }[];

function providerOn(
  terminal: LinkProviderTerminal,
  over: Partial<FileLinkProviderDeps> = {},
): ReturnType<typeof createFileLinkProvider> {
  return createFileLinkProvider({
    detect: () => true,
    terminal,
    site: () => SITE,
    onHover: () => {},
    follow: () => {},
    ...over,
  });
}

/** xterm's one question for a row, and every reply it got — synchronously. */
function repliesOn(terminal: LinkProviderTerminal, row: number, over: Partial<FileLinkProviderDeps> = {}) {
  const replies: Array<ProvidedLink[] | undefined> = [];
  providerOn(terminal, over).provideLinks(row, (links) => replies.push(links));
  return replies;
}

const provideOn = (terminal: LinkProviderTerminal, row: number): ProvidedLink[] | undefined =>
  repliesOn(terminal, row)[0];

beforeEach(() => {
  asked = [];
  const record = (channel: string) => async (request: LinkResolutionRequest): Promise<LinkResolution> => {
    asked.push({ channel, request });
    return { ok: false };
  };
  vi.stubGlobal('window', {
    throng: { links: { resolve: record('resolve'), follow: record('follow'), reveal: record('reveal'), open: record('open') } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FR-072 — nothing on the output path asks about a file', () => {
  it('pushes 50,000 lines through the data path and asks main exactly zero times', () => {
    const terminal = new FakeTerminal();
    providerOn(terminal);

    for (let i = 0; i < 50_000; i += 1) terminal.write(`built src/file${i}.ts in ${i}ms`);

    expect(asked).toEqual([]);
  });

  it('subscribes to nothing on the terminal — no onData, no onWriteParsed (Open item O1)', () => {
    const terminal = new FakeTerminal();
    providerOn(terminal);
    for (let i = 0; i < 100; i += 1) terminal.write(`src/file${i}.ts`);

    expect(terminal.subscriptions).toEqual([]);
  });
});

describe('T262 / FR-155 — provideLinks answers from the grammar, synchronously, asking nothing', () => {
  it('answers the one query xterm makes, at once, with the link — a path that names nothing included', () => {
    const terminal = new FakeTerminal();
    terminal.write('cannot find src/gone.ts');

    const replies = repliesOn(terminal, 1);

    expect(replies, 'exactly one reply, delivered before provideLinks returned').toHaveLength(1);
    expect(replies[0]?.map((l) => l.text)).toEqual(['src/gone.ts']);
    expect(asked, 'drawing a link asks main nothing').toEqual([]);
  });

  it('answers exactly once per ask, and the same links on every ask', () => {
    const terminal = new FakeTerminal();
    terminal.write('compiled src/foo.ts and src/bar.ts');
    const provider = providerOn(terminal);
    const replies: Array<ProvidedLink[] | undefined> = [];

    provider.provideLinks(1, (links) => replies.push(links));
    provider.provideLinks(1, (links) => replies.push(links));

    expect(replies).toHaveLength(2);
    expect(replies.map((r) => r?.map((l) => l.text))).toEqual([
      ['src/foo.ts', 'src/bar.ts'],
      ['src/foo.ts', 'src/bar.ts'],
    ]);
    expect(asked).toEqual([]);
  });

  it('a hover hands over the request and position — no resolved answer, and still nothing asked', () => {
    const terminal = new FakeTerminal();
    terminal.write('at src/foo.ts:42:7 here');
    const hovered: HoveredLink[] = [];
    const link = provideOn(terminal, 1)?.[0];
    expect(link).toBeDefined();
    const provider = providerOn(terminal, { onHover: (h) => void (h && hovered.push(h)) });
    let links: ProvidedLink[] = [];
    provider.provideLinks(1, (l) => (links = l ?? []));
    links[0]!.hover({} as MouseEvent, links[0]!.text);

    expect(hovered).toEqual([
      {
        kind: 'file',
        request: { text: 'src/foo.ts', kind: 'detectedPath', panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: 'D:\\p' },
        position: { line: 42, column: 7 },
        positionText: ':42:7',
      },
    ]);
    expect(asked).toEqual([]);
  });

  it('R7: the positioned reading keeps its span — one link, not two overlapping ones', () => {
    const terminal = new FakeTerminal();
    terminal.write('see src/foo.ts:42 here');
    expect(provideOn(terminal, 1)?.map((l) => l.text)).toEqual(['src/foo.ts']);
  });

  it('a Ctrl+click hands the follow the request, built from the site AT THE CLICK (FR-023)', () => {
    const terminal = new FakeTerminal();
    terminal.write('built src/foo.ts:3');
    let cwd = 'D:\\p';
    const followed: { request: LinkResolutionRequest; position?: LinkPosition }[] = [];
    const provider = providerOn(terminal, {
      site: () => ({ ...SITE, baseDirectory: cwd }),
      follow: (args) => void followed.push(args),
    });
    let links: ProvidedLink[] = [];
    provider.provideLinks(1, (l) => (links = l ?? []));
    cwd = 'D:\\p\\packages\\ui';

    links[0]!.activate({ ctrlKey: false, metaKey: false } as MouseEvent, 'src/foo.ts');
    expect(followed, 'a plain click keeps its terminal meaning (FR-040)').toEqual([]);
    links[0]!.activate({ ctrlKey: true, metaKey: false } as MouseEvent, 'src/foo.ts');

    expect(followed).toEqual([
      {
        request: {
          text: 'src/foo.ts',
          kind: 'detectedPath',
          panelId: 'panel-1',
          originProjectId: 'project-1',
          baseDirectory: 'D:\\p\\packages\\ui',
        },
        position: { line: 3 },
      },
    ]);
  });
});

describe('the span it underlines', () => {
  it('covers the path alone, in xterm 1-based inclusive columns', () => {
    const terminal = new FakeTerminal();
    terminal.write('ok src/foo.ts done');

    const link = provideOn(terminal, 1)?.[0];
    expect(link?.range).toEqual({ start: { x: 4, y: 1 }, end: { x: 13, y: 1 } });
  });

  it('declines a span the web-link scanner already owns (FR-009)', () => {
    const terminal = new FakeTerminal();
    /*
     * Two defences agree here, and the requirement is the OUTCOME rather than either of them: the
     * grammar refuses any `scheme://` token that is not `file:` (rule D), and the provider hands
     * detection the ranges the web pattern matched so a claimed span yields nothing (D2). The second
     * is what FR-009 names, and it is what still holds if the grammar is ever loosened — so the
     * claim is asserted through its effect, on a line carrying a url and a real path at once.
     */
    terminal.write('see https://example.com/src/foo.ts for src/foo.ts');

    // T177: the url itself is served by this provider too (WebLinksAddon unloaded), so it is set aside
    // here — the FR-009 question is how many FILE links the line yields.
    const all = provideOn(terminal, 1) ?? [];
    expect(all.filter((l) => l.kind === 'web').map((l) => l.text)).toEqual(['https://example.com/src/foo.ts']);
    const links = all.filter((l) => l.kind === 'file');
    expect(links).toHaveLength(1);
    // The surviving one is the bare path at the end of the line, not the one inside the url.
    expect(links[0]?.range.start.x).toBeGreaterThan('see https://example.com/src/foo.ts'.length);
  });
});

describe('the per-line candidate cap (FR-071 — a bound on work, kept)', () => {
  it('never serves more than the cap for one row, however many paths it holds', () => {
    const terminal = new FakeTerminal();
    terminal.write(Array.from({ length: 5_000 }, (_, i) => `d${i}/f${i}.ts`).join(' '));

    const links = provideOn(terminal, 1) ?? [];

    expect(links.length).toBeLessThanOrEqual(MAX_LINK_CANDIDATES_PER_LINE);
    expect(links.length).toBeGreaterThan(0);
    expect(asked).toEqual([]);
  });

  // Review round four (L2): the cap bounded `scanned.paths` and nothing else, so the DECLARED
  // addresses round four added — web and allowlisted protocol spans — were served unbounded. The
  // rationale in `limits.ts` ("each one becomes a mark, a decoration and a hit-test entry inside that
  // callback") does not care which scanner produced the span.
  it('bounds DECLARED addresses too, not only guessed paths', () => {
    const terminal = new FakeTerminal();
    terminal.write(Array.from({ length: 5_000 }, (_, i) => `https://example.com/p${i}`).join(' '));

    const links = provideOn(terminal, 1) ?? [];

    expect(links.length).toBeLessThanOrEqual(MAX_LINK_CANDIDATES_PER_LINE);
    expect(links.length).toBeGreaterThan(0);
  });
});

describe('the row it reads', () => {
  it('answers nothing for a row the buffer does not hold, and for an empty one', () => {
    const terminal = new FakeTerminal();
    terminal.write('');

    expect(provideOn(terminal, 1)).toBeUndefined();
    expect(provideOn(terminal, 99)).toBeUndefined();
    expect(asked).toEqual([]);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T176 — FR-130 – FR-133, SC-015: a link the terminal WRAPPED is one link (closes #326)
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * What the user saw (O11's probe, 76 columns): a plain-text path that soft-wraps was no link at all —
 * the provider read one ROW. A link's range may start and end on DIFFERENT rows; a link that fits on
 * one row still has `start.y === end.y`. The fake terminal's rows carry `isWrapped` (data-model §14.1).
 */
describe('T176 / FR-130 – FR-133 — wrapped links', () => {
  const COLS = 20;

  class WrappingTerminal implements LinkProviderTerminal {
    readonly rows: { text: string; isWrapped: boolean }[] = [];
    subscriptions: string[] = [];
    buffer = {
      active: {
        getLine: (index: number) => {
          const row = this.rows[index];
          return row === undefined
            ? undefined
            : { translateToString: () => row.text, isWrapped: row.isWrapped };
        },
      },
    };

    /** Print one LOGICAL line, soft-wrapped at `COLS` the way xterm wraps it. Returns its first row (0-based). */
    print(line: string): number {
      const first = this.rows.length;
      for (let at = 0; at < line.length || at === 0; at += COLS) {
        this.rows.push({ text: line.slice(at, at + COLS), isWrapped: at > 0 });
      }
      return first;
    }

    /** Print a line broken by a REAL newline: the rows are adjacent and NOT marked wrapped (FR-132). */
    printHardBroken(first: string, second: string): void {
      this.rows.push({ text: first, isWrapped: false }, { text: second, isWrapped: false });
    }

    onData(): void {
      this.subscriptions.push('onData');
    }

    onWriteParsed(): void {
      this.subscriptions.push('onWriteParsed');
    }
  }

  /** xterm's 1-based inclusive cell for a 0-based offset into a logical line starting at `firstRow`. */
  const cell = (firstRow: number, offset: number) => ({
    x: (offset % COLS) + 1,
    y: firstRow + 1 + Math.floor(offset / COLS),
  });

  /** The range a span `[start, end)` of a logical line should get. */
  const rangeOf = (firstRow: number, start: number, end: number) => ({
    start: cell(firstRow, start),
    end: cell(firstRow, end - 1),
  });

  const linksOn = (terminal: LinkProviderTerminal, row: number, follow: FileLinkProviderDeps['follow'] = () => {}) =>
    repliesOn(terminal, row, { follow })[0] ?? [];

  for (const rowsSpanned of [2, 3] as const) {
    it(`a detected path wrapped across ${rowsSpanned} rows is ONE link, served for every row it occupies`, () => {
      const path = rowsSpanned === 2 ? 'src/deeply/nested/folder/foo.ts' : 'src/deeply/nested/folder/and/more/foo.ts';
      const line = `built ${path} ok`;
      const terminal = new WrappingTerminal();
      const first = terminal.print(line);
      const start = line.indexOf(path);
      const expected = rangeOf(first, start, start + path.length);
      expect(expected.end.y - expected.start.y + 1, 'the fixture really spans that many rows').toBe(rowsSpanned);

      for (let row = expected.start.y; row <= expected.end.y; row += 1) {
        expect(
          linksOn(terminal, row).map((l) => ({ text: l.text, range: l.range })),
          `provideLinks for row ${row} of the wrapped path`,
        ).toEqual([{ text: path, range: expected }]);
      }
    });
  }

  for (const rowsSpanned of [2, 3] as const) {
    it(`a web URL wrapped across ${rowsSpanned} rows is ONE link, served by this provider for every row`, () => {
      const url =
        rowsSpanned === 2 ? 'https://example.com/a/b' : 'https://example.com/docs/guide/intro/more/x';
      const line = `see ${url} now`;
      const terminal = new WrappingTerminal();
      const first = terminal.print(line);
      const start = line.indexOf(url);
      const expected = rangeOf(first, start, start + url.length);
      expect(expected.end.y - expected.start.y + 1, 'the fixture really spans that many rows').toBe(rowsSpanned);

      for (let row = expected.start.y; row <= expected.end.y; row += 1) {
        expect(
          linksOn(terminal, row).map((l) => ({ text: l.text, range: l.range })),
          `provideLinks for row ${row} of the wrapped url`,
        ).toEqual([{ text: url, range: expected }]);
      }
      // A web link is not resolved by main (contract §6.1): no request for it may reach the bridge.
      expect(asked).toEqual([]);
    });
  }

  for (const rowsSpanned of [2, 3] as const) {
    it(`a positioned path wrapped across ${rowsSpanned} rows is one link, and a follow from any row carries its position`, () => {
      const path = rowsSpanned === 2 ? 'src/deeply/nested/folder/foo.ts' : 'src/deeply/nested/folder/and/more/foo.ts';
      const line = `at ${path}:42:7 here`;
      const terminal = new WrappingTerminal();
      const first = terminal.print(line);
      const start = line.indexOf(path);
      const expected = rangeOf(first, start, start + path.length);
      expect(expected.end.y - expected.start.y + 1, 'the fixture really spans that many rows').toBe(rowsSpanned);

      for (let row = expected.start.y; row <= expected.end.y; row += 1) {
        const followed: unknown[] = [];
        const links = linksOn(terminal, row, (args) => void followed.push(args));
        expect(links.map((l) => ({ text: l.text, range: l.range })), `row ${row}`).toEqual([
          { text: path, range: expected },
        ]);
        links[0]?.activate({ ctrlKey: true, metaKey: false } as MouseEvent, path);
        expect(followed, `a Ctrl+click on row ${row} follows it once, at 42:7`).toEqual([
          expect.objectContaining({ position: { line: 42, column: 7 } }),
        ]);
      }
    });
  }

  it('FR-132: two rows broken by a REAL newline are never joined into one link', () => {
    const terminal = new WrappingTerminal();
    terminal.printHardBroken('see src/deep/', 'foo.ts ok');

    const texts = [...linksOn(terminal, 1), ...linksOn(terminal, 2)].map((l) => l.text);
    expect(texts, 'the joined text is never a link').not.toContain('src/deep/foo.ts');
    for (const l of [...linksOn(terminal, 1), ...linksOn(terminal, 2)]) {
      expect(l.range.start.y, `${l.text} stays on its own row`).toBe(l.range.end.y);
    }
  });

  it('FR-133 / FR-072: joining happens only when a row is ASKED about — 50,000 wrapped lines ask nothing', () => {
    const terminal = new WrappingTerminal();
    providerOn(terminal);
    for (let i = 0; i < 50_000; i += 1) terminal.print(`built src/deeply/nested/folder/file${i}.ts in ${i}ms`);

    expect(asked).toEqual([]);
    expect(terminal.subscriptions).toEqual([]);
  });
});
