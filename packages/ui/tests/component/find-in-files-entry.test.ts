/**
 * 043 T070–T070c — how a Find in Files panel is REACHED, and what state it is reached in.
 *
 * Four requirements meet in one function, and each of them is about a difference between routes
 * that a careless implementation collapses:
 *
 *   - FR-020/FR-021/FR-022 — the CURRENT tab, reuse or new, and a tab with no Find in Files panel
 *     gets one whatever the preference says.
 *   - FR-031a/FR-031b — the chord seeds from a single-line selection; the toolbar and the folder
 *     context menu never seed. Seeding from those two would overwrite the live term of a panel
 *     being reused, from a selection the user was not pointing at.
 *   - FR-031c — an input is focused with its contents SELECTED on every route, so a term can be
 *     typed without a further click. The search input for find; the replacement for replace.
 *   - FR-029d/FR-077 — replace in files is the same command with replace pre-enabled, and find in
 *     files is the same command with it put away: the chord decides the disclosure in BOTH
 *     directions, and the replacement text survives either way.
 *   - FR-029e — with no project open both chords do nothing at all and raise no notice.
 *
 * ══ WHY THE WORKSPACE IS A HANDFUL OF SPIES ══
 *
 * `openFindInFiles` takes a structural slice of the store — a layout and four mutators — precisely
 * so this file can drive it without a `WorkspaceProvider`, a project list and a config context
 * three levels up. What is under test is which panel it picks and what it leaves in the store, and
 * a real provider would put a mounted tree between the assertion and both of those.
 *
 * The PANEL is real, though, and rendered: FR-031c's "with its contents selected" is a claim about
 * a DOM input, and nothing below the component layer can see it.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type Panel,
  type Tab,
  type WorkspaceLayout,
} from '@throng/core';
import {
  __resetFindInFilesState,
  getFindInFilesPanel,
} from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  openFindInFiles,
  type FindInFilesWorkspace,
  type OpenFindInFilesArgs,
} from '../../src/renderer/find-in-files/open-find-in-files.js';
import { __resetLastActiveFindInFiles } from '../../src/renderer/find-in-files/last-active-find-in-files.js';
import {
  registerPanelSearch,
  unregisterPanelSearch,
  type SearchController,
} from '../../src/renderer/search/search-controller.js';
import {
  PANEL_ID,
  PROJECT_ID,
  PROJECT_ROOT,
  findInFilesPanel,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

const config = vi.hoisted(() => ({ settings: null as unknown as AppSettings }));

vi.mock('../../src/renderer/config/config-store.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/config/config-store.js')>();
  return { ...actual, useAppSettings: () => config.settings };
});

const EDITOR_ID = 'ed-1';
const TAB_ID = 'tab-1';
const NEW_PANEL_ID = 'p-new';

let bridge: FileSearchStub;

function editorPanel(): Panel {
  return {
    type: 'panel',
    id: EDITOR_ID,
    originProjectId: PROJECT_ID,
    title: 'Panel 1',
    kind: 'editor',
  };
}

/** A tab holding an editor and, optionally, one Find in Files panel beside it. */
function tab(withFindPanel: boolean, activePanelId = EDITOR_ID): Tab {
  const panels: Panel[] = withFindPanel ? [editorPanel(), findInFilesPanel()] : [editorPanel()];
  return {
    id: TAB_ID,
    title: 'Tab 1',
    activePanelId,
    root:
      panels.length === 1
        ? panels[0]
        : { type: 'split', orientation: 'row', children: panels, sizes: [0.5, 0.5] },
  };
}

function layout(withFindPanel: boolean, activePanelId?: string): WorkspaceLayout {
  return {
    projectId: PROJECT_ID,
    schemaVersion: 3,
    tabs: [tab(withFindPanel, activePanelId), { id: 'tab-2', title: 'Tab 2', root: editorPanel() }],
    activeTabId: TAB_ID,
  };
}

