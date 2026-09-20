import { describe, expect, it } from 'vitest';
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
 *  3. `setHovered`'s old `^https?://` filter — replaced by the one scheme gate, `resourceClass` (R5);
 *  4. `getHoveredLink()` — hands back the RESOLVED link, not a url string, so the menu can compose
 *     from it.
 */

const SITE: TerminalLinkSite = {
  panelId: 'panel-1',
  originProjectId: 'project-1',
  baseDirectory: 'D:\\p\\src',
};

const WEB: HoveredLink = { kind: 'web', uri: 'https://example.com/a' };

/** 045 T294 (data-model §16.17): a hovered file link carries the grammar's request, never an answer. */
const FILE: HoveredLink = {
  kind: 'file',
  request: { text: 'src/foo.ts', kind: 'detectedPath', panelId: 'panel-1' },
};
/** The owning project's root, which the tooltip words a link against by name (FR-155). */
const ROOT = 'D:\\p';

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

/**
 * A file link outside the project, and a folder — both of which the click rule shows in OS Explorer.
 * 045 T294: judged by NAME now (FR-155) — the folder is one by grammar (a trailing separator, FR-158d),
 * and "outside" is the absolute text against the root.
 */
const OUT_OF_PROJECT: HoveredLink = {
  kind: 'file',
  request: { text: 'D:\\elsewhere\\notes.txt', kind: 'detectedPath', panelId: 'panel-1' },
};

const FOLDER: HoveredLink = {
  kind: 'file',
  request: { text: 'src\\', kind: 'detectedPath', panelId: 'panel-1' },
};

describe('reader 2 — the hover tooltip is worded by destination (FR-042, FR-168)', () => {
  it('keeps the shipped web wording byte for byte', () => {
    expect(hoveredLinkTipText(WEB, 'Ctrl')).toBe('Ctrl+Click to open in system browser');
  });

  it('does not promise a browser for a file link, and names which editor by default (lastActive)', () => {
    expect(hoveredLinkTipText(FILE, 'Ctrl')).toBe('Ctrl+Click to open in throng active editor');
    expect(hoveredLinkTipText(FILE, 'Ctrl')).not.toContain('browser');
  });

  it('names the editor the open-target preference chooses', () => {
    expect(hoveredLinkTipText(FILE, 'Ctrl', null, { openTarget: 'new' })).toBe(
      'Ctrl+Click to open in throng new editor',
    );
  });

  it('names the gesture in both — the shape FR-042 actually requires — including the macOS chord', () => {
    for (const hovered of [WEB, FILE]) {
      expect(hoveredLinkTipText(hovered, 'Ctrl').startsWith('Ctrl+Click')).toBe(true);
      expect(hoveredLinkTipText(hovered, 'Cmd').startsWith('Cmd+Click')).toBe(true);
    }
  });
});

/*
 * 045 FR-168 (T159, amended 2026-09-18 and again in round four): the file wording follows the CLICK
 * RULE (FR-110) rather than stopping at "to open", because with the default link action retired the
 * destination is knowable, refined further to say which editor (023's open-target preference). The
 * web wording above is unchanged byte for byte.
 */
describe('reader 2, amended — a file link’s tooltip says where the click goes (FR-168)', () => {
  it('an out-of-project file says it shows in OS Explorer', () => {
    expect(hoveredLinkTipText(OUT_OF_PROJECT, 'Ctrl', ROOT)).toBe('Ctrl+Click to show in OS Explorer');
  });

  it('a folder says it shows in OS Explorer', () => {
    expect(hoveredLinkTipText(FOLDER, 'Ctrl', ROOT)).toBe('Ctrl+Click to show in OS Explorer');
  });

  it('an in-project file still names an editor, and macOS still says Cmd', () => {
    expect(hoveredLinkTipText(FILE, 'Ctrl', ROOT)).toBe('Ctrl+Click to open in throng active editor');
    expect(hoveredLinkTipText(OUT_OF_PROJECT, 'Cmd', ROOT)).toBe('Cmd+Click to show in OS Explorer');
  });
});

