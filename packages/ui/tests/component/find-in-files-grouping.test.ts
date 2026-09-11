/**
 * 043 T063/T064 — grouping: switching it, defaulting it, and remembering it (FR-033, FR-033a–c).
 *
 * ══ THE CLAIM THAT MATTERS IS THE NEGATIVE ONE ══
 *
 * FR-033 says the groupings are two shapes of ONE result set (FR-073 withdrew a third), so
 * switching between them
 * must not re-run the search. That is asserted the only way it can be asserted honestly — the scan
 * channel's `start` is never called — because a panel that re-ran and happened to get the same rows
 * back would look identical on screen and cost a whole tree walk per click.
 *
 * ══ AND THE REMEMBERING IS IN MEMORY ONLY ══
 *
 * FR-033b remembers the last grouping PER PROJECT, in memory for the running application only. So
 * the assertion is about a second panel in the same project picking it up, and about a panel in a
 * project that has no remembered choice falling back to the FR-033a default — never about anything
 * reaching disk, which is what `__resetFindInFilesState` standing in for "a restart" expresses.
 */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  parseSettingsGuarded,
  type AppSettings,
  type FindInFilesGrouping,
} from '@throng/core';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  PROJECT_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

/**
 * The panel reads two preferences (FR-033a, FR-033b), so the config store is the one collaborator
 * this file substitutes. Everything else in the module — `useActiveTheme`, `useIconPacks`, which
 * every `<Icon>` needs — is the real thing, resolving to the bundled defaults.
 */
const config = vi.hoisted(() => ({ settings: null as unknown as AppSettings }));

vi.mock('../../src/renderer/config/config-store.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/config/config-store.js')>();
  return { ...actual, useAppSettings: () => config.settings };
});

let bridge: FileSearchStub;

function settings(inFiles: Partial<AppSettings['search']['inFiles']>): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    search: {
      ...DEFAULT_APP_SETTINGS.search,
      inFiles: { ...DEFAULT_APP_SETTINGS.search.inFiles, ...inFiles },
    },
  };
}

function mount(panelId = PANEL_ID, projectId = PROJECT_ID): void {
  renderFindInFilesPanel({ panelId, projectId });
}

/** Three matches over two folders — enough for both groupings to look different. */
function emitResults(): void {
  bridge.emit({
    panelId: PANEL_ID,
    generation: 1,
    status: 'complete',
    rows: [
      resultRow('src/a.ts', 1, 0),
      resultRow('src/a.ts', 4, 40),
      resultRow('lib/deep/c.ts', 2, 20),
    ],
    totalMatches: 3,
  });
}

const headings = (): string[] =>
  screen
    .queryAllByTestId(/^fif-group-header-/)
    .map((el) => el.getAttribute('data-group-key') ?? '');

const pressed = (panelId: string): FindInFilesGrouping | undefined =>
  (['file', 'fileAndFolder'] as const).find(
    (g) => screen.getByTestId(`fif-grouping-${g}-${panelId}`).getAttribute('aria-pressed') === 'true',
  );

beforeEach(() => {
  config.settings = settings({});
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

describe('grouping switches over results already found (FR-033)', () => {
  it('regroups without starting a second scan', async () => {
    const user = userEvent.setup();
    mount();
    emitResults();
    expect(headings()).toEqual(['lib/deep/c.ts', 'src/a.ts']);

    await user.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));

    // The folder headings arrive, each with its file heading beneath it, and no match is lost.
    expect(headings()).toEqual(['lib/deep', 'lib/deep/c.ts', 'src', 'src/a.ts']);
    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(3);
    // The whole of "without re-running": no scan was asked for at any point in this test.
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('nests file headings under folder headings under per file and folder', async () => {
    const user = userEvent.setup();
    mount();
    emitResults();

    await user.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));

    // Both kinds of heading are present, and the file ones sit a level in.
    const all = screen.getAllByTestId(/^fif-group-header-/);
    const folders = all.filter((el) => el.dataset.groupKind === 'folder');
    const files = all.filter((el) => el.dataset.groupKind === 'file');
    expect(folders.map((el) => el.dataset.groupKey)).toEqual(['lib/deep', 'src']);
    expect(files.map((el) => el.dataset.groupKey)).toEqual(['lib/deep/c.ts', 'src/a.ts']);
    for (const file of files) expect(Number(file.dataset.depth)).toBeGreaterThan(0);
    expect(bridge.start).not.toHaveBeenCalled();
  });
});

