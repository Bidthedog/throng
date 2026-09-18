import { describe, expect, it } from 'vitest';
import type { LinkResolution, LinkResolutionRequest, ResolvedLink } from '@throng/core';
import {
  hoveredLinkMenuText,
  hoveredLinkTipText,
  keepsClickFromProgram,
  type HoveredLink,
} from '../../src/renderer/terminal/hovered-link.js';
import {
  hoveredLinkFromUri,
  type TerminalLinkSite,
} from '../../src/renderer/terminal/terminal-link-activation.js';

/**
 * 045 T064 (FR-042, FR-043; `data-model.md` §8) — the FOUR readers of `hoveredLink`, under a
 * `{ kind: 'file' }` value.
 *
 * ══ WHY ALL FOUR ARE ASSERTED IN ONE FILE ══
 *
 * `hoveredLink` used to be a `string | null` holding an http(s) url, and four places read it. The
 * type change is what makes a detected path or a `file:` hyperlink a link at ALL, and
 * `data-model.md` §8 requires it to land in one commit with every reader — because a reader left
 * behind is #198 reopened: one site knows a link is under the pointer and another does not, so the
 * Ctrl+press is both followed by throng AND forwarded to the program, and the user gets two of
 * whatever they asked for.
 *
 * The readers, and what each is asserted on below:
 *
 *  1. `keepLinkClickFromProgram` — fires for a file link exactly as it does for a web link;
 *  2. the hover tooltip — worded by kind, and naming the gesture either way (FR-042, T003);
 *  3. `setHovered`'s old `^https?://` filter — replaced by `classifyTerminalLinkTarget` (R5);
 *  4. `getHoveredLink()` — hands back the RESOLVED link, not a url string, so the menu can compose
 *     from it.
 */

const IN_PROJECT: ResolvedLink = {
  path: 'D:\\p\\src\\foo.ts',
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
};

const SITE: TerminalLinkSite = {
  panelId: 'panel-1',
  originProjectId: 'project-1',
  baseDirectory: 'D:\\p\\src',
};

const WEB: HoveredLink = { kind: 'web', uri: 'https://example.com/a' };

const FILE: HoveredLink = {
  kind: 'file',
  link: IN_PROJECT,
  request: { text: 'src/foo.ts', kind: 'detectedPath', panelId: 'panel-1' },
};

/** A stand-in for the cache lookup `setHovered` performs — sync, and `undefined` means "not a link". */
const answering =
  (resolution: LinkResolution | undefined) =>
  (_request: LinkResolutionRequest): LinkResolution | undefined =>
    resolution;

describe('reader 1 — keepLinkClickFromProgram (FR-043, #198 extended to file links)', () => {
  it('holds a Ctrl+press back from a mouse-reporting program for a FILE link, as it does for a web link', () => {
    const press = { button: 0, ctrlKey: true, metaKey: false, mouseTrackingMode: 'any' };
    expect(keepsClickFromProgram({ hovered: WEB, ...press })).toBe(true);
    expect(keepsClickFromProgram({ hovered: FILE, ...press })).toBe(true);
  });

  it('lets a Ctrl+press through when there is no link under the pointer — the program keeps its own links', () => {
    expect(
      keepsClickFromProgram({
        hovered: null,
        button: 0,
        ctrlKey: true,
        metaKey: false,
        mouseTrackingMode: 'any',
      }),
    ).toBe(false);
  });

  it('never touches a plain click, a right-click, or a terminal with mouse reporting off', () => {
    expect(
      keepsClickFromProgram({
        hovered: FILE,
        button: 0,
        ctrlKey: false,
        metaKey: false,
        mouseTrackingMode: 'any',
      }),
    ).toBe(false);
    expect(
      keepsClickFromProgram({
        hovered: FILE,
        button: 2,
        ctrlKey: true,
        metaKey: false,
        mouseTrackingMode: 'any',
      }),
    ).toBe(false);
    expect(
      keepsClickFromProgram({
        hovered: FILE,
        button: 0,
        ctrlKey: true,
        metaKey: false,
        mouseTrackingMode: 'none',
      }),
    ).toBe(false);
  });

  it('accepts Cmd for macOS, as every other link gesture does (FR-040)', () => {
    expect(
      keepsClickFromProgram({
        hovered: FILE,
        button: 0,
        ctrlKey: false,
        metaKey: true,
        mouseTrackingMode: 'any',
      }),
    ).toBe(true);
  });
});

/** A file link outside the project, and a folder — both of which the click rule shows in OS Explorer. */
const OUT_OF_PROJECT: HoveredLink = {
  kind: 'file',
  link: { ...IN_PROJECT, path: 'D:\\elsewhere\\notes.txt', inProject: false },
  request: { text: 'D:\\elsewhere\\notes.txt', kind: 'detectedPath', panelId: 'panel-1' },
};

const FOLDER: HoveredLink = {
  kind: 'file',
  link: { ...IN_PROJECT, path: 'D:\\p\\src', kind: 'folder' },
  request: { text: 'src', kind: 'detectedPath', panelId: 'panel-1' },
};

