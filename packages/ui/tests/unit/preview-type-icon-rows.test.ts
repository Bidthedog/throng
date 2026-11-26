/**
 * 074 FR-103 — every menu row that opens a preview is drawn with the preview icon of the type it opens: the
 * explorer's Open In → Preview rows and a link menu's Open Preview. A provider that declares no icon draws the
 * generic `preview` icon. (The editor's and the panel header's Open Preview rows are asserted beside their
 * other rows, in `editor-content-menu.test.ts` and `menu-sections.test.ts`.)
 */
import { describe, expect, it } from 'vitest';
import {
  SHIPPED_PREVIEW_PROVIDERS,
  previewAffordance,
  previewIconOf,
  previewSettingsDefaults,
  type LinkMenuApplicable,
  type PreviewProviderDescriptor,
} from '@throng/core';
import { previewOpenInRows } from '../../src/renderer/preview/preview-open-in.js';
import { linkMenuActions } from '../../src/renderer/links/link-menu.js';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';

const SETTINGS = previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS);
const noop = (): void => {};

function explorerRows(path: string, previewOpen = false): MenuAction[] {
  const affordance = previewAffordance({
    registry: SHIPPED_PREVIEW_PROVIDERS,
    settings: SETTINGS,
    absPath: path,
    projectRoot: 'D:/proj',
    isFolder: false,
    previewOpen,
    surface: 'explorer',
  });
  return previewOpenInRows({ affordance, lastPreviewTitle: 'notes' }, { lastActive: noop, new: noop });
}

describe('Open In → Preview rows wear the type’s preview icon (074 FR-103)', () => {
  it.each([
    ['D:/proj/notes.md', 'previewMarkdown'],
    ['D:/proj/flow.mmd', 'previewMermaid'],
    ['D:/proj/photo.png', 'previewImage'],
    ['D:/proj/logo.svg', 'previewSvg'],
    ['D:/proj/manual.pdf', 'previewPdf'],
    ['D:/proj/index.html', 'previewHtml'],
    ['D:/proj/people.csv', 'previewCsv'],
    ['D:/proj/book.xlsx', 'previewSpreadsheet'],
  ])('%s → %s, on both rows and on Current Preview', (path, icon) => {
    const rows = explorerRows(path);
    expect(rows.map((r) => r.icon)).toEqual([icon, icon]);
    expect(explorerRows(path, true).map((r) => r.icon)).toEqual([icon]);
  });

  it('a provider that declares no icon draws the generic preview icon', () => {
    const bare: PreviewProviderDescriptor = { id: 'bare', displayName: 'Bare', extensions: ['.bare'], kind: 'text' };
    const rows = previewOpenInRows(
      { affordance: { state: 'enabled', provider: bare }, lastPreviewTitle: null },
      { lastActive: noop, new: noop },
    );
    expect(rows.map((r) => r.icon)).toEqual(['preview', 'preview']);
  });
});

// Open Preview is a UNC link's row since 081 FR-053; a local link draws the explorer's preview rows above.
describe('a link menu’s Open Preview wears the linked type’s preview icon (074 FR-103)', () => {
  const applicable: LinkMenuApplicable = {
    inProjectByName: true,
    previewByExtension: 'enabled',
    executableByExtension: false,
    folderByGrammar: false,
  };
  const resolved = { kind: 'file', inProject: true, executable: false, preview: 'enabled' } as const;
  const openPreviewRow = (previewIcon?: ReturnType<typeof previewIconOf>): MenuAction | undefined =>
    linkMenuActions(
      {
        cls: 'unc',
        applicable,
        openEditors: [],
        openLink: noop,
        copyLink: noop,
        ...(previewIcon === undefined ? {} : { previewIcon }),
      },
      resolved,
    ).find((r) => r.label === 'Open Preview');

  it('draws the icon it is handed', () => {
    expect(openPreviewRow('previewPdf')?.icon).toBe('previewPdf');
  });

  it('draws the generic preview icon when handed none', () => {
    expect(openPreviewRow()?.icon).toBe('preview');
  });
});
