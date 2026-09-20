import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CORE_REFUSED_URI_SCHEMES } from '@throng/core';
import {
  __resetRefusedSchemesForTests,
  refusedSchemes,
} from '../../src/renderer/links/refused-schemes-client.js';

/**
 * 045 T287 (FR-159, US13 scenario 8; research R34; data-model §16.9) — the renderer's view of the
 * refused URI schemes.
 *
 * FR-159 says an allowlisted dangerous scheme is not a LINK — a drawing rule — and the platform's half
 * of the refused set lives behind `IRefusedUriSchemes` in main (Principle II). So the renderer asks main
 * once per window (`throng:linkUri:refusedSchemes`) and unites the answer with core's OS-neutral half.
 * Until main answers, core's half alone shapes drawing; main still refuses every click in that gap.
 */

let answer: (schemes: string[]) => void = () => {};
let asked = 0;

beforeEach(() => {
  __resetRefusedSchemesForTests();
  asked = 0;
  vi.stubGlobal('window', {
    throng: {
      linkUri: {
        openExternal: () => {},
        refusedSchemes: () => {
          asked += 1;
          return new Promise<string[]>((resolve) => {
            answer = resolve;
          });
        },
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetRefusedSchemesForTests();
});

describe('refusedSchemes() — core’s half until main answers, then the union', () => {
  it('before main answers: exactly core’s OS-neutral half', () => {
    expect([...refusedSchemes()].sort()).toEqual([...CORE_REFUSED_URI_SCHEMES].sort());
  });

  it('after throng:linkUri:refusedSchemes answers: core’s half united with the platform’s', async () => {
    refusedSchemes();
    answer(['ms-msdt', 'Search-MS']);
    await Promise.resolve();
    await Promise.resolve();
    const now = refusedSchemes();
    for (const s of CORE_REFUSED_URI_SCHEMES) expect(now.has(s), s).toBe(true);
    expect(now.has('ms-msdt')).toBe(true);
    expect(now.has('search-ms'), 'lower-cased').toBe(true);
    expect(now.has('file'), 'file is never in the set classification reads').toBe(false);
  });

  it('asks main ONCE per window, however often it is read', async () => {
    for (let i = 0; i < 20; i += 1) refusedSchemes();
    answer(['ms-msdt']);
    await Promise.resolve();
    for (let i = 0; i < 20; i += 1) refusedSchemes();
    expect(asked).toBe(1);
  });

  it('a window with no bridge keeps core’s half, and does not throw', () => {
    vi.stubGlobal('window', {});
    __resetRefusedSchemesForTests();
    expect([...refusedSchemes()].sort()).toEqual([...CORE_REFUSED_URI_SCHEMES].sort());
  });

  it('a failed answer keeps core’s half', async () => {
    vi.stubGlobal('window', {
      throng: { linkUri: { openExternal: () => {}, refusedSchemes: () => Promise.reject(new Error('no')) } },
    });
    __resetRefusedSchemesForTests();
    refusedSchemes();
    await Promise.resolve();
    await Promise.resolve();
    expect([...refusedSchemes()].sort()).toEqual([...CORE_REFUSED_URI_SCHEMES].sort());
  });
});