interface Spies {
  ws: FindInFilesWorkspace;
  addPanel: ReturnType<typeof vi.fn>;
  clearLastAddedPanel: ReturnType<typeof vi.fn>;
  setPanelType: ReturnType<typeof vi.fn>;
  setActivePanel: ReturnType<typeof vi.fn>;
}

function workspace(l: WorkspaceLayout | null): Spies {
  const addPanel = vi.fn(() => NEW_PANEL_ID);
  const clearLastAddedPanel = vi.fn();
  const setPanelType = vi.fn();
  const setActivePanel = vi.fn();
  return {
    addPanel,
    clearLastAddedPanel,
    setPanelType,
    setActivePanel,
    ws: { layout: l, addPanel, clearLastAddedPanel, setPanelType, setActivePanel },
  };
}

/** The command, with the parts a caller resolves from settings and the project list filled in. */
function invoke(spies: Spies, over: Partial<OpenFindInFilesArgs> = {}): string | null {
  let opened: string | null = null;
  act(() => {
    opened = openFindInFiles({
      ws: spies.ws,
      projectId: PROJECT_ID,
      projectRoot: PROJECT_ROOT,
      openTarget: 'lastActive',
      grouping: 'file',
      route: 'chord',
      replace: false,
      ...over,
    });
  });
  return opened;
}

/**
 * A focused panel holding `selection`, as `search-controller.ts` answers for it.
 *
 * The registry rather than a DOM selection: an editor's and a terminal's selections live in two
 * different engines, and `seedFromSelection()` is the one question 013 FR-002b already asks of
 * both. Seeding this surface from anywhere else would be a second seeding rule.
 */
function focusedSelection(selection: string): void {
  registerPanelSearch(EDITOR_ID, {
    panelKind: 'editor',
    seedFromSelection: () => selection,
    setQuery: () => ({ total: 0, current: 0 }),
    findNext: () => ({ total: 0, current: 0 }),
    findPrevious: () => ({ total: 0, current: 0 }),
    close: () => {},
    replaceCurrent: () => ({ total: 0, current: 0 }),
    replaceAll: () => ({ total: 0, current: 0 }),
    isReadOnly: () => false,
  } as SearchController);
}

function mountPanel(): void {
  renderFindInFilesPanel();
}

const term = (): HTMLInputElement => screen.getByTestId(`fif-term-${PANEL_ID}`) as HTMLInputElement;
const replacement = (): HTMLInputElement =>
  screen.getByTestId(`fif-replacement-${PANEL_ID}`) as HTMLInputElement;

/** What the DOM says about a field that has just been handed the caret (FR-031c). */
const focusedAndSelected = (el: HTMLInputElement): boolean =>
  document.activeElement === el &&
  el.selectionStart === 0 &&
  el.selectionEnd === el.value.length;

beforeEach(() => {
  config.settings = DEFAULT_APP_SETTINGS;
  __resetFindInFilesState();
  __resetLastActiveFindInFiles();
  bridge = installFileSearchStub();
});

afterEach(() => {
  unregisterPanelSearch(EDITOR_ID);
  __resetFindInFilesState();
  __resetLastActiveFindInFiles();
  removeFileSearchStub();
  vi.restoreAllMocks();
});

