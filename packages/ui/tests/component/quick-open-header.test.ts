/**
 * Quick Open's HEADER ROW — the target control, the exclusion toggle, and which key opens a file.
 *
 * PLACE AT: `packages/ui/tests/component/quick-open-header.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/quick-open-target.e2e.ts` — `:177`, `:311`, `:346`, `:536`
 * and `:656` (034 FR-045).
 *
 * ══ THE SUBJECT IS THE REAL `QuickOpen`, NOT A HAND-BUILT HEADER ══
 *
 * Every test below mounts the shipped `QuickOpen` component. That matters more here than usual,
 * because the claims ARE the composition: which control the header holds, in what ORDER, inside
 * which element, and which of the two is conditional. A host that assembled `Picker`,
 * `QuickOpenHidden` and `QuickOpenTarget` itself would be asserting its own arrangement — a mirrored
 * mapping is not a covered mapping (FR-047) — and `quick-open.tsx`'s header block is precisely the
 * code that would then be untested.
 *
 * It mounts because its candidate set arrives as a PROP. `index: FileIndexView` is `{ status, paths }`
 * and is subscribed by `NavigationChrome`, one level up, so nothing here needs a file walk, a daemon
 * or a real project on disk. The only context it consumes is `useWorkspace` (for the active tab and,
 * through `QuickOpenTarget`, the destination panel's name) and `useAppSettings` — and
 * `WorkspaceProvider` is EXPORTED and takes its client as a prop, so the real provider mounts over a
 * fake `ThrongBridge` with no production change (the correction recorded in `file-tree.test.ts`).
 *
 * ══ WHY `openFileInTab` IS THE ONE THING MOCKED ══
 *
 * It is the seam, not the subject. `choose` hands it the absolute path and the target the control was
 * left on, and what it then does — reuse an editor, create one, raise the unsaved-changes prompt —
 * is `editor-open.tsx`'s and is proved end to end by the tests that STAY. Mocking it lets these
 * assertions be SHARPER than the E2E's: the migrated test could only see that some editor ended up
 * holding the file, where the call log below names the exact path and the exact `EditorOpenTarget`.
 *
 * ══ THE `offsetParent` STUB, AND WHY IT IS LOAD-BEARING ══
 *
 * `focus-trap.ts:70` filters its focusable set on `el.offsetParent !== null`, and jsdom's getter
 * returns `null` unconditionally. Without the stub the set collapses to whichever single element is
 * `document.activeElement`, every Tab reads as "at the end", and focus is pinned to the input for
 * ever — which would make the Shift+Tab tests pass or fail for reasons that have nothing to do with
 * the header. The stub is `confirm-modality.test.ts`'s, verbatim, restored the same way.
 *
 * ══ WHAT STAYS END-TO-END, AND WHY EACH ONE CANNOT COME HERE ══
 *
 *   - `:228` — the modal must not JUMP as the sentence changes length (`boundingBox()` compared
 *     before and after the toggle). jsdom has no layout engine, so that assertion has no meaning
 *     here at any fidelity (034 FR-049). Its WORDING half is re-proved below as a strengthening,
 *     not as a replacement: `:228` keeps its declaration.
 *   - `:422` / `:480` — the one-buffer rule across two editor panels and across two tabs. Those are
 *     `openFileInTab`'s decisions, which is the function mocked here.
 *   - `:602` — the two hiding mechanisms. That needs a real `explorer.excludeGlobs` walk and a real
 *     per-project hidden set written through the tree's context menu.
 *   - `:708` — the list surviving the flip between two live subscriptions. Both indices are real
 *     main-process walks; `index` is a prop here.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * In `mount()` below, drop the `WorkspaceProvider` wrapper — render `QuickOpen` inside nothing.
 * `useWorkspace` throws (`state/workspace-store.tsx:375`, "must be used within a WorkspaceProvider"),
 * so the component never renders and nothing is on screen to assert about. **That fails ALL 19 tests
 * in this file** — every one of them goes through `mount()`, which awaits the query input before a
 * test body begins. Nothing here can pass against an empty document.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorOpenTarget, WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { removeEditorState, setEditorState } from '../../src/renderer/editor/editor-state.js';
import { QuickOpen } from '../../src/renderer/navigate/quick-open.js';

/* ────────────────────────────────────────────────────────────────────────── *
 * The one mocked module — the seam, not the subject. See the header.
 * ────────────────────────────────────────────────────────────────────────── */