describe('reader 2 — the hover tooltip is worded by kind (FR-042, T003 amendment)', () => {
  it('keeps the shipped web wording byte for byte', () => {
    expect(hoveredLinkTipText(WEB, 'Ctrl')).toBe('Ctrl+Click to open in system browser');
  });

  it('does not promise a browser for a file link', () => {
    expect(hoveredLinkTipText(FILE, 'Ctrl')).toBe('Ctrl+Click to open');
    expect(hoveredLinkTipText(FILE, 'Ctrl')).not.toContain('browser');
  });

  it('names the gesture in both — the shape FR-042 actually requires — including the macOS chord', () => {
    for (const hovered of [WEB, FILE]) {
      expect(hoveredLinkTipText(hovered, 'Ctrl').startsWith('Ctrl+Click')).toBe(true);
      expect(hoveredLinkTipText(hovered, 'Cmd').startsWith('Cmd+Click')).toBe(true);
    }
  });
});

/*
 * 045 FR-105 (T159, amended 2026-09-18 as the supersessions permit): the file wording now follows
 * the CLICK RULE (FR-110) rather than stopping at "to open", because with the default link action
 * retired the destination is knowable. The web wording above is unchanged byte for byte.
 */
describe('reader 2, amended — a file link’s tooltip says where the click goes (FR-105)', () => {
  it('an out-of-project file says it shows in OS Explorer', () => {
    expect(hoveredLinkTipText(OUT_OF_PROJECT, 'Ctrl')).toBe('Ctrl+Click to show in OS Explorer');
  });

  it('a folder says it shows in OS Explorer', () => {
    expect(hoveredLinkTipText(FOLDER, 'Ctrl')).toBe('Ctrl+Click to show in OS Explorer');
  });

  it('an in-project file still says it opens, and macOS still says Cmd', () => {
    expect(hoveredLinkTipText(FILE, 'Ctrl')).toBe('Ctrl+Click to open');
    expect(hoveredLinkTipText(OUT_OF_PROJECT, 'Cmd')).toBe('Cmd+Click to show in OS Explorer');
  });
});

describe('reader 3 — setHovered classifies instead of matching ^https?:// (R5, FR-011 – FR-013)', () => {
  it('still answers web for http and https, whatever the case', () => {
    expect(hoveredLinkFromUri('http://example.com', SITE, answering(undefined))).toEqual({
      kind: 'web',
      uri: 'http://example.com',
    });
    expect(hoveredLinkFromUri('HTTPS://EXAMPLE.COM', SITE, answering(undefined))).toEqual({
      kind: 'web',
      uri: 'HTTPS://EXAMPLE.COM',
    });
  });

  it('answers a file link for a `file:` target that has resolved, carrying the request that resolved it', () => {
    const hovered = hoveredLinkFromUri(
      'file:///D:/p/src/foo.ts',
      SITE,
      answering({ ok: true, link: IN_PROJECT }),
    );
    expect(hovered).toEqual({
      kind: 'file',
      link: IN_PROJECT,
      request: {
        text: 'file:///D:/p/src/foo.ts',
        kind: 'fileHyperlink',
        panelId: 'panel-1',
        originProjectId: 'project-1',
        baseDirectory: 'D:\\p\\src',
      },
    });
  });

  it('answers nothing for a `file:` target that resolves to nothing (FR-013), or has not answered yet (FR-071)', () => {
    expect(hoveredLinkFromUri('file:///D:/p/gone.ts', SITE, answering({ ok: false }))).toBeNull();
    expect(hoveredLinkFromUri('file:///D:/p/gone.ts', SITE, answering(undefined))).toBeNull();
  });

  it('answers nothing for every other scheme, and for no uri at all', () => {
    for (const uri of [
      'javascript:alert(1)',
      'data:text/plain,x',
      'mailto:someone@example.com',
      'ftp://example.com/a',
      'not-a-uri',
    ]) {
      expect(hoveredLinkFromUri(uri, SITE, answering({ ok: true, link: IN_PROJECT }))).toBeNull();
    }
    expect(hoveredLinkFromUri(undefined, SITE, answering(undefined))).toBeNull();
  });
});

describe('reader 4 — getHoveredLink hands back the resolved link, not a url string', () => {
  it('carries the resolved target, so a caller can read its path, kind and membership', () => {
    expect(FILE.link.path).toBe('D:\\p\\src\\foo.ts');
    expect(FILE.link.inProject).toBe(true);
    expect(FILE.link.kind).toBe('file');
  });

  it('still offers 024 the string its menu builder classifies — the uri for a web link', () => {
    expect(hoveredLinkMenuText(WEB)).toBe('https://example.com/a');
    expect(hoveredLinkMenuText(null)).toBeNull();
  });

  it('offers a `file:` hyperlink its own target, which 024 classifies as a file link', () => {
    const hovered = hoveredLinkFromUri(
      'file:///D:/p/src/foo.ts',
      SITE,
      answering({ ok: true, link: IN_PROJECT }),
    );
    expect(hoveredLinkMenuText(hovered)).toBe('file:///D:/p/src/foo.ts');
  });
});