describe('which panel the search goes to (FR-020, FR-021, FR-022)', () => {
  it('reuses the tab’s Find in Files panel at the shipped default', () => {
    mountPanel();
    const spies = workspace(layout(true));

    expect(invoke(spies)).toBe(PANEL_ID);
    expect(spies.addPanel).not.toHaveBeenCalled();
    expect(spies.setActivePanel).toHaveBeenCalledWith(TAB_ID, PANEL_ID);
  });

  it('opens a NEW panel in a tab that has none, whatever the preference says (FR-022)', () => {
    /*
     * The requirement's sharp edge. "Reuse the last active panel" is the shipped default, and a
     * panel in ANOTHER tab must not receive the search — so the preference cannot be evaluated
     * across the window. The second tab in this layout exists purely so "there is a panel
     * somewhere" is true while the current tab has none.
     */
    const spies = workspace(layout(false));

    expect(invoke(spies, { openTarget: 'lastActive' })).toBe(NEW_PANEL_ID);
    expect(spies.addPanel).toHaveBeenCalledWith(TAB_ID);
    expect(spies.setPanelType).toHaveBeenCalledWith(NEW_PANEL_ID, 'findInFiles', {});
  });

  it('opens a new panel beside the existing one when the preference says New Panel', () => {
    mountPanel();
    const spies = workspace(layout(true));

    expect(invoke(spies, { openTarget: 'new' })).toBe(NEW_PANEL_ID);
    expect(spies.addPanel).toHaveBeenCalledTimes(1);
  });

  it('does not open the new panel in RENAME mode', () => {
    // Only a USER-added panel renames on add (FR-041). A panel that appeared because the user
    // pressed a search chord must not open with a rename box over its search input.
    const spies = workspace(layout(false));
    invoke(spies);
    expect(spies.clearLastAddedPanel).toHaveBeenCalledTimes(1);
  });
});

describe('seeding is the chord’s alone (FR-031a, FR-031b)', () => {
  it('pre-fills the input from a single-line selection, and selects it', () => {
    mountPanel();
    focusedSelection('needle');

    invoke(workspace(layout(true)));

    expect(term().value).toBe('needle');
    expect(focusedAndSelected(term())).toBe(true);
  });

  it('leaves a reused panel’s term standing when there is no selection', () => {
    mountPanel();
    focusedSelection('');
    invoke(workspace(layout(true)), { route: 'chord' });
    // A term the user typed, then a second invocation with nothing selected. `fireEvent.change`
    // rather than assigning `.value`: React installs its own value setter on the element, so a
    // direct assignment is overwritten on the next render and the field would read as empty.
    fireEvent.change(term(), { target: { value: 'haystack' } });
    expect(term().value).toBe('haystack');

    invoke(workspace(layout(true)));

    expect(term().value).toBe('haystack');
  });

  it('opens a NEW panel with an empty input when there is no selection', () => {
    focusedSelection('');
    const spies = workspace(layout(false));

    invoke(spies);

    expect(getFindInFilesPanel(NEW_PANEL_ID)?.term).toBe('');
  });

  it('does NOT seed on the toolbar route', () => {
    mountPanel();
    focusedSelection('needle');

    invoke(workspace(layout(true)), { route: 'toolbar' });

    expect(term().value).toBe('');
  });

  it('does NOT seed on the folder context-menu route, and scopes to the folder', () => {
    mountPanel();
    focusedSelection('needle');

    invoke(workspace(layout(true)), { route: 'contextMenu', scopeSubPath: 'src/renderer' });

    expect(term().value).toBe('');
    expect(getFindInFilesPanel(PANEL_ID)?.scopeSubPath).toBe('src/renderer');
  });
});

describe('an input is always focused with its contents selected (FR-031c)', () => {
  it('focuses the SEARCH input on the toolbar route, which seeds nothing', () => {
    mountPanel();
    invoke(workspace(layout(true)), { route: 'toolbar' });
    expect(document.activeElement).toBe(term());
  });

  it('focuses the SEARCH input on the context-menu route', () => {
    mountPanel();
    invoke(workspace(layout(true)), { route: 'contextMenu', scopeSubPath: 'src' });
    expect(document.activeElement).toBe(term());
  });

  it('focuses the REPLACEMENT input for replace in files, contents selected', () => {
    mountPanel();
    invoke(workspace(layout(true)), { replace: true });

    expect(focusedAndSelected(replacement())).toBe(true);
  });

  it('focuses the SEARCH input for find in files on a panel replace had disclosed', () => {
    /*
     * The reason `focusTarget` is carried by the invocation rather than derived from the panel's
     * disclosure state: the chord decides, and reading the panel would make the answer depend on
     * whatever the previous invocation happened to leave behind.
     *
     * FR-077 now also hides the row on the way past, so the two facts agree — but they are still two
     * facts, and this asserts the one about FOCUS. A future change that stopped hiding the row must
     * not silently take the caret with it.
     */
    mountPanel();
    invoke(workspace(layout(true)), { replace: true });
    invoke(workspace(layout(true)), { replace: false });

    expect(document.activeElement).toBe(term());
  });
});