/*
 * Declared with `vi.hoisted` because `vi.mock` is hoisted above the imports, and a factory closing
 * over an ordinary `const` would read it before it exists.
 *
 * The factory names ONE export rather than spreading the real module: `quick-open.tsx` imports only
 * `openFileInTab` from it, and pulling the original in would drag `EditorOpenListener` and its whole
 * dependency graph into a test that has no use for either. If a second export is ever needed here,
 * the failure is a loud "does not provide an export", not a silent `undefined`.
 */
const openFileInTab = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../../src/renderer/editor/editor-open.js', () => ({ openFileInTab }));

/* ────────────────────────────────────────────────────────────────────────── *
 * The stubbed visibility test — jsdom returns null for every element.
 * ────────────────────────────────────────────────────────────────────────── */

let realOffsetParent: PropertyDescriptor | undefined;

beforeAll(() => {
  realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    // "Rendered, and not inside a display:none subtree" — true of every attached element in a jsdom
    // document that hides nothing. `null` for a detached one, exactly as a browser.
    get(this: HTMLElement): Element | null {
      return this.parentElement;
    },
  });
});

afterAll(() => {
  if (realOffsetParent) {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', realOffsetParent);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
  }
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Fixtures
 * ────────────────────────────────────────────────────────────────────────── */

const PROJECT = 'proj-1';
const TAB = 'tab-1';
const EDITOR_PANEL = 'panel-1';
/** POSIX and absolute, as `NavigationChrome` resolves a project root. */
const ROOT = 'C:/proj';
/** The file the editor panel holds — so `panelDisplayTitle` names the panel "README". */
const OPEN_FILE = `${ROOT}/README.md`;

/**
 * The candidate set, as `useFileIndex` mirrors it: root-relative POSIX paths, already walked.
 *
 * Four files rather than one. "The control opened nothing" is a much weaker statement against a list
 * with nothing in it to open, and a query that narrows to exactly one row is what makes the Enter
 * assertions about WHICH row rather than about there having been a row at all.
 */
const PATHS = ['README.md', 'docs/guide.md', 'src/app.ts', 'src/util.ts'];

/** One tab holding one editor panel — the context FR-011 makes the target control conditional on. */
function layout(): WorkspaceLayout {
  return {
    projectId: PROJECT,
    schemaVersion: 1,
    activeTabId: TAB,
    tabs: [
      {
        id: TAB,
        title: 'Tab',
        activePanelId: EDITOR_PANEL,
        root: {
          type: 'panel',
          id: EDITOR_PANEL,
          originProjectId: PROJECT,
          title: 'Panel 1',
          kind: 'editor',
          config: { filePath: OPEN_FILE },
        },
      },
    ],
  };
}

/**
 * A fake daemon at the BRIDGE, exactly where `subworkspace-sync.test.ts` and
 * `project-settings-dialog.test.ts` put theirs.
 *
 * Anything this path does not legitimately call is rejected by NAME rather than resolved to
 * `undefined`: a silently-answered unexpected RPC is how a test starts passing against a component
 * that has begun doing something else entirely.
 */
function fakeBridge(): ThrongBridge {
  return {
    invoke<TResult>(method: string): Promise<TResult> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout: layout(), restored: true } as unknown as TResult);
        case 'workspace.save':
          return Promise.resolve({ ok: true } as unknown as TResult);
        default:
          return Promise.reject(new Error(`unexpected RPC from Quick Open's header: ${method}`));
      }
    },
  };
}

