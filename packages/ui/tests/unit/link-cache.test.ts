import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkResolution, LinkResolutionRequest } from '@throng/core';
import {
  LINK_CACHE_TTL_MS,
  __resetLinkCacheForTests,
  invalidateLinksUnder,
  peekLink,
  requestLink,
} from '../../src/renderer/links/link-cache.js';

/**
 * 045 FR-070, FR-071 (`data-model.md` §7) — the per-window resolution cache.
 *
 * ══ WHAT THIS CACHE IS ACTUALLY FOR ══
 *
 * Not speed. FR-071 forbids an existence check on the terminal's output path or the editor's typing
 * path, and the link provider runs synchronously while the pointer moves — so the provider CANNOT
 * await a resolution. `peekLink` returning `undefined` is therefore not "I do not know yet, please
 * wait", it is **"this is not a link"** (P3): nothing is underlined, nothing is followable, and no
 * menu item is offered. The answer arrives asynchronously and the NEXT hover sees it.
 *
 * That is also why the de-duplication matters more than it looks. Every pointer move over the same
 * span re-asks; without it, resting the pointer on one path would issue a request per mouse event.
 */

const RESOLVED: LinkResolution = {
  ok: true,
  link: { path: 'D:\\p\\src\\foo.ts', kind: 'file', inProject: true, executable: false, preview: 'none' },
};

const REQUEST: LinkResolutionRequest = {
  text: 'src/foo.ts',
  kind: 'detectedPath',
  baseDirectory: 'D:\\p',
  panelId: 'p1',
};

let asked: LinkResolutionRequest[] = [];
let answer: (request: LinkResolutionRequest) => Promise<LinkResolution>;

