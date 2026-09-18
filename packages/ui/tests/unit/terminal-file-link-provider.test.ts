import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LINK_CANDIDATES_PER_LINE } from '@throng/core';
import type { LinkResolution, LinkResolutionRequest, ResolvedLink } from '@throng/core';
import { __resetLinkCacheForTests, invalidateLinksUnder } from '../../src/renderer/links/link-cache.js';
import {
  LINK_ANSWER_DEADLINE_MS,
  createFileLinkProvider,
  type LinkProviderTerminal,
  type ProvidedLink,
} from '../../src/renderer/terminal/file-link-provider.js';
import { askTerminalLink, type TerminalLinkSite } from '../../src/renderer/terminal/terminal-link-activation.js';

/**
 * 045 T069 (FR-070, FR-071, FR-072; P1/P2) — **the structural performance assertion**, and Open
 * item O1 settled with it.
 *
 * ══ WHY THIS IS A STRUCTURE TEST AND NOT A STOPWATCH ══
 *
 * FR-072 asks for a test that no existence check runs while output is being delivered. A timing test
 * would answer a different question — "is it fast enough on this machine today" — and would flake on
 * a shared runner by construction. The requirement is structural: the terminal's data path must have
 * **no resolver on it at all**, and the only thing that can ask about a file is a link provider,
 * which xterm calls for a row it is about to render and for the row under the pointer.
 *
 * So the assertion is a count, and the count is zero. 50,000 lines in, nothing asked. That is a
 * claim about the SHAPE of the code, and it stays true on any hardware.
 *
 * The fake `Terminal` below is what makes it sayable at this layer: it records every subscription
 * the provider makes, so "registers no `onData`/`onWriteParsed` hook" is asserted rather than
 * assumed — a provider that added one would still pass a counting test that only measured hovers.
 */

const FOO: ResolvedLink = {
  path: 'D:\\p\\src\\foo.ts',
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
};

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

let asked: LinkResolutionRequest[];
let answers: Record<string, LinkResolution>;

const provideOn = (
  terminal: LinkProviderTerminal,
  row: number,
  site: TerminalLinkSite = SITE,
): ProvidedLink[] | undefined => {
  const provider = createFileLinkProvider({
    detect: () => true,
    terminal,
    site: () => site,
    ask: askTerminalLink,
    onHover: () => {},
    follow: () => {},
  });
  let links: ProvidedLink[] | undefined;
  provider.provideLinks(row, (result) => {
    links = result;
  });
  return links;
};

beforeEach(() => {
  asked = [];
  answers = {};
  vi.stubGlobal('window', {
    throng: {
      links: {
        resolve: async (request: LinkResolutionRequest): Promise<LinkResolution> => {
          asked.push(request);
          return answers[request.text] ?? { ok: false };
        },
      },
    },
  });
  __resetLinkCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FR-072 — nothing on the output path asks about a file', () => {
  it('pushes 50,000 lines through the data path and asks the resolver exactly zero times', () => {
    const terminal = new FakeTerminal();
    createFileLinkProvider({
      detect: () => true,
      terminal,
      site: () => SITE,
      ask: askTerminalLink,
      onHover: () => {},
      follow: () => {},
    });

    for (let i = 0; i < 50_000; i += 1) terminal.write(`built src/file${i}.ts in ${i}ms`);

    expect(asked).toEqual([]);
  });

  it('subscribes to nothing on the terminal — no onData, no onWriteParsed (Open item O1)', () => {
    const terminal = new FakeTerminal();
    createFileLinkProvider({
      detect: () => true,
      terminal,
      site: () => SITE,
      ask: askTerminalLink,
      onHover: () => {},
      follow: () => {},
    });
    for (let i = 0; i < 100; i += 1) terminal.write(`src/file${i}.ts`);

    expect(terminal.subscriptions).toEqual([]);
  });
});