describe('the grouping a panel opens in (FR-033a, FR-033b, FR-033c)', () => {
  it('is per file by default', () => {
    mount();
    expect(pressed(PANEL_ID)).toBe('file');
  });

  it('follows the preference when it names another', () => {
    config.settings = settings({ defaultGrouping: 'fileAndFolder' });
    mount();
    expect(pressed(PANEL_ID)).toBe('fileAndFolder');
  });

  it('opens per file when a PERSISTED preference still names the retired grouping (FR-033c)', () => {
    /*
     * 043 T146 / FR-073. The remembered grouping is per project and in memory, but the preference
     * reaches disk — so someone upgrading from the shipped build may still have `'folder'` in their
     * `settings.json`. Nothing in this component coerces it and nothing should: `bounds-guard.ts`
     * does, on every read, because the value is outside the descriptor's `allowedValues` (R25).
     *
     * So the settings are built HERE the way the real config store builds them — from a raw
     * document through `parseSettingsGuarded` — rather than by handing the panel a typed object
     * with an impossible value in it. Substituting the guard would make this test pass on a
     * fixture rather than on the migration. The coercion itself is proved at the layer that owns
     * it, in `settings-grouping-retired.test.ts`.
     */
    config.settings = parseSettingsGuarded({
      search: { inFiles: { defaultGrouping: 'folder' } },
    }).value;

    mount();

    expect(pressed(PANEL_ID)).toBe('file');
    // And no control is drawn for it, so it cannot be chosen again.
    expect(screen.queryByTestId(`fif-grouping-folder-${PANEL_ID}`)).toBeNull();
  });

  it('reuses the last choice made in THAT project, and only that project', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));
    cleanup();

    // A second panel in the same project opens where the user left off (FR-033c).
    mount('p2', PROJECT_ID);
    expect(pressed('p2')).toBe('fileAndFolder');
    cleanup();

    // A project with no remembered choice opens in the FR-033a default — the half of FR-033c that
    // a single-project test cannot see.
    mount('p3', 'proj-2');
    expect(pressed('p3')).toBe('file');
  });

  it('opens in the default every time when remembering is off (FR-033b)', async () => {
    config.settings = settings({ rememberGrouping: false });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));
    // The user's choice still applies to the panel they made it in.
    expect(pressed(PANEL_ID)).toBe('fileAndFolder');
    cleanup();

    mount('p2', PROJECT_ID);
    expect(pressed('p2')).toBe('file');
  });

  it('keeps a collapsed group collapsed across a regrouping and back', async () => {
    const user = userEvent.setup();
    mount();
    emitResults();
    await user.click(screen.getByTestId('fif-group-toggle-src/a.ts'));
    expect(screen.queryByTestId('fif-row-src/a.ts-0')).toBeNull();

    await user.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));
    // The file heading keeps its key across the regrouping, so its collapse comes with it — which
    // is the claim: collapse is remembered per GROUP KEY, not per rendered position.
    expect(screen.queryByTestId('fif-row-src/a.ts-0')).toBeNull();
    // Its folder heading is a different group, and was never collapsed.
    expect(screen.getByTestId('fif-group-header-src').getAttribute('data-group-key')).toBe('src');

    await user.click(screen.getByTestId(`fif-grouping-file-${PANEL_ID}`));
    expect(screen.queryByTestId('fif-row-src/a.ts-0')).toBeNull();
  });
});