/*
 * *Round four (T285; FR-159, FR-163):* reader 3 judged a `file:` target by main's answer — a link once
 * it had resolved, nothing while it was unanswered or answered "not found". FR-163 judges an OSC 8
 * target by its resource class ALONE: `hoveredLinkFromUri(uri, site, allowlist?)` takes no `ask`, a
 * well-formed `file:` target is a file link whatever it points at, and nothing is asked to hover it.
 */
describe('reader 3 — the OSC 8 hover judges the target by its class alone (FR-159, FR-163)', () => {
  it('still answers web for http and https, whatever the case', () => {
    expect(hoveredLinkFromUri('http://example.com', SITE)).toEqual({ kind: 'web', uri: 'http://example.com' });
    expect(hoveredLinkFromUri('HTTPS://EXAMPLE.COM', SITE)).toEqual({ kind: 'web', uri: 'HTTPS://EXAMPLE.COM' });
  });

  it('answers a file link for ANY well-formed `file:` target, carrying the request main will be asked', () => {
    for (const uri of ['file:///D:/p/src/foo.ts', 'file:///D:/p/gone.ts', 'file://nonexistent-host-xyz/share/file.txt']) {
      expect(hoveredLinkFromUri(uri, SITE), uri).toEqual({
        kind: 'file',
        request: {
          text: uri,
          kind: 'fileHyperlink',
          panelId: 'panel-1',
          originProjectId: 'project-1',
          baseDirectory: 'D:\\p\\src',
        },
      });
    }
  });

  it('an allowlisted mailto: is a URI link; with an allowlist that lacks it, nothing', () => {
    expect(hoveredLinkFromUri('mailto:someone@example.com', SITE, new Set(['mailto']))).toEqual({
      kind: 'web',
      uri: 'mailto:someone@example.com',
    });
    expect(hoveredLinkFromUri('mailto:someone@example.com', SITE, new Set())).toBeNull();
  });

  it('answers nothing for a refused, unknown or empty target, for a crafted one, and for no uri at all', () => {
    for (const uri of [
      'javascript:alert(1)',
      'data:text/plain,x',
      'ftp://example.com/a',
      'not-a-uri',
      '',
      'file:///C:/x.txt%00.exe',
      `file:///C:/x${String.fromCharCode(0x07)}.txt`,
    ]) {
      expect(hoveredLinkFromUri(uri, SITE, new Set(['javascript', 'data'])), JSON.stringify(uri)).toBeNull();
    }
    expect(hoveredLinkFromUri(undefined, SITE)).toBeNull();
  });

  it('a hovered file: target is worded like any file link — the tooltip needs no answer', () => {
    const hovered = hoveredLinkFromUri('file:///C:/elsewhere/gone.txt', SITE);
    expect(hovered).not.toBeNull();
    expect(hoveredLinkTipText(hovered!, 'Ctrl', ROOT)).toBe('Ctrl+Click to show in OS Explorer');
  });

  it('a relative path whose working directory lies outside the project says the same (FR-168a)', () => {
    const relative: HoveredLink = {
      kind: 'file',
      request: {
        text: 'notes.txt',
        kind: 'detectedPath',
        panelId: 'panel-1',
        baseDirectory: 'D:\\elsewhere',
      },
    };
    expect(hoveredLinkTipText(relative, 'Ctrl', ROOT)).toBe('Ctrl+Click to show in OS Explorer');
  });
});

describe('reader 4 — getHoveredLink hands back the link record, not a url string', () => {
  it('carries the request main will be asked at a follow or a menu opening — and no resolved answer (§16.17)', () => {
    expect(FILE.kind === 'file' && FILE.request.text).toBe('src/foo.ts');
    expect(FILE).not.toHaveProperty('link');
  });

  it('still offers 024 the string its menu builder classifies — the uri for a web link', () => {
    expect(hoveredLinkMenuText(WEB)).toBe('https://example.com/a');
    expect(hoveredLinkMenuText(null)).toBeNull();
  });

  it('offers a `file:` hyperlink its own target, which 024 classifies as a file link', () => {
    const hovered = hoveredLinkFromUri('file:///D:/p/src/foo.ts', SITE);
    expect(hoveredLinkMenuText(hovered)).toBe('file:///D:/p/src/foo.ts');
  });
});