describe('FR-070/FR-071 — one row, one question, and only once', () => {
  it('asks exactly once when a row is provided for', () => {
    const terminal = new FakeTerminal();
    terminal.write('compiled src/foo.ts');

    expect(provideOn(terminal, 1)).toBeUndefined(); // no answer yet, so no link (FR-071)
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual({
      text: 'src/foo.ts',
      kind: 'detectedPath',
      panelId: 'panel-1',
      originProjectId: 'project-1',
      baseDirectory: 'D:\\p',
    });
  });

  it('asks nothing the second time the same span is provided for', async () => {
    const terminal = new FakeTerminal();
    terminal.write('compiled src/foo.ts');
    answers['src/foo.ts'] = { ok: true, link: FOO };

    provideOn(terminal, 1);
    await Promise.resolve();
    await Promise.resolve();
    asked = [];

    const links = provideOn(terminal, 1);
    expect(asked).toEqual([]);
    expect(links).toHaveLength(1);
    expect(links?.[0]?.text).toBe('src/foo.ts');
  });

  it('underlines only what resolved — a path that names nothing draws nothing (FR-006)', async () => {
    const terminal = new FakeTerminal();
    terminal.write('cannot find src/gone.ts');

    provideOn(terminal, 1);
    await Promise.resolve();
    await Promise.resolve();

    expect(provideOn(terminal, 1)).toBeUndefined();
  });
});

describe('the span it underlines', () => {
  it('covers the path alone, in xterm 1-based inclusive columns', async () => {
    const terminal = new FakeTerminal();
    terminal.write('ok src/foo.ts done');
    answers['src/foo.ts'] = { ok: true, link: FOO };

    provideOn(terminal, 1);
    await Promise.resolve();
    await Promise.resolve();

    const link = provideOn(terminal, 1)?.[0];
    expect(link?.range).toEqual({ start: { x: 4, y: 1 }, end: { x: 13, y: 1 } });
  });

  it('declines a span the web-link scanner already owns (FR-009)', async () => {
    const terminal = new FakeTerminal();
    /*
     * Two defences agree here, and the requirement is the OUTCOME rather than either of them: the
     * grammar refuses any `scheme://` token that is not `file:` (rule D), and the provider hands
     * detection the ranges the web pattern matched so a claimed span yields nothing (D2). The second
     * is what FR-009 names, and it is what still holds if the grammar is ever loosened — so the
     * claim is asserted through its effect, on a line carrying a url and a real path at once.
     */
    terminal.write('see https://example.com/src/foo.ts for src/foo.ts');
    answers['src/foo.ts'] = { ok: true, link: FOO };

    provideOn(terminal, 1);
    await Promise.resolve();
    await Promise.resolve();

    // T177: the url itself is now served by this provider too (WebLinksAddon unloaded), so it is
    // set aside here — the FR-009 question is how many FILE links the line yields.
    const all = provideOn(terminal, 1) ?? [];
    expect(all.filter((l) => l.kind === 'web').map((l) => l.text)).toEqual(['https://example.com/src/foo.ts']);
    const links = all.filter((l) => l.kind === 'file');
    expect(links).toHaveLength(1);
    // The surviving one is the bare path at the end of the line, not the one inside the url.
    expect(links[0]?.range.start.x).toBeGreaterThan('see https://example.com/src/foo.ts'.length);
  });
});

describe('the per-line candidate cap (FR-071)', () => {
  it('never asks more than the cap for one row, however many paths it holds', () => {
    const terminal = new FakeTerminal();
    terminal.write(Array.from({ length: 5_000 }, (_, i) => `d${i}/f${i}.ts`).join(' '));

    provideOn(terminal, 1);

    expect(asked.length).toBeLessThanOrEqual(MAX_LINK_CANDIDATES_PER_LINE);
    expect(asked.length).toBeGreaterThan(0);
  });
});

