/**
 * 080 FR-070 — the Help page's cover over the guide's place while a dialog is up: a still of the guide, or a plain
 * cover while there is none (a slow or failed capture), and nothing once the guide is back.
 *
 * Layer: component (jsdom: URL.createObjectURL is stubbed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAIN_COVER, nextCover } from '../../src/renderer/help/help-app.js';

describe('the Help page cover (FR-070)', () => {
  let made = 0;
  const revoked: string[] = [];
  beforeEach(() => {
    made = 0;
    revoked.length = 0;
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: () => `blob:still-${++made}`,
      revokeObjectURL: (u: string) => revoked.push(u),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is plain for an empty image, so the guide is covered with no still yet', () => {
    expect(nextCover(null, new Uint8Array(0))).toBe(PLAIN_COVER);
    expect(made).toBe(0);
  });

  it('swaps a plain cover for the still when it lands, releasing nothing', () => {
    expect(nextCover(PLAIN_COVER, new Uint8Array([1, 2]))).toBe('blob:still-1');
    expect(revoked).toEqual([]);
  });

  it('is gone once the guide is back, and releases the still', () => {
    expect(nextCover('blob:still-1', null)).toBeNull();
    expect(revoked).toEqual(['blob:still-1']);
  });
});
