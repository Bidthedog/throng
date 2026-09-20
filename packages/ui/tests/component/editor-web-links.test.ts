import { waitFor } from '@testing-library/react';
import { EditorSelection } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkResolution, LinkResolutionRequest } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { followLinkInPanel } from '../../src/renderer/editor/link-decorations.js';

/**
 * 045 T165 — web links in an EDITOR (FR-101, FR-103, SC-012; contracts/menus-and-gestures.md §7.3,
 * G11 – G14, with G4 and G9 re-checked now that web links are present).
 *
 * What the user sees today (O11's probe): a plain-text `https://…` URL is a link in every terminal
 * flavour and NOT a link in an editor — Ctrl+click on it adds a cursor, the chord inserts a blank
 * line, and nothing opens. The editor has no URL scan at all (contract §6.1).
 *
 * ══ THE HARNESS ══
 *
 * A REAL `EditorView` behind `mount-editor.ts`, so the gesture reaches the `mousedown`/`mouseup`
 * handlers `use-editor.ts` actually installs, and the chord reaches the panel's own registered link
 * deps (`followLinkInPanel`, which is what the window's Ctrl+Enter handler in `app.tsx` calls). jsdom
 * cannot measure text, so `posAtCoords` on the live view is replaced with the offset under test —
 * the decision is what the handlers do WITH a position, and the measurement is CodeMirror's.
 */

const URL_TEXT = 'https://example.com/x';
const DOC = [
  `see ${URL_TEXT} here`,
  'javascript:alert(1) and mailto:someone@example.com',
  'plain words only',
  '',
].join('\n');
const IN_URL = DOC.indexOf(URL_TEXT) + 4;
const JS_AT = DOC.indexOf('javascript:') + 3;
const MAILTO_AT = DOC.indexOf('mailto:') + 3;
const PLAIN_AT = DOC.indexOf('plain words') + 2;

let harness: EditorHarness | undefined;

afterEach(() => {
  harness?.unmount();
  harness = undefined;
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

interface Mounted {
  readonly h: EditorHarness;
  /**
   * `window.throng.linkUri.openExternal` — 045 T291: web and allowlisted protocol links leave by
   * `throng:linkUri:openExternal` (plan round four, twelfth pass), not the general channel.
   */
  readonly openExternal: ReturnType<typeof vi.fn>;
  /** `window.throng.openExternal` — the GENERAL channel (About); a link must never use it now. */
  readonly generalOpenExternal: ReturnType<typeof vi.fn>;
  readonly resolved: LinkResolutionRequest[];
  /** Point the live view's `posAtCoords` at an offset — jsdom measures nothing. */
  pointAt(offset: number): void;
  mouse(type: 'mousedown' | 'mouseup', over?: MouseEventInit): MouseEvent;
}

async function mount(settings: Record<string, unknown> = {}): Promise<Mounted> {
  const openExternal = vi.fn();
  const generalOpenExternal = vi.fn();
  const resolved: LinkResolutionRequest[] = [];
  const h = mountEditor({
    doc: { text: DOC, version: 1, absPath: 'C:/proj/notes.txt' },
    projectRoot: 'C:/proj',
    registerProject: true,
    settings,
    throng: {
      openExternal: generalOpenExternal,
      linkUri: { openExternal, refusedSchemes: async () => [] },
      links: {
        resolve: async (request: LinkResolutionRequest): Promise<LinkResolution> => {
          resolved.push(request);
          return { ok: false };
        },
        reveal: async () => ({ ok: true as const }),
        open: async () => ({ ok: true as const }),
      },
    },
  });
  harness = h;
  await waitFor(() => expect(h.view().state.doc.toString()).toBe(DOC));
  await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  let at = 0;
  const view = h.view() as unknown as { posAtCoords: (c: { x: number; y: number }) => number | null };
  view.posAtCoords = () => at;
  return {
    h,
    openExternal,
    generalOpenExternal,
    resolved,
    pointAt: (offset) => {
      at = offset;
    },
    mouse: (type, over = {}) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 10,
        clientY: 10,
        ...over,
      });
      h.content().dispatchEvent(event);
      return event;
    },
  };
}