/* ────────────────────────────────────────────────────────────────────────── *
 * 043 T178/T179 (FR-071) — double-clicking a heading toggles its group
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The accelerator, and the two traps that come with it.
 *
 * The explorer tree already resolves exactly this pairing — a folder toggles on double-click while a
 * file opens on double-click — and `tree-node.tsx` is the precedent this follows rather than a new
 * invention. Both of its guards are copied, and both are asserted, because each is invisible until
 * somebody performs the gesture:
 *
 *   1. **The collapse control is INSIDE the heading.** A double-click landing on it runs the
 *      control's own handler and then, unless the `dblclick` is stopped, the heading's as well — so
 *      the group ends up in the OPPOSITE state from the one two clicks on a toggle produce.
 *      `e.stopPropagation()` on the inner control is the shipped remedy.
 *   2. **A modifier makes it a different gesture.** `tree-node.tsx` returns early from both its
 *      click handlers when one is held, and the same guard is here — widened to `alt` as well,
 *      because the explorer's three are its MULTI-SELECT set and this list has no selection model,
 *      so "a modifier key" has no narrower reading to inherit.
 *
 * **No menu item is owed.** Per-group toggling and collapse-all are already in the panel's menu
 * (FR-025a); this is an accelerator over them, which is exactly what the constitution's
 * every-action-has-a-menu-item rule asks for.
 */
describe('double-clicking a group heading toggles it (FR-071)', () => {
  const toggle = (key: string): HTMLElement => screen.getByTestId(`fif-group-toggle-${key}`);
  const heading = (key: string): HTMLElement => screen.getByTestId(`fif-group-header-${key}`);
  const expanded = (key: string): boolean => toggle(key).getAttribute('aria-expanded') === 'true';

  async function withResults(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    mount();
    emitResults();
    return user;
  }

  it('collapses an expanded group, and expands it again', async () => {
    const user = await withResults();
    expect(expanded('src/a.ts')).toBe(true);

    await user.dblClick(heading('src/a.ts'));
    expect(expanded('src/a.ts')).toBe(false);
    // Its rows go with it — the heading stays, which is the whole of what collapsing means here.
    expect(screen.queryByTestId('fif-row-src/a.ts-0')).toBeNull();
    expect(heading('src/a.ts')).toBeInTheDocument();

    await user.dblClick(heading('src/a.ts'));
    expect(expanded('src/a.ts')).toBe(true);
    expect(screen.getByTestId('fif-row-src/a.ts-0')).toBeInTheDocument();
  });

  it('leaves every OTHER group where it was', async () => {
    const user = await withResults();
    await user.dblClick(heading('src/a.ts'));
    expect(expanded('src/a.ts')).toBe(false);
    expect(expanded('lib/deep/c.ts')).toBe(true);
  });

  it('does not toggle TWICE when the double-click lands on the collapse control', async () => {
    /*
     * The arithmetic, because the assertion looks strange without it. A double-click is two clicks
     * and then a `dblclick`. On the control, the two clicks are two toggles — collapse, expand — so
     * the group correctly ends where it started. The defect is the THIRD toggle: without
     * `stopPropagation`, the `dblclick` reaches the heading behind the control and flips it once
     * more, leaving the group in the opposite state from the one the user's clicks produced.
     *
     * So "ends expanded" is not a claim that nothing happened — it is the claim that exactly the
     * control's own two toggles happened, which is what `tree-node.tsx` already does for the tree's
     * twisty.
     */
    const user = await withResults();
    expect(expanded('src/a.ts')).toBe(true);

    await user.dblClick(toggle('src/a.ts'));

    expect(expanded('src/a.ts')).toBe(true);
    expect(screen.getByTestId('fif-row-src/a.ts-0')).toBeInTheDocument();
  });

  it('still collapses on a SINGLE click of the collapse control', async () => {
    // The control the guard above is placed on has not been broken by placing it there.
    const user = await withResults();
    await user.click(toggle('src/a.ts'));
    expect(expanded('src/a.ts')).toBe(false);
  });

  it('does not toggle at all when the double-click carries a modifier', async () => {
    const user = await withResults();

    for (const modifier of ['Control', 'Shift', 'Alt', 'Meta']) {
      expect(expanded('src/a.ts'), `before ${modifier}`).toBe(true);
      await user.keyboard(`{${modifier}>}`);
      await user.dblClick(heading('src/a.ts'));
      await user.keyboard(`{/${modifier}}`);
      expect(expanded('src/a.ts'), `${modifier}+double-click toggled the group`).toBe(true);
    }
  });
});
