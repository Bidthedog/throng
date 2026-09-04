import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultLayout,
  collectPanels,
  DEFAULT_APP_SETTINGS,
  type Panel,
  type WorkspaceLayout,
} from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { markTerminalRunning } from '../../src/renderer/workspace/subprocess.js';
import { TabGroup } from '../../src/renderer/workspace/tab-group.js';
import { requestTabPicker } from '../../src/renderer/workspace/tab-picker.js';

/**
 * The TAB STRIP, mounted whole (021 US2/US3, 024 US3 / FR-025, 031 US5 / K1-K11).
 *
 * PLACE AT: `packages/ui/tests/component/tab-strip.test.ts`
 * MIGRATED FROM `destroy.e2e.ts:147` and `tab-picker.e2e.ts:76`.
 *
 * ══ `TabGroup` TAKES NO PROPS, AND THAT IS THE POINT ══
 *
 * It renders the strip, the New Tab button, the picker overlay and — through `SplitTree` — every
 * panel in the active tab. So mounting it is mounting the workspace, and it needs exactly the six
 * providers `panel-box.test.ts` established: Services, Projects, Workspace, Notification, Confirm,
 * ContextMenu. `@dnd-kit`'s `DndContext` is inside `TabGroup` itself.
 *
 * That was established by a spike before anything here was written, for the same reason it was
 * there: the alternative is a partial mount held together with mocks, which is how a component test
 * starts asserting its own scaffolding.
 *
 * ══ WHAT DOES NOT COME DOWN, AND IT IS NOT A CLOSE CALL ══
 *
 * Anything gated on the strip OVERFLOWING. `counts.overflowing` (`tab-group.tsx:1427`) is computed
 * from measured widths, and jsdom reports every rect as 0×0 — so the step-left/step-right/show-all
 * controls never render here at all. `tab-actions.e2e.ts:120` asserts their icons and titles and its
 * census verdict says `component`; that verdict does not survive contact with the code, and it is
 * recorded as declined in `movable-backlog.md` rather than quietly attempted.
 *
 * The PICKER is different, and the difference is written into the source: `tab-group.tsx:1494` says
 * it "opens at ANY tab count, including when nothing overflows, because the chord can ask for it".
 * `requestTabPicker()` is that chord's entry point, and it is what these use.
 */

const PROJECT = 'proj-1';

/* ────────────────────────────────────────────────────────────────────────── *
 * The fake daemon
 * ────────────────────────────────────────────────────────────────────────── */

function fakeDaemon(seed?: (l: WorkspaceLayout) => WorkspaceLayout) {
  const base: WorkspaceLayout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  // A test that needs state the interface cannot produce here — an editor panel, say, which would
  // otherwise mean mounting CodeMirror in jsdom — seeds the LOADED layout instead of building it.
  const layout: WorkspaceLayout = seed ? seed(base) : base;
  const saved: WorkspaceLayout[] = [];
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save':
          saved.push((params as { layout: WorkspaceLayout }).layout);
          return Promise.resolve({ ok: true } as T);
        case 'workspace.loadSubWorkspaces':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [] } as T);
        case 'panelName.claim':
          return Promise.resolve({
            granted: (params as { desired: string }).desired,
            adjusted: false,
          } as T);
        default:
          return Promise.reject(new Error(`unexpected RPC from the tab strip: ${method}`));
      }
    },
  };
  return { bridge, saved };
}

function servicesOver(bridge: ThrongBridge): Services {
  return {
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}


/**
 * A sibling that captures the live store.
 *
 * `TabGroup` takes no props and exposes nothing, so a claim about STATE — `titleIsCustom` after a
 * rename, say — has no other way in. It renders nothing: this is a window onto the store, not a
 * second subject, and a test that asserted on the probe's own output would be asserting on itself.
 */
const captured: { ws: ReturnType<typeof useWorkspace> | null } = { ws: null };
function Probe(): null {
  captured.ws = useWorkspace();
  return null;
}

/** The CURRENT store — every operation renders a new context value, so a held reference goes stale. */
const liveWorkspace = (): ReturnType<typeof useWorkspace> =>
  captured.ws as ReturnType<typeof useWorkspace>;
const panelsIn = (ws: ReturnType<typeof useWorkspace>, i = 0): Panel[] =>
  collectPanels((ws.layout as WorkspaceLayout).tabs[i].root) as Panel[];

function mount(
  seed?: (l: WorkspaceLayout) => WorkspaceLayout,
  /*
   * Settings the user already has (035 T056). Merged over the shipped defaults and served through a
   * REAL `ConfigProvider`, so what is under test is the value travelling from the config payload to
   * whichever component reads it — not a prop handed straight to the thing being asserted on.
   */
  settings?: Record<string, unknown>,
) {
  const user = userEvent.setup();
  /*
   * `editor` is deliberately ABSENT here, and adding it is not free: every caller reaches it as
   * `window.throng?.editor?.x(…)`, so while the object is missing the whole chain short-circuits
   * and nothing runs. Introducing a partial `editor` turns those short-circuits into
   * `undefined is not a function` in tests that never meant to open one — a tree-drop and an editor
   * mount, both of which had been silently inert. The tab-destroy tests below install their own,
   * after the render, for exactly that reason.
   */
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn() },
    config: {
      get: () =>
        Promise.resolve({ settings: { ...DEFAULT_APP_SETTINGS, ...(settings ?? {}) } }),
      onChange: () => () => {},
    },
  });
  const daemon = fakeDaemon(seed);
  const services = servicesOver(daemon.bridge);

  // ANTI-VACUITY CONTROL: swap `TabGroup` for `'div'` and every test here fails at the strip.
  render(
    createElement(
      ConfigProvider,
      null,
    createElement(
      ServicesProvider,
      { services },
      createElement(
        ProjectsProvider,
        { client: services.projects },
        createElement(
          WorkspaceProvider,
          { client: services.workspace, activeProjectId: PROJECT },
          createElement(
            NotificationProvider,
            null,
            createElement(
              ConfirmProvider,
              null,
              createElement(
                ContextMenuProvider,
                null,
                createElement(Fragment, null, createElement(TabGroup, null), createElement(Probe, null)),
              ),
            ),
          ),
        ),
      ),
    ),
    ),
  );
  return { user, daemon };
}

/** The strip, once it has drawn its first chip. */
async function ready(): Promise<HTMLElement> {
  const strip = await screen.findByTestId('tab-strip');
  await waitFor(() => expect(chips()).toHaveLength(1));
  return strip;
}

/**
 * The chips on screen, top to bottom.
 *
 * A chip carries its id in `data-testid="tab-<id>"` and nowhere else — there is no `data-tab-id`.
 * That is not an oversight to work around: `tab-picker.tsx:81` records that roughly twenty specs
 * select tabs by that prefix, which is why the PICKER's own ids had to become `tabpicker-`.
 */
