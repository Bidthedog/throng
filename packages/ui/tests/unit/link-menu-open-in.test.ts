/**
 * 081 US6 (#731, FR-050 – FR-053) — a link to a local file or folder offers the File Explorer's Open In ▸,
 * built by the same `openInRows`, so the rows, labels, icons, groups and order cannot drift apart.
 *
 * Layer: unit. `linkMenuActions` turns core's Open In target state into rows through the `openIn` builder
 * the surface hands it; the File Explorer's rows come from `buildContextMenuItems`. Both are pure.
 */
import { describe, expect, it } from 'vitest';
import {
  SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS,
  type FlavourOption,
  type LinkMenuApplicable,
  type PreviewAffordance,
  type ResolvedTarget,
} from '@throng/core';
import { buildContextMenuItems, type ContextMenuOps } from '../../src/renderer/explorer/context-menu-items.js';
import { openInRows, type OpenInOps, type OpenInTarget } from '../../src/renderer/explorer/open-in-rows.js';
import { linkMenuActions } from '../../src/renderer/links/link-menu.js';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';

const noop = (): void => {};
const ABS = '/p/README.md';
const markdown = SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS.find((p) => p.id === 'markdown')!;
const FLAVOURS: readonly FlavourOption[] = [{ value: 'bash', label: 'Bash', defaultShellArguments: '' }];
const EDITOR_ROWS: MenuAction[] = [
  { label: 'Last Active Editor', icon: 'add', section: 'navigate', onClick: noop },
  { label: 'New Editor', icon: 'add', section: 'navigate', onClick: noop },
  { label: 'Other Tab', icon: 'tab', section: 'navigate', submenu: [{ label: 'Tab 2', icon: 'tab', section: 'navigate', onClick: noop }] },
];
const PREVIEW = {
  affordance: { state: 'enabled', provider: markdown } satisfies PreviewAffordance,
  lastPreviewTitle: null,
  openLastActive: noop,
  openNew: noop,
};

const ops: OpenInOps = {
  osExplorer: noop,
  osDefaultProgram: noop,
  editorRows: EDITOR_ROWS,
  preview: PREVIEW,
  flavours: FLAVOURS,
  openInTerminal: noop,
  findInFiles: noop,
};

const applicable = (over: Partial<LinkMenuApplicable> = {}): LinkMenuApplicable => ({
  inProjectByName: true,
  previewByExtension: 'enabled',
  executableByExtension: false,
  folderByGrammar: false,
  ...over,
});

const file = (over: Partial<ResolvedTarget> = {}): ResolvedTarget => ({
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'enabled',
  ...over,
});

/** What a row draws — every property but its handlers, nested submenus included. */
interface Shape {
  label?: string;
  icon?: string;
  section: string;
  group?: string;
  disabled: boolean;
  submenu?: Shape[];
}
const shape = (rows: readonly MenuAction[]): Shape[] =>
  rows.map((r) => ({
    ...(r.label !== undefined ? { label: r.label } : {}),
    ...(r.icon !== undefined ? { icon: r.icon } : {}),
    section: r.section,
    ...(r.group !== undefined ? { group: r.group } : {}),
    disabled: r.disabled === true,
    ...(r.submenu !== undefined ? { submenu: shape(r.submenu) } : {}),
  }));

function linkMenu(resolution: ResolvedTarget | null | 'pending', app: LinkMenuApplicable = applicable()): MenuAction[] {
  return linkMenuActions(
    {
      cls: 'onDevice',
      applicable: app,
      openLink: noop,
      copyLink: noop,
      openIn: (state) => openInRows({ absPath: ABS, ...state }, ops),
    },
    resolution,
  );
}

const openInOf = (rows: readonly MenuAction[]): MenuAction[] => rows.find((r) => r.label === 'Open In')!.submenu!;

function explorerOpenIn(kind: 'file' | 'folder'): MenuAction[] {
  const items = buildContextMenuItems({
    node: { relPath: kind === 'file' ? 'README.md' : 'docs', kind },
    selectedRelPaths: [],
    clipboard: null,
    ops: new Proxy({}, { get: () => noop }) as unknown as ContextMenuOps,
    projectRoot: '/p',
    ...(kind === 'file' ? { openIn: EDITOR_ROWS, preview: PREVIEW } : {}),
    flavours: FLAVOURS,
  });
  return openInOf(items);
}