beforeEach(() => {
  asked = [];
  answer = async () => RESOLVED;
  vi.stubGlobal('window', {
    throng: {
      links: {
        resolve: (request: LinkResolutionRequest) => {
          asked.push(request);
          return answer(request);
        },
      },
    },
  });
  __resetLinkCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Let the fire-and-forget request settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('peekLink — FR-071: undefined means NOT A LINK, not "wait"', () => {
  it('is undefined before anything has been asked', () => {
    expect(peekLink(REQUEST)).toBeUndefined();
  });

  it('is still undefined immediately after requestLink, because the answer is asynchronous', () => {
    requestLink(REQUEST);
    expect(peekLink(REQUEST)).toBeUndefined();
  });

  it('holds the answer once it arrives', async () => {
    requestLink(REQUEST);
    await settle();
    expect(peekLink(REQUEST)).toEqual(RESOLVED);
  });

  it('holds a NON-link answer too \u2014 "we asked and it is not one" is worth caching', async () => {
    answer = async () => ({ ok: false });
    requestLink(REQUEST);
    await settle();
    expect(peekLink(REQUEST)).toEqual({ ok: false });
  });
});

describe('requestLink — FR-070: one request per key, however many times it is asked', () => {
  it('a second request for the same key while the first is in flight issues nothing', () => {
    requestLink(REQUEST);
    requestLink(REQUEST);
    requestLink(REQUEST);
    expect(asked).toHaveLength(1);
  });

  it('a request after the answer has landed issues nothing either', async () => {
    requestLink(REQUEST);
    await settle();
    requestLink(REQUEST);
    expect(asked).toHaveLength(1);
  });

  it('keys on all four fields \u2014 the same text in another panel is another question', async () => {
    requestLink(REQUEST);
    requestLink({ ...REQUEST, panelId: 'p2' });
    requestLink({ ...REQUEST, baseDirectory: 'D:\\other' });
    requestLink({ ...REQUEST, kind: 'fileHyperlink' });
    requestLink({ ...REQUEST, text: 'src/bar.ts' });
    expect(asked).toHaveLength(5);
  });

  it('an EMPTY base directory is the same question as an absent one', () => {
    // Both mean "no base directory to try first" (FR-022's untitled buffer), so they must not be two
    // cache entries — a surface that sends `''` where another sends `undefined` would otherwise ask
    // main the same question twice and get two entries that can go stale independently.
    requestLink({ ...REQUEST, baseDirectory: undefined });
    requestLink({ ...REQUEST, baseDirectory: '' });
    expect(asked).toHaveLength(1);
    // …and both are distinct from a base directory that actually names somewhere.
    requestLink({ ...REQUEST, baseDirectory: 'D:\\p' });
    expect(asked).toHaveLength(2);
  });

  it('is fire-and-forget: it returns nothing and a failure does not reject at the caller', async () => {
    answer = async () => {
      throw new Error('the bridge went away');
    };
    expect(requestLink(REQUEST)).toBeUndefined();
    await settle();
    // A failed request must not be remembered as an answer, or the link stays dead for the window's
    // lifetime because of one bad moment.
    expect(peekLink(REQUEST)).toBeUndefined();
  });

  it('a failed request can be retried \u2014 the in-flight mark is cleared', async () => {
    answer = async () => {
      throw new Error('nope');
    };
    requestLink(REQUEST);
    await settle();
    answer = async () => RESOLVED;
    requestLink(REQUEST);
    await settle();
    expect(asked).toHaveLength(2);
    expect(peekLink(REQUEST)).toEqual(RESOLVED);
  });

  it('asks nothing when the bridge is absent, and does not throw', () => {
    vi.stubGlobal('window', {});
    expect(() => requestLink(REQUEST)).not.toThrow();
    expect(peekLink(REQUEST)).toBeUndefined();
  });
});

describe('invalidateLinksUnder — FR-070 / P6: a cached answer never outlives its location', () => {
  it('drops an entry whose resolved path is under the changed path', async () => {
    requestLink(REQUEST);
    await settle();
    expect(peekLink(REQUEST)).toBeDefined();
    invalidateLinksUnder('D:\\p\\src');
    expect(peekLink(REQUEST)).toBeUndefined();
  });

  it('drops the entry when the changed path IS the resolved file', async () => {
    requestLink(REQUEST);
    await settle();
    invalidateLinksUnder('D:\\p\\src\\foo.ts');
    expect(peekLink(REQUEST)).toBeUndefined();
  });

  it('P6: a NON-link entry is dropped by a change under the base directory, so a file created later becomes a link', async () => {
    // The whole of P6. A `{ ok: false }` has no resolved path to compare, so the only thing that can
    // free it is a change somewhere it might have resolved — which is why the base directory and the
    // text are consulted for a non-link rather than only the resolved path.
    answer = async () => ({ ok: false });
    requestLink(REQUEST);
    await settle();
    expect(peekLink(REQUEST)).toEqual({ ok: false });
    invalidateLinksUnder('D:\\p\\src');
    expect(peekLink(REQUEST)).toBeUndefined();
    answer = async () => RESOLVED;
    requestLink(REQUEST);
    await settle();
    expect(peekLink(REQUEST)).toEqual(RESOLVED);
  });

  it('leaves an unrelated entry alone', async () => {
    requestLink(REQUEST);
    await settle();
    invalidateLinksUnder('D:\\somewhere\\else');
    expect(peekLink(REQUEST)).toEqual(RESOLVED);
  });

  it('compares the way every other path comparison in the app does \u2014 case and separator folded', async () => {
    requestLink(REQUEST);
    await settle();
    invalidateLinksUnder('d:/P/SRC');
    expect(peekLink(REQUEST)).toBeUndefined();
  });

  it('a sibling whose name merely starts with the changed path survives', async () => {
    requestLink(REQUEST);
    await settle();
    invalidateLinksUnder('D:\\p\\sr');
    expect(peekLink(REQUEST)).toEqual(RESOLVED);
  });
});

describe('the TTL \u2014 an answer is not believed forever', () => {
  it('an entry older than LINK_CACHE_TTL_MS is dropped and re-requested on the next peek', async () => {
    vi.useFakeTimers();
    requestLink(REQUEST);
    await vi.advanceTimersByTimeAsync(0);
    expect(peekLink(REQUEST)).toEqual(RESOLVED);
    vi.advanceTimersByTime(LINK_CACHE_TTL_MS + 1);
    expect(peekLink(REQUEST)).toBeUndefined();
    requestLink(REQUEST);
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toHaveLength(2);
  });

  it('an entry inside the TTL is still believed', async () => {
    vi.useFakeTimers();
    requestLink(REQUEST);
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(LINK_CACHE_TTL_MS - 1);
    expect(peekLink(REQUEST)).toEqual(RESOLVED);
  });

  it('the TTL is a named constant, not a setting', () => {
    // Complexity Tracking: nothing a user could reasonably want to change, so Principle X does not
    // apply — but it must be one number with a name rather than a literal in a condition.
    expect(typeof LINK_CACHE_TTL_MS).toBe('number');
    expect(LINK_CACHE_TTL_MS).toBeGreaterThan(0);
  });
});
