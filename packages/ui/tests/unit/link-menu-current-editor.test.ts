/**
 * 060 FR-045 — a link menu's Open In ▸ when the file the link names is already open in an editor
 * anywhere: ONE "Current Editor" row replaces New Editor / Active Editor, and the named-editor rows
 * are drawn disabled (a file is never moved between editors). Not open: the menu is unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import type { LinkMenuApplicable } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { linkMenuActions, type LinkMenuPerformers } from '../../src/renderer/links/link-menu.js';

const applicable: LinkMenuApplicable = {
  inProjectByName: true,
  previewByExtension: 'none',
  executableByExtension: false,
  folderByGrammar: false,
};
const resolved = { kind: 'file', inProject: true, executable: false, preview: 'none' } as const;
const editors = [
  { id: 'e1', name: 'Notes' },
  { id: 'e2', name: 'Readme' },
];

function openInRows(fileOpen: boolean | undefined, performers?: LinkMenuPerformers): MenuAction[] {
  const rows = linkMenuActions(
    {
      cls: 'onDevice',
      applicable,
      openEditors: editors,
      openLink: () => {},
      copyLink: () => {},
      ...(fileOpen === undefined ? {} : { fileOpen }),
      ...(performers ? { performers } : {}),
    },
    resolved,
  );
  const parent = rows.find((r) => r.label === 'Open In');
  if (!parent?.submenu) throw new Error('no Open In submenu');
  return parent.submenu as MenuAction[];
}

describe('link menu Open In — a file that is already open (FR-045)', () => {
  it('not open: New Editor, Active Editor, then the named editors, all enabled', () => {
    const rows = openInRows(false);
    expect(rows.map((r) => r.label)).toEqual(['New Editor', 'Active Editor', 'Notes', 'Readme']);
    expect(rows.every((r) => !r.disabled)).toBe(true);
  });

  it('open: one enabled Current Editor row, then the named editors disabled and without handlers', () => {
    const rows = openInRows(true);
    expect(rows.map((r) => r.label)).toEqual(['Current Editor', 'Notes', 'Readme']);
    expect(rows[0]!.disabled).toBe(false);
    expect(rows[1]!.disabled).toBe(true);
    expect(rows[2]!.disabled).toBe(true);
    expect(rows[1]!.onClick).toBeUndefined();
  });

  it('Current Editor performs the current target', () => {
    const openInEditor = vi.fn();
    const rows = openInRows(true, {
      openInEditor,
      openInPreview: vi.fn(),
      osExplorer: vi.fn(),
      osDefaultProgram: vi.fn(),
      openProgram: vi.fn(),
    });
    rows[0]!.onClick?.();
    expect(openInEditor).toHaveBeenCalledWith({ kind: 'current' });
  });
});