describe('replace in files is the same command with replace pre-enabled (FR-029d)', () => {
  it('turns the toggle ON in a reused panel that had it off', () => {
    mountPanel();
    expect(getFindInFilesPanel(PANEL_ID)?.replaceEnabled).toBe(false);

    invoke(workspace(layout(true)), { replace: true });

    expect(getFindInFilesPanel(PANEL_ID)?.replaceEnabled).toBe(true);
  });

  it('honours FR-021/FR-022 identically — a tab with no panel gets a new one', () => {
    const spies = workspace(layout(false));

    expect(invoke(spies, { replace: true })).toBe(NEW_PANEL_ID);
    expect(getFindInFilesPanel(NEW_PANEL_ID)?.replaceEnabled).toBe(true);
  });

});

/**
 * 043 T180/T181 (FR-077) — and the two chords become SYMMETRIC.
 *
 * ══ WHAT THIS SUPERSEDES, NAMED RATHER THAN QUIETLY EDITED ══
 *
 * A test stood here asserting the opposite — *"never turns the toggle OFF: find in files is not a
 * command to put replace away"* — and it was right for as long as FR-029d was the only requirement
 * about the toggle. FR-077 decides the other way, in as many words: invoking find in files MUST
 * leave a reused panel with replace **off**, exactly as FR-029d requires replace in files to leave
 * it on. So the assertion is inverted here BY a requirement rather than to accommodate a change, and
 * the superseded wording is quoted above so the next reader finds a decision and not a reversal.
 *
 * ══ WHY NOTHING IS LOST BY HIDING ══
 *
 * The replacement TEXT is not the disclosure. It stays in the panel's state and FR-027b restores the
 * toggle across a restart, so what changes is only what the panel is currently showing — which is
 * why this file asserts the text survives as carefully as it asserts the toggle moves. A user who
 * presses find, types a new term and presses replace again finds their replacement where they left
 * it.
 *
 * With replace hidden there is nothing to focus in it, which is FR-031c's focus target resolving to
 * the search input — the same answer the FR-031c block above already gives for every find route.
 */
