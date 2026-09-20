import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LinkActionOutcome,
  LinkFollowOutcome,
  LinkPosition,
  LinkResolution,
  LinkResolutionRequest,
  ResolvedLink,
} from '@throng/core';
import type { LinkFailure } from '../../src/renderer/links/link-actions.js';
import { createFileLinkProvider, type ProvidedLink } from '../../src/renderer/terminal/file-link-provider.js';
import { keepsClickFromProgram, type HoveredLink } from '../../src/renderer/terminal/hovered-link.js';
import {
  activateTerminalHyperlink,
  followTerminalLink,
  hoveredLinkFromUri,
  plainClickShowsHint,
  terminalLinkRequest,
  type TerminalLinkDeps,
  type TerminalLinkSite,
} from '../../src/renderer/terminal/terminal-link-activation.js';

/**
 * 045 T063 (FR-011 – FR-013, FR-037; S1) — what a Ctrl+click on a terminal HYPERLINK does, by
 * scheme.
 *
 * ══ THE ASSERTION THAT MATTERS IS THE NEGATIVE ONE ══
 *
 * 024 FR-019 refused every non-`http(s)` scheme because the only way out of the app was the OS URL
 * opener, which launches whatever a `file:` URI names. 045 lifts that for `file:` ALONE, and only
 * because a file link takes a completely different route: `throng:links:*`, where main re-resolves
 * the text, derives the owning project from the panel and checks the target still exists (FR-037).
 *
 * So "a `file:` target opens" is only half the requirement. The other half is that it does not reach
 * `throng:openExternal` — which is the seam 024 built the refusal into, and which would still hand
 * the URI to the OS. Every case below asserts both.
 */

const IN_PROJECT_FILE: ResolvedLink = {
  path: 'D:\\p\\src\\foo.ts',
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
};

const SITE: TerminalLinkSite = { panelId: 'panel-1', originProjectId: 'project-1' };

const CTRL = { ctrlKey: true, metaKey: false };

let resolved: Record<string, LinkResolution>;
let openedExternally: string[];
let revealed: LinkResolutionRequest[];
let openedInOs: LinkResolutionRequest[];
let openedInEditor: Array<{ link: ResolvedLink; position?: LinkPosition }>;
let openedInPreview: ResolvedLink[];
let failures: LinkFailure[];
/** 045 T294 — every `throng:links:follow`, and what main answers each text (data-model §16.18). */
let followed: LinkResolutionRequest[];
let followOutcomes: Record<string, LinkFollowOutcome>;

const deps = (): TerminalLinkDeps => ({
  openInEditor: (link, position) => {
    openedInEditor.push(position === undefined ? { link } : { link, position });
  },
  openInPreview: (link) => {
    openedInPreview.push(link);
  },
  reportFailure: (outcome) => {
    failures.push(outcome);
  },
});