/**
 * Hold the modal back until the settings document has actually landed.
 *
 * `QuickOpenTarget` takes its preselection through `useState(initial)`, which is read ONCE at mount
 * — deliberately, because the control is a choice for this invocation rather than a live mirror of
 * the preference. `ConfigProvider` pulls asynchronously and renders the shipped defaults first, so
 * a modal mounted alongside it would be preselected from the defaults and would never notice the
 * real document arriving.
 *
 * That is not a quirk of this test: it is what the application does. Settings are live long before
 * any chord is pressed, and the modal mounts per invocation. The gate models that, and without it
 * the `openTarget: 'new'` test would fail for a reason that has nothing to do with the control.
 */
function WhenSettingsAreLive({ children }: { children: ReactNode }): ReactElement | null {
  return useConfigLoaded() ? createElement('div', null, children) : null;
}

interface MountOptions {
  /** `null` is the chord arriving from a terminal, the tree or a placeholder (FR-011). */
  invokedFrom?: { editorPanelId: string } | null;
  /**
   * A settings document served through the real `ConfigProvider`. Omitted, no provider is mounted
   * and ConfigContext's SHIPPED defaults apply — which is the state T2's default case is about.
   */
  settings?: Record<string, unknown>;
}

async function mount(options: MountOptions = {}) {
  const user = userEvent.setup();
  const onDismiss = vi.fn();
  const onIncludeHiddenChange = vi.fn();

  if (options.settings) {
    Reflect.set(window, 'throng', {
      config: {
        get: () => Promise.resolve({ settings: options.settings }),
        onChange: () => () => {},
      },
    });
  }

  // The editor panel really holds a file, so the destination sentence names it the way the panel
  // header does — `panelDisplayTitle` reads the live editor state first and the panel config second.
  setEditorState(EDITOR_PANEL, { filePath: OPEN_FILE, displayName: 'README.md' });

  const subject = createElement(QuickOpen, {
    root: ROOT,
    index: { status: 'ready', paths: PATHS },
    invokedFrom:
      options.invokedFrom === undefined ? { editorPanelId: EDITOR_PANEL } : options.invokedFrom,
    includeHidden: false,
    onIncludeHiddenChange,
    onDismiss,
  });

  const wrapped: ReactElement = createElement(
    WorkspaceProvider,
    { client: new WorkspaceClient(fakeBridge()), activeProjectId: PROJECT },
    options.settings ? createElement(WhenSettingsAreLive, null, subject) : subject,
  );

  render(options.settings ? createElement(ConfigProvider, null, wrapped) : wrapped);

  /*
   * Wait for the input rather than assuming it. This is the assertion the anti-vacuity control in
   * the header trips: with no `WorkspaceProvider`, `useWorkspace` throws and nothing renders at all.
   */
  const input = await screen.findByTestId('quickopen-input');
  return { user, input, onDismiss, onIncludeHiddenChange };
}

beforeEach(() => {
  openFileInTab.mockClear();
  openFileInTab.mockResolvedValue(true);
});

afterEach(() => {
  removeEditorState(EDITOR_PANEL);
  Reflect.deleteProperty(window, 'throng');
});

const target = (): HTMLElement => screen.getByTestId('quickopen-target');
const hidden = (): HTMLElement => screen.getByTestId('quickopen-hidden');
const rows = (): HTMLElement[] =>
  Array.from(
    screen.getByTestId('quickopen-list').querySelectorAll('[data-testid^="quickopen-row-"]'),
  );

/** What holds the keyboard, by test id — named rather than boolean, so a pinned trap is visible. */
const focused = (): string =>
  document.activeElement?.getAttribute('data-testid') ??
  document.activeElement?.tagName.toLowerCase() ??
  'nothing';

