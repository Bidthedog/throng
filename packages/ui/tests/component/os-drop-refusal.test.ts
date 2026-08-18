/**
 * A file dropped on a panel from the operating system — what the RENDERER does with main's verdict
 * (018 / US9, FR-057/FR-061/FR-065; 030 FR-025).
 *
 * PLACE AT: `packages/ui/tests/component/os-drop-refusal.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/os-drop.e2e.ts` — the tests at `:200` ("a file from OUTSIDE
 * the project is visibly rejected, never a silent no-op") and `:263` ("a FOLDER is rejected; the
 * other files in the same drop still open") — 034 FR-045/FR-046.
 *
 * ══ WHY THESE TWO, AND ONLY THESE TWO ══
 *
 * `os-drop.e2e.ts` states in its own header that it does not drive an OS drag at all: six of its
 * eight tests dispatch a `throng:os-drop` CustomEvent carrying paths, because Electron 43 removed
 * `File.path` and a renderer-made `File` is not an OS file. A synthetic event dispatched at a
 * window is not the OS drag-and-drop that Principle V reserves for E2E — it is this component's own
 * documented test seam (`drop-target.tsx:24`), and this file drives the SAME seam with the SAME
 * event, one process cheaper.
 *
 * The two tests that DO build a real `DataTransfer` and dispatch real `DragEvent`s — `:365` (a
 * stray drop must not navigate the window away) and `:404` (the drag shows a COPY cursor) — are
 * untouched and stay. jsdom implements neither constructor, and the cursor test's whole method is
 * shadowing a `dropEffect` accessor Chromium refuses to honour on a hand-built transfer.
 *
 * ══ THE DECISION IS NOT MADE HERE, AND IS NOT ASSERTED HERE ══
 *
 * `drop-target.tsx:18` says it outright: the renderer says "this path was dropped on me" and MAIN
 * resolves the symlinks and applies the confinement rule. So the split is not a compromise, it is
 * where the code already put the seam:
 *
 *   WHICH VERDICT a real path gets  → `packages/ui/tests/integration/drop-resolve.integration.test.ts`
 *                                     `:93` a real directory → `reason: 'folder'`
 *                                     `:113` a real file in a real outside folder → `'out-of-tree'`
 *                                     `:99` a real oversized file → `'too-large'`
 *                                     — each against a real disk, and each asserting the REASON,
 *                                     which the E2E could not see at all: it could only tell that
 *                                     *a* notice appeared, so a refusal for the wrong reason passed.
 *   THE WORDING of each verdict     → `packages/core/tests/unit/drop-confinement.test.ts:87`
 *                                     (`expect(d.error).toMatch(/project/i)`), over the strings in
 *                                     `packages/core/src/editor/drop.ts:56-70`.
 *   WHAT THE RENDERER DOES WITH IT  → this file.
 *
 * ══ WHAT THIS FILE SAYS THAT NOTHING BELOW E2E SAID ══
 *
 *   - the refusal is RENDERED, as a notice the user can see;
 *   - the message shown is MAIN'S OWN, verbatim — the renderer neither swallows it nor substitutes
 *     a generic sentence of its own (test 1);
 *   - each refused path gets its OWN notice, because the test id carries the path and notices
 *     de-duplicate by test id (test 2). A shared id would show only the last refusal of a five-file
 *     drop, which is the defect the comment at `drop-target.tsx:74` names;
 *   - THE PER-PATH LOOP (test 3). This is the claim `:263` existed for and the one no lower test
 *     could make: `resolveDrop` is a pure function of ONE path, so a loop that abandoned the whole
 *     drop on the first refusal passes every unit and integration test in the list above while
 *     throwing away files the user plainly meant to open;
 *   - the ownership facts the panel forwards with each question (test 8) — `ownerKind` derived from
 *     `rootless`, and the roots. Main's rule is only as good as the context it is asked about, and
 *     nothing below E2E watched the renderer fill that in.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Four of the eight tests below assert that something did NOT happen, so the control matters more
 * here than usual. THE CONTROL: in `mount()`, replace
 *
 *     createElement(PanelDropTarget, { ctx, onOpen }, createElement('div', ...))
 *
 * with `createElement('div', null, createElement('div', ...))` — the subject is withheld and its
 * `window` listener is never registered. ALL EIGHT TESTS FAIL. The four negatives fail too, and
 * that is deliberate: each one dispatches a drop that MUST be ignored and then a second drop that
 * MUST land, so no test in this file can be satisfied by an empty DOM.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { OS_DROP_EVENT, PanelDropTarget, type DropContext } from '../../src/renderer/editor/drop-target.js';

/* ────────────────────────────────────────────────────────────────────────── *
 * The fixture
 * ────────────────────────────────────────────────────────────────────────── */

