/**
 * 080 FR-067 — every guide screenshot names the screen it shows, and a screenshot whose screen changed since a
 * release while the image did not is reported stale.
 *
 * Layer: unit — the map against the files on disk, and the staleness rule over given change lists (no git).
 */
import { describe, expect, it } from 'vitest';

import { imagesOnDisk, mapProblems, readMap, staleScreens } from '../../../../scripts/guide-screens-stale.mjs';

const MAP = {
  everyScreen: ['packages/ui/src/renderer/theme.css'],
  screens: {
    'files/browse-your-project.png': ['packages/ui/src/renderer/explorer/'],
    'troubleshooting/find-your-version.png': ['packages/ui/src/renderer/about/about-app.tsx'],
  },
};

describe('the screenshot map (FR-067)', () => {
  it('names a screen for every image, and only images and source that exist', () => {
    expect(imagesOnDisk().length, 'no images found: the test has gone vacuous').toBeGreaterThan(10);
    expect(mapProblems(readMap())).toEqual([]);
  });
});

describe('staleScreens (FR-067)', () => {
  it('reports an image whose screen changed while the image did not', () => {
    expect(staleScreens(MAP, ['packages/ui/src/renderer/explorer/tree.tsx'])).toEqual([
      { image: 'files/browse-your-project.png', because: ['packages/ui/src/renderer/explorer/tree.tsx'] },
    ]);
  });

  it('treats an image regenerated in the same range as current', () => {
    expect(staleScreens(MAP, ['packages/ui/src/renderer/explorer/tree.tsx', 'site/guide/images/files/browse-your-project.png'])).toEqual([]);
  });

  it('reports every image when a file drawn in every screen changed', () => {
    expect(staleScreens(MAP, ['packages/ui/src/renderer/theme.css']).map((s) => s.image)).toEqual([
      'files/browse-your-project.png',
      'troubleshooting/find-your-version.png',
    ]);
  });

  it('ignores changes outside every screen, and matches a file entry exactly', () => {
    expect(staleScreens(MAP, ['packages/core/src/daemon/x.ts', 'packages/ui/src/renderer/about/about-app.tsx.bak'])).toEqual([]);
  });
});