const insideModal = (): boolean =>
  document.activeElement?.closest('[data-testid="quickopen"]') != null;

/**
 * The destination sentence, once the workspace layout has landed.
 *
 * `QuickOpenTarget` reads the panel out of `ws.layout`, which arrives one microtask after mount —
 * before it does, the sentence legitimately drops the parenthesis because there is no panel to name.
 * Waiting for the named form is what stops a race being read as a missing name.
 */
async function namedDestination(): Promise<HTMLElement> {
  return waitFor(() => {
    const label = screen.getByTestId('quickopen-target-label');
    expect(label.textContent ?? '').toContain('(README)');
    return label;
  });
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * `:177` — the shape of the header, and where the keyboard starts
 * ══════════════════════════════════════════════════════════════════════════ */

describe('invoked from inside an editor (AS-11, AS-11a, T1–T3, T6, P7, P8, E3)', () => {
  it('draws the target control (T3, FR-011)', async () => {
    await mount();
    expect(target()).toBeVisible();
  });

  it('puts it ABOVE the input, which is what makes Shift+Tab reach it (P7)', async () => {
    await mount();

    /*
     * DOM order, not pixels — deliberately, and the migrated test says so too. "Above" is a claim
     * about tab order here: the control being first is the whole mechanism behind E5 below.
     */
    const order = Array.from(
      screen.getByTestId('quickopen').querySelectorAll('[data-testid]'),
    ).map((el) => el.getAttribute('data-testid') ?? '');

    expect(order).toContain('quickopen-target');
    expect(order.indexOf('quickopen-target')).toBeLessThan(order.indexOf('quickopen-input'));
  });

  it('opens preselected from `editor.openTarget`, which is `lastActive` at the shipped default (T2)', async () => {
    await mount();
    expect(target()).toHaveAttribute('data-value', 'lastActive');
  });

  it('carries a hover title naming BOTH the current value and the alternative (T6)', async () => {
    /*
     * Stronger than the migrated assertion, which only required the title to be non-empty. The
     * constitution asks for a hover title naming what pressing it DOES, and a title that recited
     * only the current destination would satisfy "not empty" while telling the user nothing about
     * the choice — which is the exact defect FR-068 was raised for on the visible label.
     */
    await mount();

    const title = target().getAttribute('title') ?? '';
    expect(title).toContain('the currently active editor');
    expect(title).toContain('a new editor panel in this tab');
  });

  it('starts with the caret in the query field, and TYPING goes there (AS-11a, P8)', async () => {
    const { user, input } = await mount();
    expect(input).toHaveFocus();

    await user.keyboard('guide');

    expect(input).toHaveValue('guide');
    // …and the control did not quietly answer any of those keystrokes.
    expect(target()).toHaveAttribute('data-value', 'lastActive');
    expect(rows().map((r) => r.getAttribute('data-testid'))).toEqual([
      'quickopen-row-docs/guide.md',
    ]);
  });

  it('Tab cycles through the header and never leaves the modal (E3, P7)', async () => {
    /*
     * The SEQUENCE, not merely containment. The migrated test asked only "is focus still somewhere
     * inside" after each Tab — which a trap that pinned focus to one element satisfies perfectly,
     * and which is exactly the degenerate behaviour a missing `offsetParent` stub produces here.
     */
    const { user } = await mount();

    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await user.tab();
      seen.push(focused());
      expect(insideModal(), `Tab #${i + 1} escaped the modal — focus on ${focused()}`).toBe(true);
    }

    expect(seen).toEqual(['quickopen-hidden', 'quickopen-target', 'quickopen-input']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * `:311` — Shift+Tab and Space
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Shift+Tab reaches the control and Space changes it (AS-11b, T4, E5)', () => {
  it('Shift+Tab from the query input lands on the target control', async () => {
    const { user } = await mount();

    await user.tab({ shift: true });

    expect(target()).toHaveFocus();
  });

  it('Space toggles the value, opens nothing and dismisses nothing', async () => {
    const { user, onDismiss } = await mount();

    // A row is highlighted throughout: "Space opened nothing" says far less against an empty list.
    await user.keyboard('README');
    expect(rows()).toHaveLength(1);

    await user.tab({ shift: true });
    expect(target()).toHaveFocus();

    await user.keyboard(' ');
    expect(target()).toHaveAttribute('data-value', 'new');
    expect(openFileInTab).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('quickopen')).toBeVisible();

    // …and it TOGGLES, rather than only ever moving one way.
    await user.keyboard(' ');
    expect(target()).toHaveAttribute('data-value', 'lastActive');
    expect(openFileInTab).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * `:346` — E1: which Enter opens a file
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Enter is claimed only from the query input (AS-11c, E1, FR-010b)', () => {
  it('Enter ON THE CONTROL changes its value and opens nothing', async () => {
    const { user, onDismiss } = await mount();

    await user.keyboard('README');
    expect(rows()).toHaveLength(1);

    await user.tab({ shift: true });
    expect(target()).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(target()).toHaveAttribute('data-value', 'new');
    expect(openFileInTab, 'Enter on the header control opened a file').not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('quickopen')).toBeVisible();
  });

  it('Enter IN THE INPUT opens the highlighted row, at the path and target the control was left on', async () => {
    /*
     * Sharper than the migrated test, which could only see that SOME editor ended up holding the
     * file. What `choose` actually promises is Q1 — the absolute path is this window's own root plus
     * the relative path, and nothing else — and FR-008's "one call for both target values". Both are
     * read off the call, so a route that reached past `openFileInTab` for the `new` branch (the
     * defect `quick-open.tsx` records at length) would fail here rather than pass on a count.
     */
    const { user, input, onDismiss } = await mount();

    await user.keyboard('README');
    expect(rows()).toHaveLength(1);

    // Leave the control on "a new editor panel" by the KEYBOARD route, so focus comes back to the
    // input — a click on the header would move focus out of it and the Enter below would be
    // answered by the control, which is the very thing this test is about.
    await user.tab({ shift: true });
    await user.keyboard(' ');
    expect(target()).toHaveAttribute('data-value', 'new');
    await user.tab();
    expect(input).toHaveFocus();

    await user.keyboard('{Enter}');

    // Q5 — the modal's job ends with the choice, and it closes BEFORE the open is routed.
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(openFileInTab).toHaveBeenCalledTimes(1));
    const call = openFileInTab.mock.calls[0] as unknown as [
      unknown,
      string,
      string,
      EditorOpenTarget,
    ];
    expect(call[1], 'the open was routed to the wrong tab').toBe(TAB);
    expect(call[2], 'Q1 — the absolute path is this window’s root plus the relative path').toBe(
      `${ROOT}/README.md`,
    );
    expect(call[3], 'the control’s value did not reach the router').toBe('new');
  });

  it('with no target control the invocation follows the SETTING, not a control that is not there', async () => {
    /*
     * FR-011's other half, and the branch `invokedFrom === null ? openTarget : target.current`
     * chooses. Nothing else at any layer reads that ternary.
     */
    const { user } = await mount({ invokedFrom: null });

    await user.keyboard('README');
    expect(rows()).toHaveLength(1);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(openFileInTab).toHaveBeenCalledTimes(1));
    expect((openFileInTab.mock.calls[0] as unknown as unknown[])[3]).toBe('lastActive');
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * `:536` — the preselection follows the setting
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the preselection is the SETTING, read live (T2)', () => {
  it('opens on the new-panel option when `editor.openTarget` is `new`', async () => {
    /*
     * The migrated test spent a second Electron launch and a seeded config root on this one
     * attribute, because the setting is read at startup by the real app. Here the real
     * `ConfigProvider` reads the same document through `window.throng.config.get`.
     *
     * `waitFor`, because the provider pulls the settings asynchronously and mounts on the shipped
     * defaults first — asserting immediately would read `lastActive` and pass for the wrong reason
     * in the direction that looks like a defect.
     */
    await mount({ settings: { version: 1, editor: { openTarget: 'new' } } });

    await waitFor(() => expect(target()).toHaveAttribute('data-value', 'new'));
    expect(screen.getByTestId('quickopen-target-label')).toHaveTextContent(
      'Will open in a new editor',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * `:656` — the two header controls, and which of them is conditional
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the header row holds two controls, and only one of them is conditional (FR-069)', () => {
  it('draws both as siblings in ONE `.picker__header`', async () => {
    await mount();

    const header = target().closest('.picker__header');
    expect(header, 'the target control is not inside a `.picker__header`').not.toBeNull();
    expect(
      hidden().closest('.picker__header'),
      'the two header controls are not siblings in one row',
    ).toBe(header);
  });

  it('gives the exclusion toggle a hover title naming its state AND the action', async () => {
    await mount();

    const title = hidden().getAttribute('title') ?? '';
    expect(title).toContain('Leaving out files this project hides');
    expect(title).toContain('press to show them');
    expect(hidden()).toHaveAttribute('data-value', 'exclude');
  });

  it('draws the toggle even when the target control is NOT drawn (FR-011 vs FR-069)', async () => {
    /*
     * The header used to be built as a whole only when the chord came from an editor, so a toggle
     * inside it silently vanished for every invocation from the tree or a terminal — which is most
     * of them.
     */
    await mount({ invokedFrom: null });

    expect(screen.queryByTestId('quickopen-target')).toBeNull();
    expect(hidden()).toBeVisible();
    expect(hidden()).toHaveAttribute('data-value', 'exclude');
  });

  it('reports a flip UPWARDS rather than holding a value of its own', async () => {
    // The toggle selects WHICH INDEX the window mirrors, so `NavigationChrome` owns the value. A
    // copy held in the control would be a second source of truth for a question main is answering.
    const { user, onIncludeHiddenChange } = await mount();

    await user.click(hidden());

    expect(onIncludeHiddenChange).toHaveBeenCalledWith(true);
    // …and it did NOT flip itself: the prop is still `false`, so the control still says `exclude`.
    expect(hidden()).toHaveAttribute('data-value', 'exclude');
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * A STRENGTHENING, not a replacement — `:228` keeps its declaration (see the header)
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the control says where the file will land IN WORDS (SC-020, FR-068)', () => {
  it('names the destination panel by the file it holds', async () => {
    await mount();

    const label = await namedDestination();
    expect(label).toHaveTextContent('Will open in the active editor (README)');
  });

  it('is ONE click target — the icon and the words inside a single button', async () => {
    await mount();
    await namedDestination();

    const button = target();
    expect(button.tagName).toBe('BUTTON');
    expect(button.querySelectorAll('button')).toHaveLength(0);
    expect(button.querySelectorAll('.icon')).toHaveLength(1);
    expect(
      within(button).getByTestId('quickopen-target-label'),
      'the label is not inside the button',
    ).toBeVisible();
  });

  it('clicking the WORDS operates it, and the sentence follows the value both ways', async () => {
    // The assertion FR-068 is actually about: an icon with a label BESIDE it passes every other
    // check in this file and fails here.
    const { user } = await mount();
    await namedDestination();

    await user.click(screen.getByTestId('quickopen-target-label'));
    expect(target()).toHaveAttribute('data-value', 'new');
    expect(target()).toHaveTextContent('Will open in a new editor');
    expect(target()).not.toHaveTextContent('active editor');

    await user.click(screen.getByTestId('quickopen-target-label'));
    expect(target()).toHaveAttribute('data-value', 'lastActive');
    expect(target()).toHaveTextContent('Will open in the active editor (README)');
  });
});