const chips = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.tab-chip')];
const chipIds = (): string[] =>
  chips().map((c) => (c.getAttribute('data-testid') ?? '').replace(/^tab-/, ''));

/**
 * Dismiss the rename box a newly added tab opens in, if one is showing.
 *
 * A new tab opens straight into its rename box (FR-041), and leaving it there would put the next
 * click's target inside an input. Escape cancels rather than commits, which is what a test that does
 * not care about the name wants.
 */
async function dismissRename(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const box = document.querySelector('input.tab-chip__rename');
  if (box) await user.keyboard('{Escape}');
}
const panelBoxes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.panel-box')];

beforeEach(() => {
  captured.ws = null;
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Cancelling a Tab destroy (024 FR-025)
 * ────────────────────────────────────────────────────────────────────────── */

describe('cancelling a Tab destroy changes nothing (migrated from destroy.e2e.ts:147)', () => {
  it('leaves the tab, its panels and the layout exactly as they were', async () => {
    /*
     * FR-025's claim is a NEGATIVE, and negatives are where a count is weakest: the migrated test
     * asserted `.tab-chip` was still 2, which is satisfied by a destroy that removed one tab and
     * added another, or by a dialog that never opened at all.
     *
     * So the dialog is asserted to have OPENED first — otherwise "nothing was destroyed" is a claim
     * about a control the user never reached — and then the tab IDS are compared rather than counted.
     */
    const { user, daemon } = mount();
    await ready();

    // A second tab, so destroying one is a choice rather than the only option.
    await user.click(screen.getByTestId('tab-add'));
    await waitFor(() => expect(chips()).toHaveLength(2));
    // A new tab opens in rename mode; leave it named as it is.
    await dismissRename(user);

    const before = chipIds();

    /*
     * ══ WAIT FOR THE ADD'S OWN SAVE BEFORE TAKING THE BASELINE ══
     *
     * `addTab` persists through a promise, so `daemon.saved.length` read immediately after the chip
     * appears is a number that is still going up. Captured there, the add's save lands DURING the
     * menu interaction below and `toHaveLength(savesBefore)` fails — an assertion about the cancel,
     * broken by the setup.
     *
     * This failed exactly once, in a full 350-file run, and passed ten times in a row on its own:
     * the load did not cause the race, it widened the window. Waiting for the tree to come to rest
     * first is the fix, and it is right whatever the machine is doing.
     */
    await waitFor(() => expect(daemon.saved.length).toBeGreaterThan(0));
    const settled = daemon.saved.length;
    await new Promise((r) => setTimeout(r, 0));
    expect(daemon.saved.length, 'the add is still saving — the baseline would be a moving number')
      .toBe(settled);
    const savesBefore = daemon.saved.length;

    // Re-queried by TESTID at the moment of use rather than held from the read above: a store that
    // re-renders between the two hands `user.pointer` a detached node.
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`tab-${before[0]}`) });
    await user.click(await screen.findByTestId('menu-item-Destroy Tab'));

    // The dialog really opened — the premise, asserted rather than assumed.
    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog).toBeVisible();

    await user.click(screen.getByTestId('confirm-cancel'));

    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(chips()).toHaveLength(2);
    // The same two tabs, in the same order — not merely two of something.
    expect(chipIds()).toEqual(before);
    // …and nothing was persisted. A cancel that redrew correctly but still saved would restore the
    // destroyed tab on this run and lose it on the next.
    expect(daemon.saved).toHaveLength(savesBefore);
  });

  it('destroys it only after BOTH dialogs — the positive control, and the level', async () => {
    /*
     * Without this, "cancel destroyed nothing" is satisfied by a Destroy Tab that never worked. The
     * migrated test had no such control, and neither did anything else at this layer.
     *
     * ══ WHAT THE CONTROL FOUND ══
     *
     * Written first with ONE accept, and the tab survived — correctly. `destroyTab` ships at level
     * **double** (`DEFAULT_APP_SETTINGS.confirmations.destroyTab`), so `planConfirmations` returns
     * `{ dialogs: 2, wryFinal: true }` and the first accept opens the "Are you absolutely sure?"
     * dialog rather than destroying anything.
     *
     * `core/tests/unit/destroy.test.ts:22` owns the plan; what nothing owned is this call site
     * honouring it, and the E2E's cancel test could not tell a one-dialog flow from a two-dialog one
     * because it never reached the second. So the intermediate state is asserted, not just the end.
     */
    const { user } = mount();
    await ready();

    await user.click(screen.getByTestId('tab-add'));
    await waitFor(() => expect(chips()).toHaveLength(2));
    await dismissRename(user);

    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`tab-${chipIds()[0]}`) });
    await user.click(await screen.findByTestId('menu-item-Destroy Tab'));
    await screen.findByTestId('confirm-dialog');

    await user.click(screen.getByTestId('confirm-accept'));

    // Still two tabs: the first accept opened the SECOND dialog, it did not destroy.
    const wry = await screen.findByTestId('confirm-dialog');
    expect(wry).toHaveTextContent(/absolutely sure/i);
    expect(chips()).toHaveLength(2);

    await user.click(screen.getByTestId('confirm-accept'));

    await waitFor(() => expect(chips()).toHaveLength(1));
  });

  it('the SECOND dialog can still be refused, and refusing it destroys nothing', async () => {
    // The wry final exists to be a real second chance. A flow that treated it as decoration — armed
    // but not consulted — passes the test above and loses the user's tab here.
    const { user } = mount();
    await ready();

    await user.click(screen.getByTestId('tab-add'));
    await waitFor(() => expect(chips()).toHaveLength(2));
    await dismissRename(user);
    const before = chipIds();

    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`tab-${chipIds()[0]}`) });
    await user.click(await screen.findByTestId('menu-item-Destroy Tab'));
    await screen.findByTestId('confirm-dialog');
    await user.click(screen.getByTestId('confirm-accept'));
    await waitFor(() =>
      expect(screen.getByTestId('confirm-dialog')).toHaveTextContent(/absolutely sure/i),
    );

    await user.click(screen.getByTestId('confirm-cancel'));

    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(chipIds()).toEqual(before);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The tab picker's list (031 US5, K1/K9/K11)
 * ────────────────────────────────────────────────────────────────────────── */