beforeEach(() => {
  resolved = {};
  openedExternally = [];
  revealed = [];
  openedInOs = [];
  openedInEditor = [];
  openedInPreview = [];
  failures = [];
  followed = [];
  followOutcomes = {};
  vi.stubGlobal('window', {
    throng: {
      // 045 round four (T258 / T291): a link's URI leaves by `throng:linkUri:openExternal` now, not
      // the general `throng:openExternal`; the recorder moved with the channel.
      linkUri: {
        openExternal: (uri: string) => {
          openedExternally.push(uri);
        },
      },
      links: {
        resolve: async (request: LinkResolutionRequest): Promise<LinkResolution> =>
          resolved[request.text] ?? { ok: false },
        reveal: async (request: LinkResolutionRequest): Promise<LinkActionOutcome> => {
          revealed.push(request);
          return { ok: true };
        },
        open: async (request: LinkResolutionRequest): Promise<LinkActionOutcome> => {
          openedInOs.push(request);
          return { ok: true };
        },
        follow: async (request: LinkResolutionRequest): Promise<LinkFollowOutcome> => {
          followed.push(request);
          return followOutcomes[request.text] ?? { kind: 'notFound', path: request.text };
        },
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/*
 * 045 T294 (data-model §16.18): a `file:` target is followed by ONE `throng:links:follow` — main
 * resolves it and performs the reveal itself — so these pin that request, and never openExternal.
 */
describe('a `file:` hyperlink (FR-011, FR-037, S1)', () => {
  it('a FOLDER is revealed by main through throng:links:follow — never through openExternal', async () => {
    const uri = 'file:///D:/elsewhere';
    followOutcomes[uri] = { kind: 'revealed' };

    await activateTerminalHyperlink({ event: CTRL, uri, site: SITE, deps: deps() });

    expect(followed).toEqual([
      {
        text: uri,
        kind: 'fileHyperlink',
        panelId: 'panel-1',
        originProjectId: 'project-1',
      },
    ]);
    expect(revealed, 'one request: main reveals it itself').toEqual([]);
    expect(openedExternally).toEqual([]);
    expect(failures).toEqual([]);
  });

  it('sends the REQUEST and never a resolved path, so main re-resolves it (I1/I2, FR-037)', async () => {
    const uri = 'file:///D:/elsewhere';
    followOutcomes[uri] = { kind: 'revealed' };

    await activateTerminalHyperlink({ event: CTRL, uri, site: SITE, deps: deps() });

    expect(JSON.stringify(followed[0])).not.toContain('D:\\\\elsewhere');
  });

  it('opens an in-project FILE in throng, still without touching openExternal', async () => {
    const uri = 'file:///D:/p/src/foo.ts';
    followOutcomes[uri] = { kind: 'openInThrong', link: IN_PROJECT_FILE };

    await activateTerminalHyperlink({ event: CTRL, uri, site: SITE, deps: deps() });

    expect(openedInEditor).toEqual([{ link: IN_PROJECT_FILE }]);
    expect(openedExternally).toEqual([]);
    expect(revealed).toEqual([]);
  });
});

describe('every other scheme (FR-013, 024 FR-019 unchanged)', () => {
  it('keeps http(s) on the system-browser route, byte for byte', async () => {
    for (const uri of ['http://example.com/a', 'https://example.com/b', 'HTTPS://example.com/c']) {
      await activateTerminalHyperlink({ event: CTRL, uri, site: SITE, deps: deps() });
    }
    expect(openedExternally).toEqual([
      'http://example.com/a',
      'https://example.com/b',
      'HTTPS://example.com/c',
    ]);
    expect(revealed).toEqual([]);
    expect(openedInOs).toEqual([]);
  });

  // *Round four (T289, S5 / FR-159):* `mailto:` was in this list. An ALLOWLISTED scheme is a link now,
  // so it moves to the block below, which pins it both ways; the rest stay inert.
  it('leaves javascript:, data: and unknown schemes completely inert', async () => {
    for (const uri of [
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      'ftp://example.com/a',
      'throng:whatever',
    ]) {
      await activateTerminalHyperlink({ event: CTRL, uri, site: SITE, deps: deps() });
    }
    expect(openedExternally).toEqual([]);
    expect(revealed).toEqual([]);
    expect(openedInOs).toEqual([]);
    expect(openedInEditor).toEqual([]);
    expect(openedInPreview).toEqual([]);
    expect(failures).toEqual([]);
  });
});

/**
 * 045 T289 (FR-159, FR-163, US13 scenario 7) — an OSC 8 `mailto:` target is judged by the one scheme
 * gate: allowlisted, a Ctrl+click reaches `throng:linkUri:openExternal`; not allowlisted, nothing.
 */
describe('T289 — an OSC 8 protocol target follows the allowlist', () => {
  it('mailto: allowlisted — Ctrl+click reaches throng:linkUri:openExternal, once', async () => {
    await activateTerminalHyperlink({
      event: CTRL,
      uri: 'mailto:someone@example.com',
      site: SITE,
      allowlist: new Set(['mailto']),
      deps: deps(),
    });
    expect(openedExternally).toEqual(['mailto:someone@example.com']);
    expect(revealed).toEqual([]);
    expect(openedInEditor).toEqual([]);
  });

  it('mailto: NOT allowlisted — Ctrl+click does nothing at all', async () => {
    await activateTerminalHyperlink({
      event: CTRL,
      uri: 'mailto:someone@example.com',
      site: SITE,
      allowlist: new Set(['tel']),
      deps: deps(),
    });
    expect(openedExternally).toEqual([]);
    expect(revealed).toEqual([]);
    expect(failures).toEqual([]);
  });

  it('a refused scheme stays inert even when allowlisted', async () => {
    await activateTerminalHyperlink({
      event: CTRL,
      uri: 'javascript:alert(1)',
      site: SITE,
      allowlist: new Set(['javascript']),
      deps: deps(),
    });
    expect(openedExternally).toEqual([]);
  });

  it('a plain click on it keeps its terminal meaning (024 FR-019c)', async () => {
    await activateTerminalHyperlink({
      event: { ctrlKey: false, metaKey: false },
      uri: 'mailto:someone@example.com',
      site: SITE,
      allowlist: new Set(['mailto']),
      deps: deps(),
    });
    expect(openedExternally).toEqual([]);
  });

  it('its hover is a URI link, so it is marked and worded like one', () => {
    expect(hoveredLinkFromUri('mailto:someone@example.com', SITE, new Set(['mailto']))).toEqual({
      kind: 'web',
      uri: 'mailto:someone@example.com',
    });
    expect(hoveredLinkFromUri('mailto:someone@example.com', SITE, new Set(['tel']))).toBeNull();
  });
});

/*
 * *Round four (T294; FR-160, FR-163 superseding FR-006 / FR-013 for `file:` targets):* this block
 * asserted that a `file:` target naming nothing offered nothing at all. A well-formed `file:` target is
 * a link whatever it points at; it is resolved when followed, and an in-project one with nothing behind
 * it raises exactly ONE notice naming the path, and opens nothing.
 */
describe('a `file:` hyperlink with nothing behind it (FR-160, FR-163)', () => {
  it('is followed once, and main’s notFound raises exactly one notice — no OS route, no editor', async () => {
    const uri = 'file:///D:/p/gone.ts';
    followOutcomes[uri] = { kind: 'notFound', path: 'D:\\p\\gone.ts' };

    await activateTerminalHyperlink({ event: CTRL, uri, site: SITE, deps: deps() });

    expect(followed.map((r) => r.text)).toEqual([uri]);
    expect(failures).toEqual([{ ok: false, reason: 'notFound', path: 'D:\\p\\gone.ts' }]);
    expect(revealed).toEqual([]);
    expect(openedInOs).toEqual([]);
    expect(openedInEditor).toEqual([]);
    expect(openedExternally).toEqual([]);
  });
});

describe('the gesture itself (FR-040, 024 FR-019c)', () => {
  it('does nothing at all without Ctrl or Cmd — a plain click keeps its terminal meaning', async () => {
    const uri = 'file:///D:/elsewhere';
    followOutcomes[uri] = { kind: 'revealed' };

    await activateTerminalHyperlink({
      event: { ctrlKey: false, metaKey: false },
      uri,
      site: SITE,
      deps: deps(),
    });
    await activateTerminalHyperlink({
      event: { ctrlKey: false, metaKey: false },
      uri: 'https://example.com',
      site: SITE,
      deps: deps(),
    });

    expect(revealed).toEqual([]);
    expect(followed).toEqual([]);
    expect(openedExternally).toEqual([]);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T212 — FR-154: a hyperlink that goes nowhere looks like text (link-resolution.md §8.4 V1 – V4)
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * What the user sees today (O11 rows 5, 13 – 15): an OSC 8 hyperlink to a missing file, a missing
 * host or `notascheme:foo` is underlined and shows a hand pointer, and does nothing. The DRAWING half
 * of that (xterm's own OSC 8 underline) only a real renderer shows — T213. What this file pins is the
 * judgement the drawing must follow: a dead target is no hovered link at all, so a Ctrl+click on it
 * reaches a mouse-reporting program (FR-043's pass-through) and nothing raises a notice.
 */
describe('T212 / FR-154 — a dead OSC 8 target is no link: not hovered, not swallowed, no notice', () => {
  // *Round four (T294, FR-163):* the two `file:` rows — a target that does not exist, and one whose
  // host does not answer — left this list. A well-formed `file:` target is a link whatever it points
  // at; the block after this one pins what following them does.
  const DEAD: readonly (readonly [string, string])[] = [
    ['a scheme throng does not follow', 'notascheme:foo'],
    ['an empty target', ''],
  ];

  for (const [label, uri] of DEAD) {
    it(`${label} (${JSON.stringify(uri)}): no hovered link, the press reaches the program, and no notice`, async () => {
      const hovered = hoveredLinkFromUri(uri, SITE);
      expect(hovered, 'V1/V2: nothing to hover, so nothing to draw a tooltip for').toBeNull();
      expect(
        keepsClickFromProgram({ hovered, button: 0, ctrlKey: true, metaKey: false, mouseTrackingMode: 'vt200' }),
        'FR-043: a Ctrl+click on text that is not a link is the program\u2019s',
      ).toBe(false);

      await activateTerminalHyperlink({ event: CTRL, uri, site: SITE, deps: deps() });
      expect(failures, 'nothing was attempted, so there is no condition to report').toEqual([]);
      expect(openedExternally).toEqual([]);
      expect(revealed).toEqual([]);
      expect(openedInOs).toEqual([]);
      expect(openedInEditor).toEqual([]);
    });
  }

  // *Round four (T286, FR-163):* V3 said a `file:` target was a hovered link only ONCE it had
  // resolved. It is judged by its class alone now: a link at once, with nothing asked, and a Ctrl+press
  // on it is throng's (#198's guard sees it hovered).
  it('V3 (FR-163): a file: target is a hovered link at once — nothing asked, and the press is throng’s', () => {
    const uri = 'file:///D:/p/src/foo.ts';
    const hovered = hoveredLinkFromUri(uri, SITE);
    expect(hovered?.kind).toBe('file');
    expect(
      keepsClickFromProgram({ hovered, button: 0, ctrlKey: true, metaKey: false, mouseTrackingMode: 'vt200' }),
    ).toBe(true);
  });

  it('V4: an https target is a hovered link as drawn — no existence check', () => {
    const hovered = hoveredLinkFromUri('https://example.com/a', SITE);
    expect(hovered).toEqual({ kind: 'web', uri: 'https://example.com/a' });
  });
});

/**
 * 045 T294 (FR-160, FR-163): an OSC 8 `file:` target that names nothing is followed like any other —
 * ONE `throng:links:follow` — and main decides: in the project, one notice; outside it (an unknown
 * host), OS Explorer on its parent and no notice. Nothing is asked before the click.
 */
describe('T294 / FR-163 — an unfollowable `file:` target is still followed, and main decides', () => {
  it('a file: target that does not exist: one follow, and main’s notFound raises one notice', async () => {
    const uri = 'file:///C:/does/not/exist.txt';
    followOutcomes[uri] = { kind: 'notFound', path: 'C:\\does\\not\\exist.txt' };
    await activateTerminalHyperlink({ event: CTRL, uri, site: SITE, deps: deps() });
    expect(followed.map((r) => r.text)).toEqual([uri]);
    expect(failures).toHaveLength(1);
    expect(openedInEditor).toEqual([]);
  });

  it('a file: target whose host does not answer: one follow, revealed on its parent, no notice', async () => {
    const uri = 'file://nonexistent-host-xyz/share/file.txt';
    followOutcomes[uri] = { kind: 'revealed' };
    await activateTerminalHyperlink({ event: CTRL, uri, site: SITE, deps: deps() });
    expect(followed.map((r) => r.text)).toEqual([uri]);
    expect(failures).toEqual([]);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A Ctrl+click on a link the terminal is SHOWING is followed on the FIRST click — D3's cause, gone.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * What the user saw: the link marked, hovered, the hand up with Ctrl held — and the click did nothing,
 * because the cached answer behind it had outlived its lifetime and the click re-asked main (4 of 510
 * fresh-measured Ctrl+clicks). Round four has no cached answer to outlive (FR-155, R32): every follow
 * is ONE `throng:links:follow` (T294, data-model §16.18), whatever was or was not answered before.
 * These were the three follow routes' D3 cases; they now pin that each sends the one request.
 */
describe('a terminal link is followed on the FIRST Ctrl+click, with nothing answered before it (T294)', () => {
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };

  it('a Ctrl+click on a DETECTED path the provider served sends one follow', async () => {
    const text = 'C:\\Windows\\win.ini';
    followOutcomes[text] = { kind: 'revealed' };
    const row = `26. ${text}`;
    const provider = createFileLinkProvider({
      terminal: {
        buffer: {
          active: {
            getLine: (index: number) =>
              index === 0 ? { translateToString: () => row, isWrapped: false } : undefined,
          },
        },
      },
      detect: () => true,
      site: () => SITE,
      ask: () => ({ ok: true, link: { path: text, kind: 'file', inProject: false, executable: false, preview: 'none' } }),
      onHover: () => {},
      // What use-terminal.ts wires: the provider's follow goes straight to followTerminalLink.
      follow: (args: { request: LinkResolutionRequest; position?: LinkPosition }) =>
        void followTerminalLink({ ...args, deps: deps() }),
    } as unknown as Parameters<typeof createFileLinkProvider>[0]);

    let served: ProvidedLink[] | undefined;
    provider.provideLinks(1, (links) => {
      served = links;
    });
    await settle();
    expect(served?.map((l) => l.text)).toEqual([text]);

    served![0]!.activate({ ctrlKey: true, metaKey: false } as MouseEvent, text);
    await settle();

    expect(followed.map((r) => r.text), 'the link the user can see is followed on the FIRST click').toEqual([text]);
    expect(followed[0]?.kind, 'main is sent the REQUEST, and resolves it (FR-037)').toBe('detectedPath');
    expect(revealed, 'main reveals it itself — no second round trip').toEqual([]);
  });

  it('a Ctrl+click on an OSC 8 `file:` hyperlink sends one follow', async () => {
    const uri = 'file:///D:/elsewhere';
    followOutcomes[uri] = { kind: 'revealed' };
    await activateTerminalHyperlink({ event: CTRL, uri, site: SITE, deps: deps() });
    await settle();
    expect(followed.map((r) => r.text)).toEqual([uri]);
  });

  it("the context menu's Open Link on the hovered link sends one follow", async () => {
    const text = 'C:\\Windows\\win.ini';
    followOutcomes[text] = { kind: 'revealed' };
    const request = terminalLinkRequest({ text, kind: 'detectedPath', site: SITE });
    await followTerminalLink({ request, deps: deps() });
    await settle();
    expect(followed.map((r) => r.text)).toEqual([text]);
  });
});

/**
 * 045 FR-165 (round four, T271) — the PURE gate behind the plain-click link hint. What use-terminal.ts
 * wires around this (the actual mousedown/mouseup pair, the drag check, and never calling
 * preventDefault) is exercised by the E2E declaration (T280); this is the decision alone.
 */
describe('plainClickShowsHint (FR-165, FR-165e, FR-165f)', () => {
  const HOVERED: HoveredLink = { kind: 'web', uri: 'https://example.com/' };
  const PLAIN = { ctrlKey: false, metaKey: false };
  const CTRL_HELD = { ctrlKey: true, metaKey: false };
  const META_HELD = { ctrlKey: false, metaKey: true };

  it('shows on a plain click over a hovered link', () => {
    expect(plainClickShowsHint(PLAIN, HOVERED)).toBe(true);
  });

  it('never on Ctrl+click or Cmd+click (FR-165e)', () => {
    expect(plainClickShowsHint(CTRL_HELD, HOVERED)).toBe(false);
    expect(plainClickShowsHint(META_HELD, HOVERED)).toBe(false);
  });

  it('never where nothing is hovered — including where that kind is disabled, which the hover pipeline already leaves null for (FR-165f)', () => {
    expect(plainClickShowsHint(PLAIN, null)).toBe(false);
  });
});