describe('G11 — Ctrl+click over a web link opens it ONCE in the system browser (FR-103)', () => {
  // *Round four (T291):* the channel moved — `window.throng.openExternal` → `linkUri.openExternal`.
  it('through window.throng.linkUri.openExternal, with the address as written', async () => {
    const m = await mount();
    m.pointAt(IN_URL);
    m.mouse('mousedown', { ctrlKey: true });
    m.mouse('mouseup', { ctrlKey: true });

    await waitFor(() => expect(m.openExternal).toHaveBeenCalledTimes(1));
    expect(m.openExternal).toHaveBeenCalledWith(URL_TEXT);
    expect(m.generalOpenExternal, 'the general channel is About’s, not a link’s').not.toHaveBeenCalled();
  });

  // *Round four (T291, S5):* this case said `mailto:` text was not a link (024 FR-019b). FR-159
  // supersedes that for an ALLOWLISTED scheme, and `mailto` ships on the allowlist; `javascript:` is
  // refused whatever the allowlist says.
  it('`javascript:` is never a link; an allowlisted `mailto:` is, and leaves by the same channel (S5)', async () => {
    const m = await mount();
    m.pointAt(JS_AT);
    m.mouse('mousedown', { ctrlKey: true });
    m.mouse('mouseup', { ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(m.openExternal).not.toHaveBeenCalled();

    m.pointAt(MAILTO_AT);
    m.mouse('mousedown', { ctrlKey: true });
    m.mouse('mouseup', { ctrlKey: true });
    await waitFor(() => expect(m.openExternal).toHaveBeenCalledTimes(1));
    expect(m.openExternal).toHaveBeenCalledWith('mailto:someone@example.com');
    expect(m.generalOpenExternal).not.toHaveBeenCalled();
  });

  it('with `mailto` taken off the allowlist, `mailto:` is not a link', async () => {
    const m = await mount({ editor: { links: { protocolAllowlist: ['tel'] } } });
    m.pointAt(MAILTO_AT);
    m.mouse('mousedown', { ctrlKey: true });
    m.mouse('mouseup', { ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(m.openExternal).not.toHaveBeenCalled();
  });
});

describe('G12 — a plain click over a web link keeps its editor meaning (FR-103)', () => {
  it('opens nothing', async () => {
    const m = await mount();
    m.pointAt(IN_URL);
    m.mouse('mousedown');
    m.mouse('mouseup');
    await new Promise((r) => setTimeout(r, 20));
    expect(m.openExternal).not.toHaveBeenCalled();
  });
});

describe('G14 — a Ctrl+click that DRAGS from a web link selects (FR-103, FR-040)', () => {
  it('selects from the press to the release, and opens nothing', async () => {
    const m = await mount();
    m.pointAt(IN_URL);
    m.mouse('mousedown', { ctrlKey: true });
    m.pointAt(IN_URL + 8);
    m.mouse('mouseup', { ctrlKey: true, clientX: 200 });

    await new Promise((r) => setTimeout(r, 20));
    expect(m.openExternal, 'a drag is a selection, never an activation').not.toHaveBeenCalled();
    const main = m.h.view().state.selection.main;
    expect({ from: main.from, to: main.to }).toEqual({ from: IN_URL, to: IN_URL + 8 });
  });
});

describe('G4 — a Ctrl+click off any link is not claimed as a follow (FR-041)', () => {
  it('opens nothing, with a web link on the same document', async () => {
    const m = await mount();
    m.pointAt(PLAIN_AT);
    m.mouse('mousedown', { ctrlKey: true });
    m.mouse('mouseup', { ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(m.openExternal).not.toHaveBeenCalled();
  });
});

describe('G13 / G9 — the Open Link chord over a web link (FR-103, FR-044)', () => {
  it('one caret inside the web link, no selection: the chord opens it', async () => {
    const m = await mount();
    m.h.view().dispatch({ selection: { anchor: IN_URL } });

    expect(followLinkInPanel('p-ed', m.h.view()), 'the chord claims the key over a web link').toBe(true);
    await waitFor(() => expect(m.openExternal).toHaveBeenCalledTimes(1));
    expect(m.openExternal).toHaveBeenCalledWith(URL_TEXT);
  });

  it('with a selection, the chord is not claimed — Ctrl+Enter inserts a line as today (G9)', async () => {
    const m = await mount();
    m.h.view().dispatch({ selection: { anchor: IN_URL, head: IN_URL + 3 } });
    expect(followLinkInPanel('p-ed', m.h.view())).toBe(false);
    expect(m.openExternal).not.toHaveBeenCalled();
  });

  it('with two carets, the chord is not claimed (G9)', async () => {
    const m = await mount();
    m.h.view().dispatch({
      selection: EditorSelection.create([EditorSelection.cursor(IN_URL), EditorSelection.cursor(PLAIN_AT)]),
    });
    expect(followLinkInPanel('p-ed', m.h.view())).toBe(false);
    expect(m.openExternal).not.toHaveBeenCalled();
  });
});

describe('contract §6.1 — a web span is never sent to main to be resolved', () => {
  it('no `throng:links:resolve` request names the URL or any part of it', async () => {
    const m = await mount();
    m.h.view().dispatch({ selection: { anchor: IN_URL } });
    followLinkInPanel('p-ed', m.h.view());
    await new Promise((r) => setTimeout(r, 20));
    expect(m.resolved.filter((r) => URL_TEXT.includes(r.text) || r.text.includes('example.com'))).toEqual([]);
  });
});

/*
 * Round five (maintainer correction over FR-101's original reading, above): the editor's switch is no
 * longer guessed-paths-only — off means no link of any kind, web included. `link-decorations.ts`'s
 * `linkHitsBetween` gates every kind on ONE `deps.detect?.() === false` check now, and this is that
 * widening's behavioural half — Ctrl+click and the chord both go back to their ordinary meanings.
 */
describe('FR-060 (round five) — the editor’s detection switch now gates web links too', () => {
  it('with editor.links.detectInEditors off, Ctrl+click on a web link opens nothing', async () => {
    const m = await mount({ editor: { links: { detectInEditors: false } } });
    m.pointAt(IN_URL);
    m.mouse('mousedown', { ctrlKey: true });
    m.mouse('mouseup', { ctrlKey: true });

    await new Promise((r) => setTimeout(r, 20));
    expect(m.openExternal).not.toHaveBeenCalled();
  });

  it('and the chord does not claim the key either — CodeMirror inserts a blank line as it always did', async () => {
    const m = await mount({ editor: { links: { detectInEditors: false } } });
    m.h.view().dispatch({ selection: { anchor: IN_URL } });
    expect(followLinkInPanel('p-ed', m.h.view())).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(m.openExternal).not.toHaveBeenCalled();
  });
});
