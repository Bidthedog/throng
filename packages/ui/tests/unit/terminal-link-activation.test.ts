import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LinkActionOutcome,
  LinkPosition,
  LinkResolution,
  LinkResolutionRequest,
  ResolvedLink,
} from '@throng/core';
import { __resetLinkCacheForTests } from '../../src/renderer/links/link-cache.js';
import { keepsClickFromProgram } from '../../src/renderer/terminal/hovered-link.js';
import {
  activateTerminalHyperlink,
  askTerminalLink,
  hoveredLinkFromUri,
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

const OUT_OF_PROJECT_FOLDER: ResolvedLink = {
  path: 'D:\\elsewhere',
  kind: 'folder',
  inProject: false,
  executable: false,
  preview: 'none',
};

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
let failures: Array<Extract<LinkActionOutcome, { ok: false }>>;

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

/** Hover, then let the answer land — exactly the order a user's pointer produces. */
async function hover(uri: string): Promise<void> {
  askTerminalLink(terminalLinkRequest({ text: uri, kind: 'fileHyperlink', site: SITE }));
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  resolved = {};
  openedExternally = [];
  revealed = [];
  openedInOs = [];
  openedInEditor = [];
  openedInPreview = [];
  failures = [];
  vi.stubGlobal('window', {
    throng: {
      openExternal: (uri: string) => {
        openedExternally.push(uri);
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
      },
    },
  });
  __resetLinkCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a `file:` hyperlink that resolves (FR-011, FR-037, S1)', () => {
  it('reveals a FOLDER in the OS file manager through throng:links:reveal — never through openExternal', async () => {
    const uri = 'file:///D:/elsewhere';
    resolved[uri] = { ok: true, link: OUT_OF_PROJECT_FOLDER };
    await hover(uri);

    await activateTerminalHyperlink({ event: CTRL, uri, site: SITE, deps: deps() });

    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toEqual({
      text: uri,
      kind: 'fileHyperlink',
      panelId: 'panel-1',
      originProjectId: 'project-1',
    });
    expect(openedExternally).toEqual([]);
    expect(failures).toEqual([]);
  });

  it('sends the REQUEST and never a resolved path, so main re-resolves it (I1/I2, FR-037)', async () => {
    const uri = 'file:///D:/elsewhere';
    resolved[uri] = { ok: true, link: OUT_OF_PROJECT_FOLDER };
    await hover(uri);

    await activateTerminalHyperlink({ event: CTRL, uri, site: SITE, deps: deps() });

    expect(JSON.stringify(revealed[0])).not.toContain('D:\\\\elsewhere');
  });

  it('opens an in-project FILE in throng, still without touching openExternal', async () => {
    const uri = 'file:///D:/p/src/foo.ts';
    resolved[uri] = { ok: true, link: IN_PROJECT_FILE };
    await hover(uri);

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

  it('leaves javascript:, data:, mailto: and unknown schemes completely inert', async () => {
    for (const uri of [
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      'mailto:someone@example.com',
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

describe('a `file:` hyperlink that does NOT resolve (FR-006, FR-013)', () => {
  it('offers nothing at all — no OS route, no editor, and no notice', async () => {
    const uri = 'file:///D:/p/gone.ts';
    await hover(uri);

    await activateTerminalHyperlink({ event: CTRL, uri, site: SITE, deps: deps() });

    expect(revealed).toEqual([]);
    expect(openedInOs).toEqual([]);
    expect(openedInEditor).toEqual([]);
    expect(openedExternally).toEqual([]);
    expect(failures).toEqual([]);
  });
});

describe('the gesture itself (FR-040, 024 FR-019c)', () => {
  it('does nothing at all without Ctrl or Cmd — a plain click keeps its terminal meaning', async () => {
    const uri = 'file:///D:/elsewhere';
    resolved[uri] = { ok: true, link: OUT_OF_PROJECT_FOLDER };
    await hover(uri);

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
  const DEAD: readonly (readonly [string, string, LinkResolution | undefined])[] = [
    ['a scheme throng does not follow', 'notascheme:foo', undefined],
    ['an empty target', '', undefined],
    ['a file: target that does not exist', 'file:///C:/does/not/exist.txt', { ok: false }],
    ['a file: target whose host does not answer', 'file://nonexistent-host-xyz/share/file.txt', { ok: false, reason: 'unreachable' }],
  ];

  for (const [label, uri, answer] of DEAD) {
    it(`${label} (${JSON.stringify(uri)}): no hovered link, the press reaches the program, and no notice`, async () => {
      if (answer !== undefined) resolved[uri] = answer;
      await hover(uri);

      const hovered = hoveredLinkFromUri(uri, SITE, askTerminalLink);
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

  it('V3: a file: target is a hovered link only ONCE it has resolved — not before', async () => {
    const uri = 'file:///D:/p/src/foo.ts';
    // The hover lands before main has answered.
    resolved[uri] = { ok: true, link: IN_PROJECT_FILE };
    expect(hoveredLinkFromUri(uri, SITE, askTerminalLink), 'unresolved is not yet a link').toBeNull();
    // …and then main's answer lands.
    await Promise.resolve();
    await Promise.resolve();
    const hovered = hoveredLinkFromUri(uri, SITE, askTerminalLink);
    expect(hovered?.kind).toBe('file');
    expect(
      keepsClickFromProgram({ hovered, button: 0, ctrlKey: true, metaKey: false, mouseTrackingMode: 'vt200' }),
    ).toBe(true);
  });

  it('V4: an https target is a hovered link as drawn — no existence check', () => {
    const hovered = hoveredLinkFromUri('https://example.com/a', SITE, askTerminalLink);
    expect(hovered).toEqual({ kind: 'web', uri: 'https://example.com/a' });
  });
});