const PROJECT_ROOT = 'C:/projects/demo';
const OUTSIDE = 'C:/elsewhere/outside.txt';

/** The exact sentence `packages/core/src/editor/drop.ts:56` produces for a project-owned editor. */
const OUT_OF_TREE_MESSAGE =
  'That file is outside this project. Editors can only open files within their project.';
/** …and `:63`, for a folder. */
const FOLDER_MESSAGE = 'A folder cannot be opened in an editor.';

type Verdict =
  | { ok: true; absPath: string }
  | { ok: false; reason: 'out-of-tree' | 'folder' | 'too-large' | 'io' | 'not-found'; error: string };

/**
 * `window.throng.editor.resolveDrop`, answering from a table keyed by path.
 *
 * A table rather than a single canned reply, because the claim that matters most in this file is
 * about a drop whose paths get DIFFERENT answers — one refused, one accepted — and a fake that
 * gives every path the same verdict cannot express it.
 */
function fakeBridge(verdicts: Record<string, Verdict>, fallback?: () => Promise<Verdict>) {
  const asked: Record<string, unknown>[] = [];
  const resolveDrop = vi.fn((req: Record<string, unknown>) => {
    asked.push(req);
    const known = verdicts[String(req.absPath)];
    if (known) return Promise.resolve(known);
    if (fallback) return fallback();
    return Promise.reject(new Error(`the fake was not told about ${String(req.absPath)}`));
  });
  return { resolveDrop, asked };
}

const PANEL_ID = 'panel-under-test';

const projectCtx = (over: Partial<DropContext> = {}): DropContext => ({
  panelId: PANEL_ID,
  tabId: 'tab-1',
  projectRoot: PROJECT_ROOT,
  rootless: false,
  ownerProjectId: 'proj-1',
  allProjectRoots: [PROJECT_ROOT],
  ...over,
});

interface MountOptions {
  ctx?: DropContext;
  /** Omitted, no `window.throng` is installed at all — the "bridge is absent" branch. */
  bridge?: { resolveDrop: ReturnType<typeof vi.fn> };
}

/**
 * Mount the drop target inside the real notification host.
 *
 * `NotificationProvider` is the real one: it reads `useAppSettings()`, whose ConfigContext has
 * shipped defaults and therefore needs no provider (the same finding `file-tree.test.ts` records),
 * and it logs through `window.throng?.notices?.log?.()`, which is optional-chained and simply does
 * not fire here. So the notice a refusal raises goes through the application's own de-duplication,
 * suppression and rendering — not through a spy that would agree with anything.
 */
function mount(options: MountOptions = {}) {
  const onOpen = vi.fn();
  const ctx = options.ctx ?? projectCtx();

  if (options.bridge) {
    Reflect.set(window, 'throng', { editor: { resolveDrop: options.bridge.resolveDrop } });
  }

  const tree: ReactElement = createElement(
    NotificationProvider,
    null,
    // THE CONTROL: swap `PanelDropTarget` for `'div'` here and every test in this file fails.
    createElement(
      PanelDropTarget,
      { ctx, onOpen },
      createElement('div', { 'data-testid': 'panel-body' }, 'panel body'),
    ),
  );
  render(tree);
  return { onOpen, ctx };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

/**
 * Drive the drop, through the component's own documented seam.
 *
 * Wrapped in `act()` because the listener calls `setOver(false)` synchronously and then raises
 * notices from an async continuation: without it, assertions on the RENDERED notice fail while
 * assertions on the mock pass — the split this branch has already paid for once.
 */
async function drop(paths: string[], panelId: string = PANEL_ID): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent(OS_DROP_EVENT, { detail: { panelId, paths } }),
    );
  });
}

/** Every notice currently on screen. Severity `error` renders `role="alert"`. */
const notices = (): HTMLElement[] => within(screen.getByTestId('notices')).queryAllByRole('alert');

/* ────────────────────────────────────────────────────────────────────────── *
 * :200 — a refusal is SEEN
 * ────────────────────────────────────────────────────────────────────────── */