describe('the tab picker lists every tab (migrated from tab-picker.e2e.ts:76)', () => {
  it('shows them in strip order, with panel counts, and marks exactly one as current', async () => {
    /*
     * The migrated test seeded enough tabs to OVERFLOW the strip and asserted that some were off
     * screen, because "every tab, whether the strip is showing it or not" needed tabs the strip was
     * not showing. That precondition is a layout fact and it does not survive jsdom.
     *
     * What it was evidence FOR does: the picker builds its rows from `layout.tabs`, not from what
     * is rendered. `tabPickerEntries` is a pure function over the tab array — so a picker that
     * listed only the visible chips would have to be reading the DOM, and nothing here draws chips
     * it then hides. The claim is asserted as it is written: every tab in the layout, in order.
     */
    const { user } = mount();
    await ready();

    // Four tabs, so order is a real question rather than a coincidence of one.
    for (let i = 0; i < 3; i += 1) {
      await user.click(screen.getByTestId('tab-add'));
      await dismissRename(user);
    }
    await waitFor(() => expect(chips()).toHaveLength(4));
    const stripOrder = chipIds();
    expect(stripOrder.every((id) => id !== '')).toBe(true);

    requestTabPicker();

    const picker = await screen.findByTestId('tabpicker');
    // K1 / K11 — every tab, in the strip's own order.
    const rows = [...picker.querySelectorAll<HTMLElement>('[data-testid^="tabpicker-row-"]')];
    expect(rows.map((r) => (r.getAttribute('data-testid') ?? '').replace('tabpicker-row-', ''))).toEqual(
      stripOrder,
    );

    // K9 — the panel count, so two similarly named tabs can be told apart without opening either.
    expect(rows[0]?.querySelector('.picker__meta')?.textContent).toMatch(/^\d+ panels?$/);

    // K9 — and exactly one row is marked current, so "where am I?" needs no guess.
    const current = rows.filter((r) => r.getAttribute('data-current') === 'true');
    expect(current).toHaveLength(1);
  });

  it('singularises the count for a one-panel tab, and pluralises for two', async () => {
    // The migrated test matched `/^\d+ panels?$/`, which passes on "1 panels". A meta line is read
    // by a human, and this is the whole of what makes it read like one.
    const { user } = mount();
    await ready();

    requestTabPicker();
    let picker = await screen.findByTestId('tabpicker');
    let row = within(picker).getAllByTestId(/^tabpicker-row-/)[0];
    expect(row.querySelector('.picker__meta')?.textContent).toBe('1 panel');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('tabpicker')).toBeNull());

    // A second panel in the same tab.
    await user.click(screen.getByTestId(`panel-add-${panelBoxes()[0]?.dataset.panelId}`));
    await waitFor(() => expect(panelBoxes()).toHaveLength(2));

    requestTabPicker();
    picker = await screen.findByTestId('tabpicker');
    row = within(picker).getAllByTestId(/^tabpicker-row-/)[0];
    expect(row.querySelector('.picker__meta')?.textContent).toBe('2 panels');
  });

  it('marks the tab the user is ACTUALLY on, not the first one', async () => {
    /*
     * The trap the migrated test avoided by construction and never stated: with one tab, or with the
     * active tab first, `isCurrent` and "index 0" agree, and a picker that marked the first row
     * would pass. Making a LATER tab active separates them.
     */
    const { user } = mount();
    await ready();

    await user.click(screen.getByTestId('tab-add'));
    await dismissRename(user);
    await user.click(screen.getByTestId('tab-add'));
    await dismissRename(user);
    await waitFor(() => expect(chips()).toHaveLength(3));

    const lastId = chipIds()[2] ?? '';
    expect(lastId).not.toBe('');

    requestTabPicker();
    const picker = await screen.findByTestId('tabpicker');
    const current = [...picker.querySelectorAll<HTMLElement>('[data-current="true"]')];
    expect(current).toHaveLength(1);
    // A newly added tab becomes the active one, so the mark must be on the LAST row, not the first.
    expect(current[0]?.getAttribute('data-testid')).toBe(`tabpicker-row-${lastId}`);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Renaming a Tab and a Panel — by menu, and by double-click
 * (021 FR-036/037/041/043, migrated from ux-refinements.e2e.ts:249, :271, :303)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Three migrated tests, all of them the same shape: open throng's own context menu (an in-DOM React
 * component, not a native `Menu`), choose Rename, type, press Enter, read the result. The third adds
 * double-click as a second route to the same box.
 *
 * `:303`'s FIRST third — renaming a PROJECT — is not here and does not come down with these: the
 * sidebar is not in this mount, and `component/projects-panel-form.test.ts` owns the project rename
 * box. What that file does NOT yet assert is double-click as the route into it, so that third of
 * `:303` stays end-to-end and is named in the trimmed spec.
 */
describe('renaming a Tab from its menu (migrated from ux-refinements.e2e.ts:249)', () => {
  it('opens the box, commits on Enter, and the chip shows the new name', async () => {
    const { user } = mount();
    await ready();

    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`tab-${chipIds()[0]}`) });
    await user.click(await screen.findByTestId('menu-item-Rename'));

    const input = (await screen.findByTestId(
      `tab-rename-input-${chipIds()[0]}`,
    )) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'Renamed Tab');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByTestId(`tab-${chipIds()[0]}`)).toHaveTextContent('Renamed Tab'));
    // The box is gone, not merely hidden behind the label — a rename that left its input mounted
    // would swallow the next keystroke meant for the workspace.
    expect(document.querySelector('input.tab-chip__rename')).toBeNull();
  });

  it('leaves the name alone when the box is dismissed with Escape', async () => {
    // The migrated test only ever committed. A rename box that ignored Escape would pass it, and
    // would lose whatever name the user was backing out of changing.
    const { user } = mount();
    await ready();
    const before = screen.getByTestId(`tab-${chipIds()[0]}`).textContent;

    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`tab-${chipIds()[0]}`) });
    await user.click(await screen.findByTestId('menu-item-Rename'));
    const input = (await screen.findByTestId(
      `tab-rename-input-${chipIds()[0]}`,
    )) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'Discarded');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(document.querySelector('input.tab-chip__rename')).toBeNull());
    expect(screen.getByTestId(`tab-${chipIds()[0]}`).textContent).toBe(before);
  });
});

describe('Destroy other tabs (FR-043, migrated from ux-refinements.e2e.ts:249)', () => {
  it('takes two confirmations and leaves exactly the chosen tab', async () => {
    const { user } = mount();
    await ready();

    for (let i = 0; i < 2; i += 1) {
      await user.click(screen.getByTestId('tab-add'));
      await dismissRename(user);
    }
    await waitFor(() => expect(chips()).toHaveLength(3));
    const keep = chipIds()[1];

    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`tab-${keep}`) });
    await user.click(await screen.findByTestId('menu-item-Destroy other tabs'));

    // The same double level `destroyTab` uses. The migrated test clicked accept twice and asserted
    // the count; this asserts that the FIRST accept destroyed nothing, which is what makes the
    // second confirmation a second chance rather than a formality.
    await screen.findByTestId('confirm-dialog');
    await user.click(screen.getByTestId('confirm-accept'));
    await waitFor(() =>
      expect(screen.getByTestId('confirm-dialog')).toHaveTextContent(/absolutely sure/i),
    );
    expect(chips()).toHaveLength(3);

    await user.click(screen.getByTestId('confirm-accept'));

    await waitFor(() => expect(chips()).toHaveLength(1));
    // The one that survives is the one the menu was opened on — not simply "one of them".
    expect(chipIds()).toEqual([keep]);
  });
});

