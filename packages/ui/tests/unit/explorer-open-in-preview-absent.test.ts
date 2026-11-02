/**
 * MOVED DOWN from `component/explorer-open-in-preview.test.ts` (pass 2): the builder draws no Preview
 * rows for a path outside the project. It renders nothing, so it is a unit case — `previewAffordance`
 * decides and `buildContextMenuItems` draws what it was given (044 FR-003, FR-004).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, SHIPPED_PREVIEW_PROVIDERS, previewAffordance } from '@throng/core';
import { buildContextMenuItems, type ContextMenuOps } from '../../src/renderer/explorer/context-menu-items.js';

const ROOT_FOLDER = 'C:/projects/demo';

describe('absent where a preview means nothing (FR-003, FR-004)', () => {
  it('for a file outside the project — the builder draws no row for an absent affordance', () => {
    // The tree composes every path under its own root, so the outside case is reached at the seam the
    // tree hands over: core's answer for a path outside the root, passed as the Preview argument.
    const affordance = previewAffordance({
      registry: SHIPPED_PREVIEW_PROVIDERS,
      settings: DEFAULT_APP_SETTINGS.editor.previews,
      absPath: 'E:/elsewhere/README.md',
      projectRoot: ROOT_FOLDER,
      isFolder: false,
      previewOpen: false,
      surface: 'explorer',
    });
    expect(affordance.state).toBe('absent');
    const noop = (): void => {};
    const ops = new Proxy({}, { get: () => noop }) as unknown as ContextMenuOps;
    const items = buildContextMenuItems({
      node: { relPath: 'README.md', kind: 'file' },
      selectedRelPaths: [],
      clipboard: null,
      ops,
      preview: { affordance, openLastActive: noop, openNew: noop, lastPreviewTitle: null },
    });
    const openIn = items.find((i) => i.label === 'Open In');
    const labels = openIn?.submenu?.map((i) => i.label) ?? [];
    expect(labels).not.toContain('New Preview Panel');
    expect(labels).not.toContain('Last Preview Panel');
  });
});