describe('a refused path is reported, never a silent no-op (FR-061, migrated from os-drop.e2e.ts:200)', () => {
  it("renders MAIN's own reason verbatim, on a notice addressed by the refused path", async () => {
    /*
     * Three claims in one, and the middle one is the reason this test is worth a mount.
     *
     * The E2E asserted `toContainText(/project/i)` — satisfied by any sentence with the word
     * "project" in it, including one the renderer made up. What is asserted here is that the string
     * MAIN sent is the string the user reads, character for character. A renderer that caught the
     * refusal and substituted "That file could not be opened" would pass a `/project/i` regex only
     * by accident and would pass no regex at all once the wording moved — and the wording is pinned,
     * one layer down, at `drop-confinement.test.ts:87`.
     */
    const bridge = fakeBridge({
      [OUTSIDE]: { ok: false, reason: 'out-of-tree', error: OUT_OF_TREE_MESSAGE },
    });
    const { onOpen } = mount({ bridge });

    await drop([OUTSIDE]);

    const notice = await screen.findByTestId(`os-drop-error-${OUTSIDE}`);
    expect(notice.querySelector('.notice__message')).toHaveTextContent(OUT_OF_TREE_MESSAGE);
    // 030 FR-025 — the notice names the file, and the folder it came from, so two files with the
    // same leaf name in one drop are told apart.
    expect(notice).toHaveTextContent('outside.txt');
    expect(notice).toHaveTextContent('elsewhere');
    // …and the panel did NOT open it. This half is what "never a silent no-op" is the other side of:
    // a refusal that also opened the file would be worse than either.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('gives every refused path in one drop its own notice', async () => {
    /*
     * `drop-target.tsx:74` explains the testId carrying the path: notices de-duplicate BY TEST ID,
     * so a shared id would collapse five refusals into one and the user would learn about the last
     * file only. Two refusals, two notices, two ids — the assertion the comment describes.
     */
    const second = 'C:/elsewhere/other.txt';
    const bridge = fakeBridge({
      [OUTSIDE]: { ok: false, reason: 'out-of-tree', error: OUT_OF_TREE_MESSAGE },
      [second]: { ok: false, reason: 'out-of-tree', error: OUT_OF_TREE_MESSAGE },
    });
    mount({ bridge });

    await drop([OUTSIDE, second]);

    await waitFor(() => expect(notices()).toHaveLength(2));
    expect(screen.getByTestId(`os-drop-error-${OUTSIDE}`)).toBeInTheDocument();
    expect(screen.getByTestId(`os-drop-error-${second}`)).toBeInTheDocument();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * :263 — the per-path loop
 * ────────────────────────────────────────────────────────────────────────── */

describe('each path is judged on its own (FR-065, migrated from os-drop.e2e.ts:263)', () => {
  it('refuses the folder and STILL opens the file that came with it', async () => {
    /*
     * THE CLAIM NOTHING BELOW E2E COULD MAKE.
     *
     * `resolveDrop` is a pure function of one candidate: `drop-confinement.test.ts` asks it about a
     * folder and about a file, separately, and both answers are right. The defect this guards is in
     * the LOOP around it — a `break`, a `return`, or an early exit on the first refusal — and every
     * test at every lower layer passes while the other four files in a five-file drop are silently
     * discarded.
     *
     * The order is deliberate: the folder comes FIRST, so an implementation that stops at the first
     * refusal fails here rather than passing by luck.
     */
    const folder = `${PROJECT_ROOT}/src`;
    const file = `${PROJECT_ROOT}/b.txt`;
    const bridge = fakeBridge({
      [folder]: { ok: false, reason: 'folder', error: FOLDER_MESSAGE },
      [file]: { ok: true, absPath: file },
    });
    const { onOpen } = mount({ bridge });

    await drop([folder, file]);

    // The folder is refused, on its own notice, in main's own words.
    const notice = await screen.findByTestId(`os-drop-error-${folder}`);
    expect(notice.querySelector('.notice__message')).toHaveTextContent(FOLDER_MESSAGE);
    // …and the file that travelled with it opened anyway.
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(onOpen).toHaveBeenCalledWith(file);
    // Exactly one refusal — the accepted file did not also raise one.
    expect(notices()).toHaveLength(1);
  });

  it('opens the path MAIN resolved, not the path that was dropped', async () => {
    /*
     * The accepted branch, and the positive control the two negatives above lean on: if nothing in
     * this file could ever open anything, "it did not open" would prove nothing.
     *
     * `onOpen(decision.absPath)` and not `onOpen(absPath)` is the whole point of resolving in main —
     * a symlink inside the project is opened as its TARGET, which is the path the save path will
     * later write to (SC-012). Handing the link back would reopen the read-scope/write-scope split
     * that `drop-resolve.integration.test.ts` exists to keep closed.
     */
    const dropped = `${PROJECT_ROOT}/link.txt`;
    const resolved = `${PROJECT_ROOT}/real.txt`;
    const bridge = fakeBridge({ [dropped]: { ok: true, absPath: resolved } });
    const { onOpen } = mount({ bridge });

    await drop([dropped]);

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(resolved));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(notices()).toHaveLength(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The routing guard, and the two ways the bridge can fail to answer
 * ────────────────────────────────────────────────────────────────────────── */

describe('a drop belongs to exactly one panel', () => {
  it('ignores a drop addressed to another panel, and takes the very next one addressed to it', async () => {
    /*
     * Both halves in ONE test on purpose. `drop-target.tsx:147` is a single early return, and every
     * panel in the window has a listener on the same event; a guard that never fired would make one
     * drop open in every editor at once. Asserting only the negative would be satisfied by a
     * component that had stopped listening altogether — which is exactly the state the anti-vacuity
     * control puts this file in.
     */
    const file = `${PROJECT_ROOT}/a.txt`;
    const bridge = fakeBridge({ [file]: { ok: true, absPath: file } });
    const { onOpen } = mount({ bridge });

    await drop([file], 'some-other-panel');
    expect(bridge.resolveDrop).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();

    await drop([file]);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(file));
  });
});

describe('the bridge failing is still not silent (FR-061)', () => {
  it('reports when the resolve call REJECTS', async () => {
    /*
     * `editor-coordinator.ts:216` records where this came from: a `stat` on a path that has gone
     * rejected across the bridge, the renderer `void`ed the promise, and the drop did nothing
     * whatever — the silent no-op arriving by the unhappy path of the unhappy path.
     */
    const file = `${PROJECT_ROOT}/gone.txt`;
    const bridge = fakeBridge({}, () => Promise.reject(new Error('pipe closed')));
    const { onOpen } = mount({ bridge });

    await drop([file]);

    const notice = await screen.findByTestId(`os-drop-error-${file}`);
    expect(notice.querySelector('.notice__message')).toHaveTextContent(
      'throng could not check whether it may be opened here.',
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('reports when the resolve call is not there at all', async () => {
    // No bridge is installed, so `window.throng?.editor?.resolveDrop?.(…)` is `undefined` and the
    // `!decision` branch runs. A preload that failed to expose the method is a real state — and one
    // where doing nothing quietly is the worst available behaviour.
    const file = `${PROJECT_ROOT}/a.txt`;
    const { onOpen } = mount();

    await drop([file]);

    expect(await screen.findByTestId(`os-drop-error-${file}`)).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * What the panel tells main about itself
 * ────────────────────────────────────────────────────────────────────────── */

describe('the panel forwards its own ownership facts with every question', () => {
  it('asks as a PROJECT editor, naming its root, its tab and every loaded root', async () => {
    /*
     * Main's rule is only as good as the context it is asked about, and this is the whole of what
     * the renderer contributes to the decision. `drop-resolve.integration.test.ts` builds that
     * request by hand; nothing below E2E watched the component fill it in.
     */
    const file = `${PROJECT_ROOT}/a.txt`;
    const bridge = fakeBridge({ [file]: { ok: true, absPath: file } });
    mount({ bridge });

    await drop([file]);

    await waitFor(() => expect(bridge.asked).toHaveLength(1));
    expect(bridge.asked[0]).toEqual({
      panelId: PANEL_ID,
      ownerKind: 'project',
      ownerProjectId: 'proj-1',
      ownerRoot: PROJECT_ROOT,
      allProjectRoots: [PROJECT_ROOT],
      tabId: 'tab-1',
      absPath: file,
    });
  });

  it('asks as a SUB-WORKSPACE editor when the panel is rootless', async () => {
    /*
     * The mirror image, and the one that inverts the rule rather than relaxing it: a sub-workspace
     * editor may open files OUTSIDE every project and no others (SC-012). Sending `'project'` for a
     * rootless panel would let it open any project's file — which loads and then refuses to save.
     */
    const file = 'C:/elsewhere/outside.txt';
    const bridge = fakeBridge({ [file]: { ok: true, absPath: file } });
    mount({
      bridge,
      ctx: projectCtx({ rootless: true, projectRoot: null, ownerProjectId: undefined }),
    });

    await drop([file]);

    await waitFor(() => expect(bridge.asked).toHaveLength(1));
    expect(bridge.asked[0].ownerKind).toBe('subworkspace');
    expect(bridge.asked[0].ownerRoot).toBeNull();
  });
});