const labels = (rows: readonly MenuAction[]): string[] =>
  rows.flatMap((r) => [r.label ?? '', ...(r.submenu ? labels(r.submenu) : [])]);

describe("081 FR-050 — the link's Open In ▸ is openInRows for the same target", () => {
  const cases: [string, ResolvedTarget, LinkMenuApplicable, OpenInTarget][] = [
    ['an in-project text file', file(), applicable(), { absPath: ABS, kind: 'file', inProject: true, binary: false, pending: false }],
    [
      'a folder',
      { kind: 'folder', inProject: true, executable: false, preview: 'none' },
      applicable({ folderByGrammar: true }),
      { absPath: ABS, kind: 'folder', inProject: true, binary: false, pending: false },
    ],
    [
      'an out-of-project file',
      file({ inProject: false }),
      applicable({ inProjectByName: false }),
      { absPath: ABS, kind: 'file', inProject: false, binary: false, pending: false },
    ],
    [
      'a binary file',
      file({ binary: true, preview: 'disabled' }),
      applicable({ binaryByExtension: true }),
      { absPath: ABS, kind: 'file', inProject: true, binary: true, pending: false },
    ],
  ];

  for (const [name, resolution, app, target] of cases) {
    it(name, () => {
      expect(shape(openInOf(linkMenu(resolution, app)))).toEqual(shape(openInRows(target, ops)));
    });
  }

  it('an in-project file matches the File Explorer’s Open In ▸ for that file, row for row', () => {
    expect(shape(openInOf(linkMenu(file())))).toEqual(shape(explorerOpenIn('file')));
  });

  it('a folder matches the File Explorer’s folder rows: OS File Explorer, Terminal, Search (FR-052)', () => {
    const rows = openInOf(linkMenu({ kind: 'folder', inProject: true, executable: false, preview: 'none' }, applicable({ folderByGrammar: true })));
    expect(shape(rows)).toEqual(shape(explorerOpenIn('folder')));
    expect(rows.map((r) => r.label)).toEqual(['OS File Explorer', 'Terminal', 'Search']);
  });
});

describe('081 FR-051, FR-052 — 045’s omission rules hold inside the submenu', () => {
  it('outside the project: the two OS rows only — no editor, preview, Terminal or Search', () => {
    expect(openInOf(linkMenu(file({ inProject: false }), applicable({ inProjectByName: false }))).map((r) => r.label)).toEqual([
      'OS File Explorer',
      'Open in OS Default Program',
    ]);
  });

  it('a binary file: no editor rows, every other row kept', () => {
    const got = openInOf(linkMenu(file({ binary: true }), applicable({ binaryByExtension: true }))).map((r) => r.label);
    expect(got).toEqual(['OS File Explorer', 'Open in OS Default Program', 'Last Preview Panel', 'New Preview Panel', 'Terminal', 'Search']);
  });

  it('before main answers: the rows that need the answer are drawn disabled, never hidden; the OS reveal stays live', () => {
    const rows = openInOf(linkMenu('pending'));
    expect(rows.map((r) => [r.label, r.disabled === true])).toEqual([
      ['OS File Explorer', false],
      ['Open in OS Default Program', true],
      ['Last Active Editor', true],
      ['New Editor', true],
      ['Other Tab', true],
      ['Last Preview Panel', true],
      ['New Preview Panel', true],
      ['Terminal', true],
      ['Search', true],
    ]);
    for (const row of rows.filter((r) => r.disabled === true)) {
      expect(row.onClick).toBeUndefined();
      expect(row.submenu).toBeUndefined();
    }
  });
});

describe('081 FR-053 — Open In ▸ holds the OS rows; the link’s own rows stay outside, and no row appears twice', () => {
  it('the top level is Open Link, Open In ▸, Find in File Explorer, Copy Link to Clipboard', () => {
    expect(linkMenu(file()).map((r) => r.label)).toEqual(['Open Link', 'Open In', 'Find in File Explorer', 'Copy Link to Clipboard']);
  });

  for (const resolution of [file(), file({ inProject: false }), null, 'pending' as const]) {
    it(`no label repeats anywhere in the menu (${resolution === null || resolution === 'pending' ? String(resolution) : `inProject=${resolution.inProject}`})`, () => {
      const all = labels(linkMenu(resolution));
      expect(all).toEqual([...new Set(all)]);
      expect(all).not.toContain('Open in OS Explorer');
      expect(all).not.toContain('Open Preview');
    });
  }
});