describe('find in files leaves a reused panel with replace OFF (FR-077)', () => {
  it('turns the toggle off in a panel that had it on', () => {
    mountPanel();
    invoke(workspace(layout(true)), { replace: true });
    expect(getFindInFilesPanel(PANEL_ID)?.replaceEnabled).toBe(true);

    invoke(workspace(layout(true)), { replace: false });

    expect(getFindInFilesPanel(PANEL_ID)?.replaceEnabled).toBe(false);
  });

  it('mirrors FR-029d exactly — the same command, the other direction', () => {
    // Stated as a round trip rather than as two tests, because symmetry is the requirement: whatever
    // state the panel is in, the chord that was pressed decides the disclosure.
    mountPanel();
    const spies = workspace(layout(true));

    invoke(spies, { replace: true });
    expect(getFindInFilesPanel(PANEL_ID)?.replaceEnabled).toBe(true);
    invoke(spies, { replace: false });
    expect(getFindInFilesPanel(PANEL_ID)?.replaceEnabled).toBe(false);
    invoke(spies, { replace: true });
    expect(getFindInFilesPanel(PANEL_ID)?.replaceEnabled).toBe(true);
  });

  it('leaves the replacement TEXT in the store — only the disclosure changes', () => {
    mountPanel();
    invoke(workspace(layout(true)), { replace: true });
    fireEvent.change(replacement(), { target: { value: 'thimble' } });
    expect(getFindInFilesPanel(PANEL_ID)?.replacement).toBe('thimble');

    invoke(workspace(layout(true)), { replace: false });

    expect(getFindInFilesPanel(PANEL_ID)?.replaceEnabled).toBe(false);
    expect(
      getFindInFilesPanel(PANEL_ID)?.replacement,
      'hiding the row must not discard what the user typed into it',
    ).toBe('thimble');

    // …and it comes back with the row, so the round trip is invisible to the user's work.
    invoke(workspace(layout(true)), { replace: true });
    expect(replacement().value).toBe('thimble');
  });

  it('puts the caret in the SEARCH input, contents selected', () => {
    mountPanel();
    invoke(workspace(layout(true)), { replace: true });

    invoke(workspace(layout(true)), { replace: false });

    expect(focusedAndSelected(term())).toBe(true);
  });

  it('opens a NEW panel with replace off, so both routes agree', () => {
    // FR-021's other branch. A fresh panel starts with replace away; the requirement is that a
    // REUSED one is left in the same state, which is what makes the two indistinguishable to a user
    // who does not know or care which they got.
    const spies = workspace(layout(false));
    expect(invoke(spies, { replace: false })).toBe(NEW_PANEL_ID);
    expect(getFindInFilesPanel(NEW_PANEL_ID)?.replaceEnabled).toBe(false);
  });
});