describe('the first hover on a line must not be thrown away (xterm caches the reply)', () => {
  /*
   * ══ THE DEFECT THIS PINS ══
   *
   * `Linkifier._askForLink` calls a provider ONCE per line and stores whatever comes back in
   * `_activeProviderReplies`. Every further hover on that same line takes the `useLineCache` branch,
   * which reads the stored reply and deliberately does NOT call the provider again — its own TODO
   * says so. So a reply is not a first draft: it is the only answer xterm will ever have for that
   * line until the pointer leaves it.
   *
   * The provider used to answer `undefined` the moment the cache missed, which is every first hover
   * on a path. The resolution landed a few milliseconds later and nothing asked again, so the user
   * moved onto a path, rested there, and saw no underline, no tooltip and a dead Ctrl+click — until
   * they moved off the line and back onto it. The old header called this "a frame later"; there was
   * no later.
   *
   * xterm supports the fix directly: the callback may be invoked asynchronously, and
   * `_checkLinkProviderResult` runs against the position the ask was made at. So the provider holds
   * the reply until its answers are in.
   */
  const replyOn = (
    terminal: LinkProviderTerminal,
    row: number,
  ): Array<ProvidedLink[] | undefined> => {
    const provider = createFileLinkProvider({
      detect: () => true,
      terminal,
      site: () => SITE,
      ask: askTerminalLink,
      onHover: () => {},
      follow: () => {},
    });
    const replies: Array<ProvidedLink[] | undefined> = [];
    provider.provideLinks(row, (links) => replies.push(links));
    return replies;
  };

  it('answers the one query xterm makes with the link, once the resolution lands', async () => {
    const terminal = new FakeTerminal();
    terminal.write('compiled src/foo.ts');
    answers['src/foo.ts'] = { ok: true, link: FOO };

    const replies = replyOn(terminal, 1);
    await Promise.resolve();
    await Promise.resolve();

    expect(replies).toHaveLength(1);
    expect(replies[0]).toHaveLength(1);
    expect(replies[0]?.[0]?.text).toBe('src/foo.ts');
  });

  it('holds the reply back rather than answering "no links" while it is still asking', () => {
    const terminal = new FakeTerminal();
    terminal.write('compiled src/foo.ts');
    answers['src/foo.ts'] = { ok: true, link: FOO };

    // Synchronously, there is no answer yet — and crucially there is no REPLY yet either, because a
    // reply of `undefined` is the one xterm would keep.
    expect(replyOn(terminal, 1)).toEqual([]);
  });

  it('answers exactly once, and never a second time after that', async () => {
    const terminal = new FakeTerminal();
    terminal.write('compiled src/foo.ts and src/bar.ts');
    answers['src/foo.ts'] = { ok: true, link: FOO };
    answers['src/bar.ts'] = { ok: true, link: FOO };

    const replies = replyOn(terminal, 1);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    // A second answer landing must not produce a second reply: xterm would store it against
    // whichever line it is looking at by then.
    invalidateLinksUnder('D:\\p');
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    expect(replies).toHaveLength(1);
    expect(replies[0]).toHaveLength(2);
  });

  it('answers straight away when every candidate is already resolved', async () => {
    const terminal = new FakeTerminal();
    terminal.write('compiled src/foo.ts');
    answers['src/foo.ts'] = { ok: true, link: FOO };

    replyOn(terminal, 1);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    // The second hover on a fresh line: nothing is pending, so nothing is deferred.
    const replies = replyOn(terminal, 1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toHaveLength(1);
  });

  it('still answers when the bridge never comes back, so xterm is never left waiting', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('window', { throng: {} }); // no links bridge at all: the request cannot be made
      const terminal = new FakeTerminal();
      terminal.write('compiled src/foo.ts');

      const replies = replyOn(terminal, 1);
      expect(replies).toEqual([]);

      await vi.advanceTimersByTimeAsync(LINK_ANSWER_DEADLINE_MS);
      expect(replies).toEqual([undefined]);
    } finally {
      vi.useRealTimers();
    }
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
 * 045 T149 — FR-123: an answer that lands after the provider stopped waiting still becomes a link
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * What the user sees today: a path on a slow share (a stat that takes longer than
 * `LINK_ANSWER_DEADLINE_MS`, one second, and less than the existence-check timeout, two). They rest
 * the pointer on it; nothing is underlined; the answer lands a moment later and is filed nowhere, so
 * the path stays dead until they move off the line and back. FR-071's "not a link UNTIL IT ANSWERS"
 * is read as binding in both directions (FR-123).
 *
 * The observable is written so either of O7's mechanisms satisfies it (research.md R19): (a) hold
 * the reply for the existence-check timeout rather than a separate constant, or (b) make xterm ask
 * again for that line. The harness below plays xterm: it asks once per line and KEEPS the reply
 * (`Linkifier._askForLink` / `useLineCache`), and `reask` is what a (b) implementation would drive —
 * T150 wires it if (b) is chosen. Either way, the assertion is the same: by the time the answer has
 * landed, xterm's stored reply for THAT line holds the link, and no other line was asked about in
 * between.
 *
 * The timeout reaches the provider as `readLinkSettings`, the resolver's dependency shape
 * (data-model §13.5), so the wait is governed by the setting and not by an independent constant.
 */
describe('T149 / FR-123 — a late answer still yields that line\u2019s link', () => {
  /** xterm, reduced to its link cache: one stored reply per line, and the order lines were asked. */
  function xtermWith(terminal: LinkProviderTerminal, timeoutMs: number) {
    const stored = new Map<number, ProvidedLink[] | undefined>();
    const askedLines: number[] = [];
    // `provider` is declared below; `ask` only runs after it exists.
    const ask = (line: number): void => {
      askedLines.push(line);
      provider.provideLinks(line, (links) => stored.set(line, links));
    };
    const deps = {
      detect: () => true,
      terminal,
      site: () => SITE,
      ask: askTerminalLink,
      onHover: () => {},
      follow: () => {},
      // The existence-check timeout, read per ask (FR-120) — the provider's wait is THIS, not its own.
      readLinkSettings: () => ({
        detectInEditors: true,
        detectInTerminals: true,
        existenceCheckTimeoutMs: timeoutMs,
      }),
      // O7 (b)'s hook: a provider that chooses to make xterm ask again calls this for the line.
      reask: (line: number) => ask(line),
    };
    const provider = createFileLinkProvider(deps as Parameters<typeof createFileLinkProvider>[0]);
    return { ask, stored, askedLines };
  }

  /** A bridge whose answer for `src/foo.ts` lands after `delayMs` of (fake) time. */
  function slowBridge(delayMs: number): void {
    vi.stubGlobal('window', {
      throng: {
        links: {
          resolve: (request: LinkResolutionRequest): Promise<LinkResolution> => {
            asked.push(request);
            return new Promise((resolve) => {
              setTimeout(
                () => resolve(request.text === 'src/foo.ts' ? { ok: true, link: FOO } : { ok: false }),
                delayMs,
              );
            });
          },
        },
      },
    });
  }

  it('an answer landing after LINK_ANSWER_DEADLINE_MS but inside the timeout reaches xterm for that line', async () => {
    vi.useFakeTimers();
    try {
      const answerAt = LINK_ANSWER_DEADLINE_MS + 500;
      slowBridge(answerAt);
      const terminal = new FakeTerminal();
      terminal.write('compiled src/foo.ts');
      const xterm = xtermWith(terminal, 2000);

      xterm.ask(1);
      await vi.advanceTimersByTimeAsync(2000);

      expect(xterm.askedLines.filter((l) => l !== 1), 'no other line was asked about in between').toEqual([]);
      const reply = xterm.stored.get(1);
      expect(reply?.map((l) => l.text), 'xterm\u2019s stored reply for line 1 must hold the link').toEqual([
        'src/foo.ts',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the wait follows the SETTING: a 5 s timeout still delivers an answer that lands at 4 s', async () => {
    vi.useFakeTimers();
    try {
      slowBridge(4000);
      const terminal = new FakeTerminal();
      terminal.write('compiled src/foo.ts');
      const xterm = xtermWith(terminal, 5000);

      xterm.ask(1);
      await vi.advanceTimersByTimeAsync(5000);

      expect(xterm.stored.get(1)?.map((l) => l.text)).toEqual(['src/foo.ts']);
    } finally {
      vi.useRealTimers();
    }
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T176 — FR-130 – FR-133, SC-015: a link the terminal WRAPPED is one link (closes #326)
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * What the user sees today (O11's probe, 76 columns): a plain-text path that soft-wraps is no link
 * at all — the provider reads one ROW, so it asks about `src/deeply/nes` and `ted/foo.ts`, neither of
 * which exists. A wrapped web URL is followable only because xterm's WebLinksAddon joins rows itself.
 *
 * The permitted supersession (second round, FR-007's second sentence): a link's range may now start
 * and end on DIFFERENT rows. The single-row range assertions above keep asserting what they did — a
 * link that fits on one row still has `start.y === end.y`.
 *
 * The fake terminal's rows carry `isWrapped`, the one field the provider's slice of xterm grows by
 * (data-model §14.1): true on a row that continues the one above it.
 */
describe('T176 / FR-130 – FR-133 — wrapped links', () => {
  const COLS = 20;
  const DEEP: ResolvedLink = { ...FOO, path: 'D:\\p\\src\\deeply\\nested\\folder\\foo.ts' };

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

  async function settle(): Promise<void> {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  }

  /** Warm the cache for a row, then ask again — the second reply is synchronous and final. */
  async function linksOn(terminal: LinkProviderTerminal, row: number, follow = () => {}) {
    const make = () =>
      createFileLinkProvider({
        detect: () => true,
        terminal,
        site: () => SITE,
        ask: askTerminalLink,
        onHover: () => {},
        follow,
      });
    make().provideLinks(row, () => {});
    await settle();
    let links: ProvidedLink[] | undefined;
    make().provideLinks(row, (result) => {
      links = result;
    });
    return links ?? [];
  }

  for (const rowsSpanned of [2, 3] as const) {
    it(`a detected path wrapped across ${rowsSpanned} rows is ONE link, served for every row it occupies`, async () => {
      const path = rowsSpanned === 2 ? 'src/deeply/nested/folder/foo.ts' : 'src/deeply/nested/folder/and/more/foo.ts';
      const line = `built ${path} ok`;
      answers[path] = { ok: true, link: DEEP };
      const terminal = new WrappingTerminal();
      const first = terminal.print(line);
      const start = line.indexOf(path);
      const expected = rangeOf(first, start, start + path.length);
      expect(expected.end.y - expected.start.y + 1, 'the fixture really spans that many rows').toBe(rowsSpanned);

      for (let row = expected.start.y; row <= expected.end.y; row += 1) {
        const links = await linksOn(terminal, row);
        expect(
          links.map((l) => ({ text: l.text, range: l.range })),
          `provideLinks for row ${row} of the wrapped path`,
        ).toEqual([{ text: path, range: expected }]);
      }
    });
  }

  for (const rowsSpanned of [2, 3] as const) {
    it(`a web URL wrapped across ${rowsSpanned} rows is ONE link, served by this provider for every row`, async () => {
      const url =
        rowsSpanned === 2 ? 'https://example.com/a/b' : 'https://example.com/docs/guide/intro/more/x';
      const line = `see ${url} now`;
      const terminal = new WrappingTerminal();
      const first = terminal.print(line);
      const start = line.indexOf(url);
      const expected = rangeOf(first, start, start + url.length);
      expect(expected.end.y - expected.start.y + 1, 'the fixture really spans that many rows').toBe(rowsSpanned);

      for (let row = expected.start.y; row <= expected.end.y; row += 1) {
        const links = await linksOn(terminal, row);
        expect(
          links.map((l) => ({ text: l.text, range: l.range })),
          `provideLinks for row ${row} of the wrapped url`,
        ).toEqual([{ text: url, range: expected }]);
      }
      // A web link is not resolved by main (contract §6.1): no request for it may reach the bridge.
      expect(asked.map((r) => r.text)).not.toContain(url);
    });
  }

  for (const rowsSpanned of [2, 3] as const) {
    it(`a positioned path wrapped across ${rowsSpanned} rows is one link, and a follow from any row carries its position`, async () => {
      const path = rowsSpanned === 2 ? 'src/deeply/nested/folder/foo.ts' : 'src/deeply/nested/folder/and/more/foo.ts';
      const line = `at ${path}:42:7 here`;
      answers[path] = { ok: true, link: DEEP };
      const terminal = new WrappingTerminal();
      const first = terminal.print(line);
      const start = line.indexOf(path);
      const expected = rangeOf(first, start, start + path.length);
      expect(expected.end.y - expected.start.y + 1, 'the fixture really spans that many rows').toBe(rowsSpanned);

      for (let row = expected.start.y; row <= expected.end.y; row += 1) {
        const followed: unknown[] = [];
        const links = await linksOn(terminal, row, ((args: unknown) => void followed.push(args)) as () => void);
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

  it('FR-132: two rows broken by a REAL newline are never joined into one link', async () => {
    answers['src/deep/foo.ts'] = { ok: true, link: DEEP };
    const terminal = new WrappingTerminal();
    terminal.printHardBroken('see src/deep/', 'foo.ts ok');

    expect(await linksOn(terminal, 1)).toEqual([]);
    expect(await linksOn(terminal, 2)).toEqual([]);
    expect(asked.map((r) => r.text), 'the joined text is never even asked about').not.toContain('src/deep/foo.ts');
  });

  it('FR-133 / FR-072: joining happens only when a row is ASKED about — 50,000 wrapped lines ask nothing', () => {
    const terminal = new WrappingTerminal();
    createFileLinkProvider({
      detect: () => true,
      terminal,
      site: () => SITE,
      ask: askTerminalLink,
      onHover: () => {},
      follow: () => {},
    });
    for (let i = 0; i < 50_000; i += 1) terminal.print(`built src/deeply/nested/folder/file${i}.ts in ${i}ms`);

    expect(asked).toEqual([]);
    expect(terminal.subscriptions).toEqual([]);
  });
});