describe('renaming a Panel from its header menu (migrated from ux-refinements.e2e.ts:271)', () => {
  it('commits on Enter and the header shows the new name', async () => {
    const { user } = mount();
    await ready();
    const panelId = panelBoxes()[0]?.dataset.panelId ?? '';
    expect(panelId).not.toBe('');

    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`panel-handle-${panelId}`) });
    await user.click(await screen.findByTestId('menu-item-Rename'));

    const input = (await screen.findByTestId(`panel-rename-input-${panelId}`)) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'Server Logs');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByTestId(`panel-title-${panelId}`)).toHaveTextContent('Server Logs'),
    );
    // …and it is a MANUAL name, which is the fact every later automatic source is gated on. The
    // migrated test asserted the text and stopped, so a rename that displayed correctly while
    // leaving `titleIsCustom` false would have passed it and then been overwritten by the next file
    // the panel opened.
    await waitFor(() =>
      expect(panelsIn(liveWorkspace()).find((p) => p.id === panelId)?.titleIsCustom).toBe(true),
    );
  });
});

describe('double-click is the second route into both boxes (migrated from ux-refinements.e2e.ts:303)', () => {
  it('opens the TAB rename box', async () => {
    const { user } = mount();
    await ready();

    await user.dblClick(screen.getByTestId(`tab-${chipIds()[0]}`));

    const input = (await screen.findByTestId(
      `tab-rename-input-${chipIds()[0]}`,
    )) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'My Tab');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByTestId(`tab-${chipIds()[0]}`)).toHaveTextContent('My Tab'));
  });

  it('opens the PANEL rename box from its header', async () => {
    const { user } = mount();
    await ready();
    const panelId = panelBoxes()[0]?.dataset.panelId ?? '';

    await user.dblClick(screen.getByTestId(`panel-handle-${panelId}`));

    const input = (await screen.findByTestId(`panel-rename-input-${panelId}`)) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'My Panel');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByTestId(`panel-title-${panelId}`)).toHaveTextContent('My Panel'),
    );
  });

  it('a SINGLE click on a tab activates it and opens no box', async () => {
    /*
     * The half a double-click test cannot state about itself: the first half of a double-click is an
     * ordinary click, and if that click also opened the box then every tab switch would put the user
     * in a rename. The migrated `:303` learned this the painful way in a different form — its
     * comment records that the click half switched the active PROJECT and sent the rest of the test
     * into a workspace it never set up.
     */
    const { user } = mount();
    await ready();
    await user.click(screen.getByTestId('tab-add'));
    await dismissRename(user);
    await waitFor(() => expect(chips()).toHaveLength(2));

    await user.click(screen.getByTestId(`tab-${chipIds()[0]}`));

    expect(document.querySelector('input.tab-chip__rename')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId(`tab-${chipIds()[0]}`)).toHaveAttribute('data-active', 'true'),
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Adding and closing, and the split that appears and collapses with them
 * (005 FR-001, 021 FR-024, migrated from workspace-docking.e2e.ts:98 and :154)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Both migrated tests launched their OWN app — `startHarness`, `launchApp`, `shutdownApp`,
 * `stopDaemon`, a temp data directory — to count `.panel-box` elements and look for `split-node`.
 * Neither seeded anything before launch; the own-app was the file's convention, not a requirement.
 */
describe('adding a Panel splits, and closing one collapses (migrated from workspace-docking.e2e.ts:98, :154)', () => {
  it('adds a second panel inside a split, and neither is typed', async () => {
    const { user } = mount();
    await ready();
    const first = panelBoxes()[0]?.dataset.panelId ?? '';

    // No split with one panel — asserted BEFORE, so its appearance below is a change rather than a
    // state that was always there.
    expect(screen.queryByTestId('split-node')).toBeNull();

    await user.click(screen.getByTestId(`panel-add-${first}`));

    await waitFor(() => expect(panelBoxes()).toHaveLength(2));
    expect(screen.getByTestId('split-node')).toBeInTheDocument();

    // 005 / FR-001 — an untyped panel shows the type-selection FORM, not a live body. A panel that
    // silently defaulted to a terminal would satisfy the count and the split.
    for (const box of panelBoxes()) {
      const id = box.dataset.panelId ?? '';
      expect(screen.getByTestId(`panel-type-form-${id}`)).toBeInTheDocument();
    }
    expect(document.querySelector('[data-testid^="panel-terminal-"]')).toBeNull();
  });

  it('collapses the split when one is closed, leaving no split node behind', async () => {
    const { user } = mount();
    await ready();
    const first = panelBoxes()[0]?.dataset.panelId ?? '';

    await user.click(screen.getByTestId(`panel-add-${first}`));
    await waitFor(() => expect(panelBoxes()).toHaveLength(2));

    await user.click(screen.getByTestId(`panel-close-${first}`));

    await waitFor(() => expect(panelBoxes()).toHaveLength(1));
    // The split NODE goes with the panel. A layout that kept a one-child split would render
    // identically and then divide the tab in two the moment anything was added to it.
    expect(screen.queryByTestId('split-node')).toBeNull();
    // …and the panel that survived is the OTHER one, not merely one of them.
    expect(panelBoxes()[0]?.dataset.panelId).not.toBe(first);
  });

  it('refuses to close the LAST panel — the workspace never empties', async () => {
    const { user } = mount();
    await ready();
    const only = panelBoxes()[0]?.dataset.panelId ?? '';

    await user.click(screen.getByTestId(`panel-close-${only}`));

    // A no-op, and the SAME panel: a refusal that destroyed and re-created one would keep the count
    // at 1 while losing whatever was in it.
    await waitFor(() => expect(panelBoxes()).toHaveLength(1));
    expect(panelBoxes()[0]?.dataset.panelId).toBe(only);
    // And nothing was asked. The migrated test could not distinguish "refused" from "confirmed and
    // then refused", and a dialog for an action that cannot happen is worse than no dialog.
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Dropping a tree file on a TAB CHIP
 * (024 US4 follow-up, migrated from tree-drop-open.e2e.ts:180)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ THE SEAM IS THE SAME ONE THE REST OF ITS FILE USED ══
 *
 * `tree-drop-open.e2e.ts` dispatched a `throng:tree-drop` CustomEvent by hand — its own header says
 * the seam exists because "a real native drag cannot be driven from Playwright", and so does
 * `tab-group.tsx:164`. So no drag was ever real there, and the Electron process bought nothing the
 * event did not.
 *
 * Three of that file's four remaining tests are the PANEL routes, and every one has a covering test
 * already: `component/tree-drop-target.test.ts` owns the seam's addressing and refusal, and
 * `component/editor-open-routing.test.ts` owns where the file lands. This is the fourth, which is a
 * different listener on a different component and had no test anywhere.
 *
 * ══ WHY THE CHIP ROUTE IS NOT THE PANEL ROUTE ══
 *
 * `acceptTreeDrop` on a chip (`tab-group.tsx:155`) does two things a panel drop does not: it
 * ACTIVATES the tab first, and it routes through `openFileInTab` rather than `openFileInPanel` —
 * because a chip names a tab, not a place inside one. Dropping on a background tab therefore has to
 * bring it forward, or the file opens somewhere the user cannot see.
 */
describe('a tree file dropped on a tab CHIP (migrated from tree-drop-open.e2e.ts:180)', () => {
  /** Make a tab active, the way a chip click does — through the store, inside act. */
  const setActive = (tabId: string): void => {
    act(() => {
      liveWorkspace().setActiveTab(tabId);
    });
  };

  /** The seam, aimed at a tab rather than a panel. */
  const dropOnTab = async (tabId: string, paths: string[], singleFile = true): Promise<void> => {
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('throng:tree-drop', { detail: { tabId, paths, singleFile } }),
      );
    });
  };

  it('leaves the dropped-on tab ACTIVE, even when it was in the background', async () => {
    /*
     * ══ WHAT THIS ASSERTS, AND WHAT IT DELIBERATELY DOES NOT ══
     *
     * Written first as "the CHIP brings the tab forward", and its red step refused the claim:
     * deleting `ws.setActiveTab(tab.id)` from `acceptTreeDrop` (tab-group.tsx:158) left all
     * nineteen tests green.
     *
     * The reason is not a weak assertion, it is the code: `openFileInTab` activates the tab itself
     * (`editor-open.tsx:100`, `if (layout.activeTabId !== tabId) ws.setActiveTab(tabId)`). So the
     * chip's own call is REDUNDANT on every path that reaches the open — the two early returns above
     * it are "no layout" and "no such tab", neither reachable from a chip that is on screen.
     *
     * That is worth knowing and is not worth a test pretending otherwise. What a user can observe is
     * the OUTCOME: drop on a background tab, and that tab is the one you are looking at afterwards.
     * Which of the two call sites did it is invisible to them and to this test, and asserting it
     * would be asserting the implementation.
     */
    const { user } = mount();
    await ready();
    const first = chipIds()[0];

    // A second tab, which becomes active — so the first is now in the background, which is the
    // state this rule exists for.
    await user.click(screen.getByTestId('tab-add'));
    await dismissRename(user);
    await waitFor(() => expect(chips()).toHaveLength(2));
    expect((liveWorkspace().layout as WorkspaceLayout).tabs[0].id).toBe(first);
    await waitFor(() =>
      expect((liveWorkspace().layout as WorkspaceLayout).activeTabId).not.toBe(first),
    );

    await dropOnTab(first, ['C:/proj/hello.txt']);

    // A file opened into a tab the user is not looking at is a file they will think did not open.
    await waitFor(() =>
      expect((liveWorkspace().layout as WorkspaceLayout).activeTabId).toBe(first),
    );
  });

  it('ignores a drop addressed to a DIFFERENT tab', async () => {
    /*
     * Every chip listens on the same window event, so the `detail.tabId !== tab.id` guard
     * (`tab-group.tsx:169`) is the only thing stopping one drop from opening the file in every tab
     * at once. Asserted as a NEGATIVE beside a positive in the same test, so a component that had
     * stopped listening altogether fails rather than passes.
     */
    const { user } = mount();
    await ready();
    const first = chipIds()[0];

    await user.click(screen.getByTestId('tab-add'));
    await dismissRename(user);
    await waitFor(() => expect(chips()).toHaveLength(2));
    const second = chipIds()[1];
    setActive(second);

    await dropOnTab('no-such-tab', ['C:/proj/hello.txt']);
    expect((liveWorkspace().layout as WorkspaceLayout).activeTabId).toBe(second);

    // …and the very next drop, addressed properly, IS taken.
    await dropOnTab(first, ['C:/proj/hello.txt']);
    await waitFor(() =>
      expect((liveWorkspace().layout as WorkspaceLayout).activeTabId).toBe(first),
    );
  });

  it('refuses a FOLDER and a multi-select, leaving the active tab where it was', async () => {
    // `if (!singleFile || paths.length !== 1) return;` — one line, two rules, and the refusal is a
    // bare early return with no state change to wait on. The E2E could only ever have proved this
    // by sleeping; the activation is the observable that makes it instant.
    const { user } = mount();
    await ready();
    const first = chipIds()[0];

    await user.click(screen.getByTestId('tab-add'));
    await dismissRename(user);
    await waitFor(() => expect(chips()).toHaveLength(2));
    const second = chipIds()[1];
    setActive(second);

    await dropOnTab(first, ['C:/proj/somefolder'], false); // a folder
    expect((liveWorkspace().layout as WorkspaceLayout).activeTabId).toBe(second);

    await dropOnTab(first, ['C:/proj/a.txt', 'C:/proj/b.txt'], true); // two files
    expect((liveWorkspace().layout as WorkspaceLayout).activeTabId).toBe(second);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The close affordance is INERT until you have rested on it
 * (FR-044h / P6 / FR-057 / FR-059 — 035 T059)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ WHY THIS IS HERE AND NOT IN AN EXTRACTED `useCloseArming` ══
 *
 * T059 asked for the arming effect to be pulled out of `tab-group.tsx` into a hook, *"if T002's
 * method proves it testable"*. It is testable exactly where it is, so the extraction was NOT made —
 * it would have been a production change bought with nothing.
 *
 * Two things make it reachable. `TabGroup` mounts in jsdom (measured on this branch, along with
 * `PanelPlaceholder` and `PreferencesApp`), and the arming state is already exposed as
 * `data-armed` — put there deliberately, and the comment beside it says why: *"whether the control
 * will act is a fact about the control. Exposing it is what lets … be asserted on the state rather
 * than on a stylesheet, or worse, on a stopwatch."*
 *
 * So the seam the task wanted already existed; it was a data attribute rather than a hook.
 *
 * ══ WHY THE DELAY IS NOT DECORATION ══
 *
 * The affordance appears under the pointer as a consequence of the pointer arriving. Live
 * immediately, a user moving across the strip to reach a different tab passes over a control that
 * destroys the one they are passing — and P6's whole point is that it must have been RESTED on.
 * `dragInProgress` is the same hazard: a drop that ended under the pointer would otherwise arm the
 * control the instant the drag finished.
 */
describe('the close affordance arms only after a rest (P6)', () => {
  /** The chip's close control, and whether it will act. */
  const closeOf = (tabId: string): HTMLElement => screen.getByTestId(`tabstrip-close-${tabId}`);
  const isArmed = (tabId: string): boolean => closeOf(tabId).dataset.armed === 'true';

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is NOT armed the moment the pointer arrives', async () => {
    const { user } = mount();
    await ready();
    const ws = liveWorkspace();
    const tabId = (ws.layout as WorkspaceLayout).tabs[0].id;

    await user.hover(chips()[0]);

    // Shown, because the pointer is on it — and inert, because it has only just arrived.
    expect(closeOf(tabId).className).toContain('tab-chip__close--shown');
    expect(isArmed(tabId)).toBe(false);
  });

  it('arms once the delay has passed with the pointer still there', async () => {
    /*
     * Fake timers rather than a real wait, which is the whole reason this belongs at this layer:
     * the E2E equivalent would have to sleep 300 ms and hope, and a machine under load turns that
     * into a flake rather than a failure.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = mount();
    await ready();
    const ws = liveWorkspace();
    const tabId = (ws.layout as WorkspaceLayout).tabs[0].id;

    await user.hover(chips()[0]);
    expect(isArmed(tabId)).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_APP_SETTINGS.tabs.closeArmingDelayMs + 10);
    });

    expect(isArmed(tabId)).toBe(true);
  });

  it('does not arm early — the delay is a real interval, not a tick', async () => {
    /*
     * The anti-vacuity control for the test above. An implementation that armed on the next tick
     * would satisfy "arms after the delay" while giving the user no rest at all, which is the
     * behaviour P6 exists to prevent.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = mount();
    await ready();
    const ws = liveWorkspace();
    const tabId = (ws.layout as WorkspaceLayout).tabs[0].id;

    await user.hover(chips()[0]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_APP_SETTINGS.tabs.closeArmingDelayMs - 50);
    });

    expect(isArmed(tabId)).toBe(false);
  });

  it('disarms again when the pointer leaves, so a return starts the rest over', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = mount();
    await ready();
    const ws = liveWorkspace();
    const tabId = (ws.layout as WorkspaceLayout).tabs[0].id;

    await user.hover(chips()[0]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_APP_SETTINGS.tabs.closeArmingDelayMs + 10);
    });
    expect(isArmed(tabId)).toBe(true);

    await user.unhover(chips()[0]);

    expect(isArmed(tabId)).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A panel created from New Tab auto-names itself
 * (#218 — migrated from panel-auto-naming.e2e.ts:292, 035 T055)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ THE ROUTE THE E2E SAID WAS ASSERTED NOWHERE ══
 *
 * Its own comment: *"`addTab` does not set `lastAddedPanelId` — the TAB goes into rename mode
 * instead — so this route has different rename-box behaviour from the header `+` and was asserted
 * nowhere."*
 *
 * That is two claims about what `addTab` does, and both are this component's:
 *
 *   1. the TAB opens in rename mode, not the panel;
 *   2. the panel it brings with it is NOT marked custom — nobody typed a name, so nothing has been
 *      renamed, and `Reset Name` must stay disabled.
 *
 * The second is the whole of #218. A panel that believes it was renamed stops auto-naming itself, so
 * the window title and the editor's file name are suppressed on exactly the panels a user has just
 * created — which is the symptom that was reported.
 *
 * ══ WHAT DID NOT MOVE ══
 *
 * The E2E's third claim — choosing an editor, clicking `notes.md` in the tree, and the header
 * becoming "notes" — needs the explorer and a real file on disk to reach the editor. The naming RULE
 * behind it is `panelDisplayTitle`, pure and covered in core; what stays end-to-end is the journey
 * that feeds it.
 */
describe('the New Tab route names its panel automatically (#218)', () => {
  it('opens the TAB in rename mode, not the panel', async () => {
    const { user } = mount();
    await ready();

    await user.click(screen.getByTestId('tab-add'));

    // The tab's own rename box, and no panel rename box anywhere.
    await waitFor(() =>
      expect(document.querySelector('[data-testid^="tab-rename-input-"]')).toBeTruthy(),
    );
    expect(document.querySelector('[data-testid^="panel-rename-input-"]')).toBeNull();
  });

  it('leaves the new tab’s panel un-renamed, so it keeps naming itself', async () => {
    /*
     * The #218 rule. `titleIsCustom` is what suppresses automatic naming, so a panel that comes out
     * of this route believing it was renamed is a panel whose terminal title and file name will
     * never show — on the panels a user has just made, which is the reported symptom.
     *
     * Asserted on the STORE rather than on the Reset Name menu item's disabled flag, which is how
     * the E2E read it: the flag is derived from this, so the store is the claim and the flag is a
     * rendering of it. `panel-box.test.ts` covers the flag.
     */
    const { user } = mount();
    await ready();
    const tabsBefore = (liveWorkspace().layout as WorkspaceLayout).tabs.length;

    await user.click(screen.getByTestId('tab-add'));
    await waitFor(() =>
      expect((liveWorkspace().layout as WorkspaceLayout).tabs.length).toBe(tabsBefore + 1),
    );

    const newTab = (liveWorkspace().layout as WorkspaceLayout).tabs[tabsBefore];
    const panels = collectPanels(newTab.root) as Panel[];
    expect(panels.length, 'the new tab must bring a panel for this to be about one').toBeGreaterThan(0);

    for (const p of panels) {
      expect(p.titleIsCustom, `panel ${p.id} came out of New Tab marked custom`).toBeFalsy();
    }
  });

  it('escaping the tab’s rename box still leaves nothing renamed', async () => {
    /*
     * How this ends for a user who does not want to name the tab — the E2E pressed Escape here too.
     * Cancelling a box nobody typed into must not be recorded as a rename, of the tab OR the panel.
     */
    const { user } = mount();
    await ready();
    const tabsBefore = (liveWorkspace().layout as WorkspaceLayout).tabs.length;

    await user.click(screen.getByTestId('tab-add'));
    await waitFor(() =>
      expect((liveWorkspace().layout as WorkspaceLayout).tabs.length).toBe(tabsBefore + 1),
    );
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(document.querySelector('[data-testid^="tab-rename-input-"]')).toBeNull(),
    );

    const newTab = (liveWorkspace().layout as WorkspaceLayout).tabs[tabsBefore];
    for (const p of collectPanels(newTab.root) as Panel[]) {
      expect(p.titleIsCustom).toBeFalsy();
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Destroying a Tab releases the editors inside it (issue #145)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * MIGRATED FROM `editor-tab-destroy-reopen.e2e.ts:133` (AC1) and `:160` (AC2), 035 T056.
 *
 * ══ THE CLAIM IS ONE HOP, AND IT WAS THE ONLY UNTESTED PART ══
 *
 * #145: a PANEL destroy releases the app-wide one-buffer registry entry, a TAB destroy did not, so
 * the file stayed "open" against a panel that no longer existed and could never be reopened until
 * the daemon restarted. The fix is `releaseTabEditors` (`tab-group.tsx:1197`) calling
 * `disposeEditor` for each editor panel the destroy removes for good — `ws.closeTab` is a pure
 * layout op and never would.
 *
 * Everything on the far side of that call was already covered, and by name:
 *
 *   `integration/editor-one-buffer.integration.test.ts:49` — a second open focuses the existing editor
 *   `integration/editor-one-buffer.integration.test.ts:68` — DESTROYING the editor frees the file
 *   `unit/editor-open-registry.test.ts`                    — path matching, case, separators, prefixes
 *
 * So both E2E tests were launching Electron, starting a daemon, creating a real project and opening
 * a real file to prove that one call happens. `window.throng.editor.destroy` is the far end of it
 * and is asserted here directly — AC2's "the file opens again in a new editor" is :68's claim
 * restated through the interface, and it is proven where the registry lives.
 *
 * ══ THE EDITOR PANEL IS SEEDED, NOT BUILT ══
 *
 * Deliberately. `TabGroup` renders only the ACTIVE tab's `SplitTree` (`tab-group.tsx:1506`), and
 * the tab being destroyed is by construction not the active one — closing the last tab is refused,
 * so the E2E added a second tab first and so does this. That means the editor panel never mounts,
 * which is exactly what makes this testable in jsdom: the claim is about the layout the destroy
 * walks, not about CodeMirror.
 */
describe('destroying a Tab disposes the editor documents inside it (migrated from editor-tab-destroy-reopen.e2e.ts)', () => {
  /**
   * Install the editor bridge AFTER the render, and return the spy.
   *
   * `disposeEditor` reads `window.throng` at call time, so this is live by the time the destroy
   * runs — and until then the bridge is absent, which is what keeps every other path that reaches
   * for `editor` inert exactly as it is in the rest of this file.
   */
  function armEditorBridge(): ReturnType<typeof vi.fn> {
    const destroy = vi.fn();
    Reflect.set(Reflect.get(window, 'throng') as object, 'editor', { destroy });
    return destroy;
  }

  /** Tab `t1` holds `panels`; a second, ACTIVE tab exists so `t1` can be destroyed at all. */
  const seedWith = (panels: Partial<Panel>[]) => (l: WorkspaceLayout): WorkspaceLayout => {
    const leaf = (p: Partial<Panel>, i: number): Panel => ({
      type: 'panel',
      id: p.id ?? `p${i}`,
      originProjectId: PROJECT,
      title: p.title ?? `Panel ${i + 1}`,
      ...p,
    });
    const root =
      panels.length === 1
        ? leaf(panels[0]!, 0)
        : {
            type: 'split' as const,
            id: 's1',
            orientation: 'vertical' as const,
            sizes: panels.map(() => 1 / panels.length),
            children: panels.map(leaf),
          };
    return {
      ...l,
      tabs: [
        { id: 't1', title: 'Editors', root, activePanelId: panels[0]?.id ?? 'p0' },
        {
          id: 't2',
          title: 'Other',
          root: leaf({ id: 'p-keep', title: 'Panel keep' }, 0),
          activePanelId: 'p-keep',
        },
      ],
      activeTabId: 't2',
    };
  };

  /** Right-click `t1`, choose Destroy Tab, and accept every confirmation it raises. */
  async function destroyFirstTab(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tab-t1') });
    await user.click(await screen.findByTestId('menu-item-Destroy Tab'));
    for (let i = 0; i < 3; i += 1) {
      const accept = screen.queryByTestId('confirm-accept');
      if (!accept) break;
      await user.click(accept);
    }
    await waitFor(() => expect(screen.queryByTestId('tab-t1')).toBeNull());
  }

  it('disposes the editor panel it destroyed', async () => {
    const { user } = mount(seedWith([{ id: 'p-ed', kind: 'editor' }]));
    const editorDestroy = armEditorBridge();
    await screen.findByTestId('tab-strip');
    await waitFor(() => expect(screen.getByTestId('tab-t1')).toBeTruthy());

    await destroyFirstTab(user);

    expect(editorDestroy.mock.calls.map((c) => c[0])).toEqual(['p-ed']);
  });

  it('disposes EVERY editor in the tab, not just the active one', async () => {
    /*
     * A destroy that released only `activePanelId` would pass the test above perfectly and leave
     * every other editor in the tab claimed for the rest of the session — which is #145 again, one
     * panel further in.
     */
    const { user } = mount(
      seedWith([
        { id: 'p-ed1', kind: 'editor' },
        { id: 'p-ed2', kind: 'editor' },
      ]),
    );
    const editorDestroy = armEditorBridge();
    await screen.findByTestId('tab-strip');
    await waitFor(() => expect(screen.getByTestId('tab-t1')).toBeTruthy());

    await destroyFirstTab(user);

    expect(editorDestroy.mock.calls.map((c) => c[0]).sort()).toEqual(['p-ed1', 'p-ed2']);
  });

  it('does not dispose a panel that is not an editor', async () => {
    // `disposeEditor` on a terminal would clear editor state that never existed and send a destroy
    // for a document the coordinator does not hold. The kind check is what stops it, and without
    // this test a `releaseTabEditors` that dropped the check would look perfect.
    const { user } = mount(
      seedWith([
        { id: 'p-term', kind: 'terminal' },
        { id: 'p-ed', kind: 'editor' },
      ]),
    );
    const editorDestroy = armEditorBridge();
    await screen.findByTestId('tab-strip');
    await waitFor(() => expect(screen.getByTestId('tab-t1')).toBeTruthy());

    await destroyFirstTab(user);

    expect(editorDestroy.mock.calls.map((c) => c[0])).toEqual(['p-ed']);
  });

  it('leaves the editors in OTHER tabs alone', async () => {
    /*
     * The other half of "for good": a destroy that disposed every editor in the workspace would
     * satisfy all three assertions above and silently release documents the user is still looking
     * at. Their state deliberately survives a panel unmount (`use-editor.ts:918`), so nothing else
     * would notice.
     */
    const { user } = mount((l) => {
      const seeded = seedWith([{ id: 'p-ed', kind: 'editor' }])(l);
      // A THIRD tab, so the surviving editor is in a tab that is not the active one either. The
      // active tab's `SplitTree` is the only one that renders, and mounting a real editor here
      // would drag CodeMirror and the document authority into a test about a layout walk.
      seeded.tabs.push({
        id: 't3',
        title: 'Elsewhere',
        root: {
          type: 'panel',
          id: 'p-ed-other',
          originProjectId: PROJECT,
          title: 'Panel elsewhere',
          kind: 'editor',
        },
        activePanelId: 'p-ed-other',
      });
      return seeded;
    });
    const editorDestroy = armEditorBridge();
    await screen.findByTestId('tab-strip');
    await waitFor(() => expect(screen.getByTestId('tab-t1')).toBeTruthy());

    await destroyFirstTab(user);

    expect(editorDestroy.mock.calls.map((c) => c[0])).toEqual(['p-ed']);
    expect(editorDestroy.mock.calls.map((c) => c[0])).not.toContain('p-ed-other');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A confirmation level the user set, reaching a destroy
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * MIGRATED FROM `config-hotreload.e2e.ts:111` (035 T056) — `test('applies a hand-edited
 * settings.json on startup (confirmations level)')`.
 *
 * ══ THE TEST WAS ABOUT SETTINGS, AND ASSERTED IT THROUGH A DESTROY ══
 *
 * It seeded `confirmations.destroyPanel: 'none'` into `settings.json` BEFORE launch, then destroyed
 * a panel and asserted no dialog. Two halves, and only one of them was about configuration:
 *
 *   a hand-edited document is READ at startup
 *     → `integration/config-store.integration.test.ts` and `integration/config-watcher-retry.test.ts`,
 *       which additionally cover the unreadable and mid-write cases this could not reach
 *   the level the user set REACHES the destroy, and `none` means no dialog
 *     → here
 *
 * `planConfirmations` is pure and covered in `core/tests/unit`; what had no test was that
 * `panel-placeholder.tsx:322` hands it `settings.confirmations` rather than a default, which is the
 * hop a hand-edited level actually travels.
 *
 * ══ WHY THE PANEL HOLDS A RUNNING TERMINAL ══
 *
 * A panel with nothing running is destroyed without a confirmation ANYWAY at the shipped level —
 * that is `destroy.e2e.ts:68`, already migrated to `panel-box.test.ts:364`. So a test that destroyed
 * an EMPTY panel under `none` would prove nothing about the setting: both levels behave identically
 * there. The running terminal is the condition `planConfirmations` gates on, and it is what makes
 * the two levels distinguishable at all.
 */
describe('the confirmation LEVEL the user set reaches a destroy (migrated from config-hotreload.e2e.ts:111)', () => {
  const firstPanelId = (): string => panelsIn(liveWorkspace())[0]!.id;

  it('asks first at the SHIPPED level', async () => {
    const { user } = mount(undefined, { confirmations: { destroyPanel: 'double' } });
    await ready();
    const id = firstPanelId();
    markTerminalRunning(id);

    await user.click(screen.getByTestId(`panel-close-${id}`));

    await waitFor(() => expect(screen.getByTestId('confirm-dialog')).toBeTruthy());
  });

  it('destroys WITHOUT asking when the user has set "none"', async () => {
    /*
     * The same panel, the same gesture, the other level. Together with the test above this is the
     * whole claim: the level decides, and the level comes from the user's settings.
     *
     * A SECOND panel exists first so the destroy is unambiguous. Destroying the only panel in a tab
     * leaves the tab with a replacement, so "no boxes left" is not what a successful destroy looks
     * like — the first draft asserted it and failed on a destroy that had worked perfectly.
     */
    const { user } = mount(undefined, { confirmations: { destroyPanel: 'none' } });
    await ready();
    const id = firstPanelId();
    await user.click(screen.getByTestId(`panel-add-${id}`));
    await waitFor(() => expect(panelBoxes()).toHaveLength(2));
    await dismissRename(user);
    markTerminalRunning(id);

    await user.click(screen.getByTestId(`panel-close-${id}`));

    await waitFor(() => expect(panelBoxes()).toHaveLength(1));
    expect(screen.queryByTestId('confirm-dialog'), 'the level said none').toBeNull();
    expect(panelsIn(liveWorkspace()).map((p) => p.id), 'and it is THAT panel that went').not.toContain(id);
  });

  it('reads the level from SETTINGS rather than from the panel’s own state', async () => {
    /*
     * The two tests above differ in the setting AND nothing else, which is the point — but a
     * component that ignored settings and keyed off "does this panel have a terminal" would produce
     * the shipped answer in both, and only the second would fail. This one makes the setting the
     * only variable a second time, from the other direction: `single` is neither of the values
     * above, and it must still confirm.
     */
    const { user } = mount(undefined, { confirmations: { destroyPanel: 'single' } });
    await ready();
    const id = firstPanelId();
    markTerminalRunning(id);

    await user.click(screen.getByTestId(`panel-close-${id}`));

    await waitFor(() => expect(screen.getByTestId('confirm-dialog')).toBeTruthy());
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The two glyph controls are named by their ACTION (#282)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * `title` does not win the accessible-name computation when an element has text content — and the
 * text content of these two buttons was the glyph, so both announced as "plus".
 *
 * The name is computed here rather than asserted on an attribute, which is the whole reason this is
 * a component test and not a source grep: `getByRole('button', { name })` runs the real algorithm,
 * so a fix that added `aria-label` while leaving the text node in place would still fail — as it
 * should, since a screen reader would then read both.
 *
 * The negative assertion is the load-bearing half. Without it, a control that gained the right name
 * AND kept announcing its glyph would pass.
 */
describe('the glyph controls are announced by their action, not their glyph (#282)', () => {
  const firstPanelId = (): string => panelsIn(liveWorkspace())[0]!.id;

  it('names the New Tab button "New tab"', async () => {
    mount();
    await ready();

    expect(screen.getByRole('button', { name: 'New tab' })).toBe(screen.getByTestId('tab-add'));
    expect(screen.queryByRole('button', { name: '+' })).toBeNull();
  });

  it('names the Add Panel button "Add panel"', async () => {
    mount();
    await ready();
    const id = firstPanelId();

    expect(screen.getByRole('button', { name: 'Add panel' })).toBe(
      screen.getByTestId(`panel-add-${id}`),
    );
    expect(screen.queryByRole('button', { name: '+' })).toBeNull();
  });

  /*
   * The sibling that already got it right (`panel-close`, three lines below `panel-add` in the same
   * `<span>`) is asserted alongside them — not for its own sake, but so this file fails if a later
   * change to the shared button path takes the name away from ALL THREE at once. A test that only
   * covered the two that were broken could not tell that apart from a fix.
   */
  it('leaves the Destroy Panel control named as it already was', async () => {
    mount();
    await ready();
    const id = firstPanelId();

    expect(screen.getByTestId(`panel-close-${id}`)).toHaveAccessibleName(/ panel$/);
  });
});