describe('with no project open, both chords are inert (FR-029e)', () => {
  it('opens nothing for find in files', () => {
    const spies = workspace(layout(false));

    expect(invoke(spies, { projectRoot: null, projectId: null })).toBeNull();

    expect(spies.addPanel).not.toHaveBeenCalled();
    expect(spies.setPanelType).not.toHaveBeenCalled();
    expect(spies.setActivePanel).not.toHaveBeenCalled();
  });

  it('opens nothing for replace in files either — its chord being inert is its whole obligation', () => {
    // FR-029d gives replace in files no visible surface of its own, so there is no disabled control
    // to assert for it. This is all there is.
    const spies = workspace(layout(false));

    expect(invoke(spies, { projectRoot: null, projectId: null, replace: true })).toBeNull();
    expect(spies.addPanel).not.toHaveBeenCalled();
  });

  it('starts no scan and asks the bridge for nothing', () => {
    invoke(workspace(layout(false)), { projectRoot: null, projectId: null });
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('is inert with no layout at all', () => {
    const spies = workspace(null);
    expect(invoke(spies)).toBeNull();
    expect(spies.addPanel).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 043 T251 (FR-090b, FR-091, FR-091a) — the tree's *Open In → Search* route
 *
 * ══ ONE STATE, WHETHER THE PANEL WAS OPENED OR REUSED ══
 *
 * The request: "when Find & Replace is already open in the current tab, the find & replace text
 * boxes are cleared, results are cleared, and the scope box is filled." A NEW panel arrives in that
 * state by construction, so the two paths are asserted to END in the same place rather than merely
 * each being plausible — a route whose outcome depends on whether a panel happened to exist is the
 * failure this block exists to catch.
 *
 * ══ WHAT THIS SUPERSEDES, AND WHAT IT DOES NOT ══
 *
 * FR-043a said a reused panel re-runs its existing term. That still holds for the chord and the
 * toolbar — `find-in-files-trigger.test.ts` pins it through `invokeFindInFiles` — and it no longer
 * holds here, because this route has just emptied the term. FR-091 names the exception.
 * ────────────────────────────────────────────────────────────────────────── */

describe('the tree route leaves the panel in one state (FR-091)', () => {
  /** A reused panel with everything the route has to clear: a term, a replacement and rows. */
  function busyPanel(): void {
    mountPanel();
    fireEvent.change(term(), { target: { value: 'needle' } });
    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 1,
    });
    fireEvent.click(screen.getByTestId(`fif-toggle-replace-${PANEL_ID}`));
    fireEvent.change(replacement(), { target: { value: 'thread' } });
    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(1);
    bridge.start.mockClear();
  }

  const tree = (over: Partial<OpenFindInFilesArgs> = {}): string | null =>
    invoke(workspace(layout(true)), { route: 'contextMenu', scopeSubPath: 'src/app.ts', ...over });

  it('empties the term and the replacement, and fills the scope with the path that was clicked', () => {
    busyPanel();
    tree({ replace: true });

    const state = getFindInFilesPanel(PANEL_ID);
    expect(state?.term).toBe('');
    expect(state?.replacement).toBe('');
    expect(state?.scopeSubPath).toBe('src/app.ts');
    expect(term().value).toBe('');
  });

  it('clears the listed results to NOT RUN — never read as a search that found nothing', () => {
    busyPanel();
    tree();

    expect(screen.queryAllByTestId(/^fif-row-/)).toHaveLength(0);
    // `complete` with no rows is FR-042's "found nothing". This panel has not searched anywhere yet.
    expect(getFindInFilesPanel(PANEL_ID)?.results.status).toBe('notRun');
  });

  it('asks main to clear the run, so a synced view does not keep the old rows (FR-091a)', () => {
    busyPanel();
    tree();

    expect(bridge.clear).toHaveBeenCalledWith(PANEL_ID);
  });

  it('starts nothing — the term is empty', () => {
    busyPanel();
    tree();

    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('shows replace for Find & Replace and hides it for Find, in both directions', () => {
    busyPanel(); // replace is SHOWN here
    tree({ replace: false });
    expect(getFindInFilesPanel(PANEL_ID)?.replaceEnabled).toBe(false);

    tree({ replace: true });
    expect(getFindInFilesPanel(PANEL_ID)?.replaceEnabled).toBe(true);
  });

  it('puts the caret in the SEARCH input for Find & Replace too, not the replacement', () => {
    /*
     * FR-031c's split sends replace in files' caret to the replacement, because that chord arrives
     * with a term already in the box. This route has just emptied it, and a replacement typed before
     * there is anything to find previews nothing.
     */
    busyPanel();
    tree({ replace: true });

    expect(document.activeElement).toBe(term());
  });

  it('leaves a NEW panel in exactly the state it leaves a reused one', () => {
    const spies = workspace(layout(false));
    const opened = invoke(spies, { route: 'contextMenu', scopeSubPath: 'src/app.ts', replace: true });

    const state = getFindInFilesPanel(opened ?? '');
    expect(state?.term).toBe('');
    expect(state?.replacement).toBe('');
    expect(state?.scopeSubPath).toBe('src/app.ts');
    expect(state?.replaceEnabled).toBe(true);
    expect(state?.results.status).toBe('notRun');
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('honours `openTarget: new` rather than overriding it (FR-090b, FR-021)', () => {
    mountPanel();
    const spies = workspace(layout(true));

    expect(invoke(spies, { route: 'contextMenu', scopeSubPath: '', openTarget: 'new' })).toBe(
      NEW_PANEL_ID,
    );
  });

  it('scopes to the whole project when the ROOT was right-clicked', () => {
    busyPanel();
    tree({ scopeSubPath: '' });
    expect(getFindInFilesPanel(PANEL_ID)?.scopeSubPath).toBe('');
  });
});

describe('the tree route starts nothing under the shipped as-you-type default either (FR-091, FR-074)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs no scan after the settle interval has long passed', () => {
    /*
     * The trigger is where this could quietly go wrong: under as-you-type, a change to the SCOPE
     * schedules a scan (FR-080e), and this route changes the scope. It starts nothing only because
     * the term is empty at the same moment — which is exactly what the route guarantees, and what a
     * reordering of its two writes would break.
     */
    mountPanel();
    // A LIVE term first, searched under the default trigger. Without it this test was vacuous: a
    // panel with nothing in its box can start nothing whatever the route does, so it passed against
    // the shipped route that re-runs the existing term.
    fireEvent.change(term(), { target: { value: 'needle' } });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(bridge.start).toHaveBeenCalledTimes(1);
    bridge.start.mockClear();

    invoke(workspace(layout(true)), { route: 'contextMenu', scopeSubPath: 'src' });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(bridge.start).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 043 T260 (FR-043a, FR-074) — an invocation that CHANGES a reused panel's query runs ONE scan
 *
 * Found by the closing converge, and half of it is round five's own regression. An invocation is
 * an explicit run (FR-043a) and starts a scan at once. When it also CHANGES the panel's query — the
 * toolbar now resets the scope to the whole project (the T253 fix), and the chord seeds a term from a
 * selection — the panel's as-you-type effect saw that change as an edit and scheduled a SECOND,
 * identical scan once the settle interval passed. The list reset and streamed again half a second
 * after it had filled.
 *
 * `find-in-files-trigger.test.ts`'s seeded-term case passed only because it never advanced the clock.
 * These do, far past the settle interval and its ceiling.
 * ────────────────────────────────────────────────────────────────────────── */

describe('an invocation that changes the query runs exactly one scan (T260)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A reused panel searching `needle` inside `src`, settled, with the start count reset. */
  function scopedPanel(): void {
    mountPanel();
    fireEvent.change(term(), { target: { value: 'needle' } });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    act(() => {
      openFindInFiles({
        ws: workspace(layout(true)).ws,
        projectId: PROJECT_ID,
        projectRoot: PROJECT_ROOT,
        openTarget: 'lastActive',
        grouping: 'file',
        route: 'contextMenu',
        replace: false,
        scopeSubPath: 'src',
      });
    });
    fireEvent.change(term(), { target: { value: 'needle' } });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    bridge.start.mockClear();
  }

  it('the TOOLBAR, which resets a folder scope to the whole project', () => {
    scopedPanel();

    invoke(workspace(layout(true)), { route: 'toolbar', scopeSubPath: '' });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(bridge.start).toHaveBeenCalledTimes(1);
    expect(bridge.start.mock.calls[0][0]).toMatchObject({ term: 'needle', scopeSubPath: null });
  });

  it('the CHORD with a selection, which seeds a different term', () => {
    scopedPanel();
    focusedSelection('haystack');

    invoke(workspace(layout(true)), { route: 'chord' });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(bridge.start).toHaveBeenCalledTimes(1);
    expect(bridge.start.mock.calls[0][0]).toMatchObject({ term: 'haystack' });
  });

  it('cancels a settle already pending from typing, rather than letting it fire a second scan', () => {
    /*
     * The user types, and presses the chord before the settle interval passes. The chord runs the
     * query at once; the timer the typing armed must not run it again a moment later.
     */
    scopedPanel();
    fireEvent.change(term(), { target: { value: 'needles' } });

    invoke(workspace(layout(true)), { route: 'chord' });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(bridge.start).toHaveBeenCalledTimes(1);
    expect(bridge.start.mock.calls[0][0]).toMatchObject({ term: 'needles' });
  });

  it('still schedules a scan for an ordinary EDIT afterwards — the effect is not switched off', () => {
    scopedPanel();
    invoke(workspace(layout(true)), { route: 'toolbar', scopeSubPath: '' });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    bridge.start.mockClear();

    fireEvent.change(term(), { target: { value: 'haystack' } });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(bridge.start).toHaveBeenCalledTimes(1);
    expect(bridge.start.mock.calls[0][0]).toMatchObject({ term: 'haystack' });
  });
});
