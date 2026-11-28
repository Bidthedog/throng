/**
 * The v1 review's menu rule (#732): a panel's TITLE menu holds the panel, its file and its link to other panels; its
 * BODY menu holds what acts on the content under the pointer. This file pins the rows that moved onto the title menu
 * and onto the grid body menus, at the builders, and the registry the title menu reads a body's state through.
 *
 * Layer: unit. The builders are pure; the mounted panels are the component tests'.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, PREVIEW_KIND, pathForms, type Panel } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { panelHeaderMenu, type PanelHeaderMenuArgs } from '../../src/renderer/workspace/panel-header-menu.js';
import { readPanelTitleExtras, registerPanelTitleExtras } from '../../src/renderer/workspace/panel-title-extras.js';
import { csvGridMenu, type CsvGridMenuArgs } from '../../src/renderer/preview/providers/csv/csv-menu.js';
import { spreadsheetMenu } from '../../src/renderer/preview/providers/spreadsheet/spreadsheet-menu.js';
import type { GridSelection } from '../../src/renderer/grid/grid-selection.js';

const noop = (): void => {};
const FORMS = pathForms('/project', 'src/app.ts');
const EDITOR: Panel = { type: 'panel', id: 'e1', originProjectId: 'proj', title: 'app.ts', kind: 'editor' };
const PREVIEW: Panel = { type: 'panel', id: 'v1', originProjectId: 'proj', title: 'data.csv', kind: PREVIEW_KIND };

function title(over: Partial<PanelHeaderMenuArgs>, actions: Partial<PanelHeaderMenuArgs['actions']> = {}): MenuAction[] {
  return panelHeaderMenu({
    panel: EDITOR,
    panelVerb: 'Destroy',
    keybindings: DEFAULT_KEYBINDINGS,
    otherTabs: [],
    editor: { dirty: false, hasFilePath: true },
    panelFailure: false,
    detach: null,
    actions: new Proxy(actions as PanelHeaderMenuArgs['actions'], {
      get: (target, key) => (key in target ? (target as Record<string | symbol, unknown>)[key] : noop),
    }),
    ...over,
  });
}

const labels = (items: MenuAction[]): string[] => items.map((i) => i.label ?? '');

describe('an editor’s title menu draws its format rows (v1 review, #732)', () => {
  const format = {
    panelId: 'e1',
    languageName: 'TypeScript',
    resetLanguage: { enabled: false, reset: noop },
    encoding: { current: { encoding: 'utf8' as const, hasBom: false }, canReopen: true, change: noop, openReopenPicker: noop, changeChord: 'Ctrl+Alt+E' },
    lineEndings: { lineEnding: 'lf' as const, mixed: false, convert: vi.fn(), insert: { insert: noop } },
  };

  it('opens the type group with Set Language…, Reset Language, Encoding ▸ and Line Endings ▸, ahead of Split', () => {
    const items = title({ editorFormat: format });
    const l = labels(items);
    const at = l.indexOf('Set Language… (TypeScript)');
    expect(l.slice(at, at + 4)).toEqual(['Set Language… (TypeScript)', 'Reset Language', 'Encoding (UTF-8)', 'Line Endings (LF)']);
    expect(at).toBeLessThan(l.indexOf('Split'));
    const rows = items.slice(at, at + 4);
    expect(rows.every((r) => r.section === 'viewState' && r.group === 'panelType')).toBe(true);
    expect(rows[1]!.disabled).toBe(true);
    expect(rows[2]!.shortcut).toBe('Ctrl+Alt+E');
    expect(rows[3]!.submenu?.map((r) => r.label)).toContain('Insert Line Break (CRLF)');
  });

  it('runs the conversion the Line Endings row names', () => {
    title({ editorFormat: format })
      .find((i) => i.testId === 'menu-item-Line Endings')!
      .submenu!.find((r) => r.label === 'CRLF')!
      .onClick!();
    expect(format.lineEndings.convert).toHaveBeenCalledWith('crlf');
  });

  it('draws none without format rows, and none on a preview', () => {
    expect(labels(title({})).some((l) => l.startsWith('Set Language'))).toBe(false);
    expect(
      labels(title({ panel: PREVIEW, editor: null, preview: { providerKind: 'text', parented: false }, editorFormat: format })).some((l) =>
        l.startsWith('Set Language'),
      ),
    ).toBe(false);
  });
});

describe('Copy Path ▸ on the title menu (074 FR-028, FR-068a, amended by the v1 review, #732)', () => {
  it.each([
    ['an editor', {}],
    ['a preview', { panel: PREVIEW, editor: null, preview: { providerKind: 'text' as const, parented: false } }],
  ])('%s draws it in Navigate, after Open in OS Default Program, with the four forms', (_name, over) => {
    const items = title({ ...over, copyPath: FORMS });
    const l = labels(items);
    expect(l.indexOf('Copy Path')).toBe(l.indexOf('Open in OS Default Program') + 1);
    const row = items.find((i) => i.label === 'Copy Path')!;
    expect(row).toMatchObject({ section: 'navigate', icon: 'copy' });
    expect(row.submenu).toHaveLength(4);
  });

  it('draws none for a file outside the project', () => {
    expect(labels(title({ copyPath: null }))).not.toContain('Copy Path');
  });
});

describe('the CSV Preview Editor’s title menu: Save and Save As… (073 FR-030, FR-035a, v1 review #732)', () => {
  const csvTitle = (editable: boolean, actions: Partial<PanelHeaderMenuArgs['actions']> = {}): MenuAction[] =>
    title({ panel: PREVIEW, editor: null, preview: { providerKind: 'text', parented: false, editable, cellDialog: { on: false } } }, actions);

  it('draws both in Content, first, with their chords, and runs the document’s own save', () => {
    const save = vi.fn();
    const saveAs = vi.fn();
    const items = csvTitle(true, { save, saveAs });
    // Content is the first section the menu draws (`groupBySection`), and these are its only rows.
    expect(items.filter((i) => i.section === 'content')).toMatchObject([
      { label: 'Save', icon: 'save', shortcut: 'Ctrl+S' },
      { label: 'Save As…', icon: 'saveAs' },
    ]);
    items.find((i) => i.label === 'Save')!.onClick!();
    items.find((i) => i.label === 'Save As…')!.onClick!();
    expect([save.mock.calls.length, saveAs.mock.calls.length]).toEqual([1, 1]);
  });

  it('keeps Open in Editor and Print… on the title menu, and has no Wrap or lock rows', () => {
    const l = labels(csvTitle(true));
    expect(l).toContain('Open in Editor');
    expect(l).toContain('Print…');
    for (const gone of ['Wrap', 'Lock First Row', 'Lock First Column', 'Go to Row…']) expect(l, gone).not.toContain(gone);
  });

  it('a preview that does not edit its file draws neither', () => {
    const l = labels(csvTitle(false));
    expect(l).not.toContain('Save');
    expect(l).not.toContain('Save As…');
  });
});

describe('every grid body menu carries Wrap, Lock First Row and Lock First Column (073 FR-013, FR-039a, v1 review #732)', () => {
  const sel = { active: { row: 0, col: 0 }, anchor: { row: 0, col: 0 } } as GridSelection;
  const flips = { wrap: vi.fn(), lockFirstRow: vi.fn(), lockFirstColumn: vi.fn() };
  const toggles = {
    wrap: { on: true, onToggle: flips.wrap },
    lockFirstRow: { on: false, onToggle: flips.lockFirstRow },
    lockFirstColumn: { on: true, onToggle: flips.lockFirstColumn },
  };
  const csv = (target: CsvGridMenuArgs['target'], withToggles = true): MenuAction[] =>
    csvGridMenu({
      target,
      sel: target.kind === 'row' ? { ...sel, rows: true } : sel,
      range: { top: 0, bottom: 0, left: 0, right: 0 },
      rowCount: 3,
      colCount: 3,
      copied: null,
      keybindings: DEFAULT_KEYBINDINGS,
      cellDialogAvailable: true,
      ...(withToggles ? { toggles } : {}),
      actions: new Proxy({} as CsvGridMenuArgs['actions'], { get: () => noop }),
    });
  const sheet = (target: CsvGridMenuArgs['target']): MenuAction[] =>
    spreadsheetMenu({ target, keybindings: DEFAULT_KEYBINDINGS, toggles, actions: { copy: noop, selectAll: noop, goToRow: noop, columnWidth: noop, resetWidth: noop } });
  const TARGETS: CsvGridMenuArgs['target'][] = [{ kind: 'cell', row: 0, col: 0 }, { kind: 'row', row: 0 }, { kind: 'column', col: 0 }, { kind: 'corner' }];
  const MENUS = [
    ...TARGETS.map((t) => [`CSV ${t.kind}`, () => csv(t)] as const),
    ...TARGETS.filter((t) => t.kind !== 'row').map((t) => [`Spreadsheet ${t.kind}`, () => sheet(t)] as const),
  ];

  it.each(MENUS)('%s: the three, checked as the panel holds them, last, in View & state; no Print…, Save or Open in Editor', (_name, build) => {
    const items = build();
    const tail = items.slice(-3);
    expect(tail.map((r) => [r.label, r.checked, r.section, r.testId])).toEqual([
      ['Wrap', true, 'viewState', 'menu-item-Wrap'],
      ['Lock First Row', false, 'viewState', 'menu-item-Lock First Row'],
      ['Lock First Column', true, 'viewState', 'menu-item-Lock First Column'],
    ]);
    expect(tail.map((r) => r.icon)).toEqual(['wrapCells', 'lockFirstRow', 'lockFirstColumn']);
    for (const gone of ['Print…', 'Save', 'Save As…', 'Open in Editor']) expect(labels(items), gone).not.toContain(gone);
  });

  it('each row runs its own flip', () => {
    const items = csv({ kind: 'cell', row: 0, col: 0 });
    for (const label of ['Wrap', 'Lock First Row', 'Lock First Column']) items.find((i) => i.label === label)!.onClick!();
    expect([flips.wrap, flips.lockFirstRow, flips.lockFirstColumn].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('draws none when the body is handed no toggles', () => {
    expect(labels(csv({ kind: 'cell', row: 0, col: 0 }, false))).not.toContain('Wrap');
  });
});

describe('the title-extras registry (v1 review, #732)', () => {
  it('reads the registered state when asked, and nothing once unregistered', () => {
    let name = 'JSON';
    const off = registerPanelTitleExtras('px', () => ({ editorFormat: { panelId: 'px', languageName: name } }));
    expect(readPanelTitleExtras('px').editorFormat?.languageName).toBe('JSON');
    name = 'YAML';
    expect(readPanelTitleExtras('px').editorFormat?.languageName).toBe('YAML');
    off();
    expect(readPanelTitleExtras('px')).toEqual({});
  });

  it('an older registration’s cleanup leaves a newer one in place', () => {
    const offOld = registerPanelTitleExtras('py', () => ({ copyPath: null }));
    const offNew = registerPanelTitleExtras('py', () => ({ copyPath: FORMS }));
    offOld();
    expect(readPanelTitleExtras('py').copyPath).toEqual(FORMS);
    offNew();
  });
});
