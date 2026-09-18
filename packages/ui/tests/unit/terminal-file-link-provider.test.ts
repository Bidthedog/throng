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

    const links = provideOn(terminal, 1) ?? [];
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
