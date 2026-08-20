/**
 * 033 US1 (#219) — Quick Open's cost, and the index staying current.
 *
 * Covers SC-002's ARCHITECTURAL half (no keystroke touches the filesystem), FR-013's ceiling as it
 * is felt through Electron, FR-015 (a modal opened before enumeration finishes) and FR-016 / SC-005
 * (the candidate set tracks the disk while the app runs).
 *
 * ══ WHY THIS SPEC IS SERIAL (T027), AND WHY THE TIMED CASES LIVE HERE ══
 *
 * Two of the assertions below have a WALL-CLOCK CEILING, and contention breaks a wall-clock ceiling
 * without anything having regressed — measured elsewhere in this suite at 2039 ms against a 2000 ms
 * budget with six workers, where 1200 ms of it was grace by design. So this file runs at one worker,
 * and SC-005's two-second case was moved OUT of `quick-open.e2e.ts` into it for exactly that reason:
 * that spec is registered parallel on the express grounds that it asserts no ceiling.
 *
 * ══ THE TWO NUMBERS ARE NOT THE SAME NUMBER ══
 *
 * SC-002 says 100 ms. That is measured over the PURE pipeline — `compileQuery` → filter →
 * `rankFilePath` → `rankStable` → cap — at the unit layer, over 50,000 synthetic paths (T008). The
 * ceiling asserted here is 250 ms, deliberately looser, because this measurement additionally
 * carries Electron IPC, a React render and a paint. It is stated rather than omitted: a measurement
 * with no threshold asserts nothing at all, and would pass on an implementation that took a second.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  settle,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';
import { openQuickOpen, quickOpenRows } from './helpers/navigation.js';

/*
 * ONE app for this file. No test here seeds state before launch — each builds its own project — and
 * an Electron launch per test would be pure cost on a file that is already the slowest in the
 * feature. The shim refuses options rather than ignoring them.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;

/**
 * ONE large fixture for the whole file, built once.
 *
 * Two tests need a project big enough to be worth measuring and a third needs one big enough that
 * ENUMERATING it outlasts a keypress (FR-015). Building it per test would spend most of the file's
 * wall-clock writing files, and the three tests do not modify it — only the live-index test writes,
 * and it has its own small tree for exactly that reason.
 */
const BIG_TREE_DIRS = 60;
const BIG_TREE_FILES_PER_DIR = 200; // 12,000 files
let bigRoot = '';

function createBigTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-qop-big-'));
  for (let d = 0; d < BIG_TREE_DIRS; d += 1) {
    const dir = join(root, 'src', `area-${String(d).padStart(3, '0')}`, 'components');
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < BIG_TREE_FILES_PER_DIR; f += 1) {
      const name = `widget-${String(f).padStart(4, '0')}.ts`;
      writeFileSync(join(dir, name), `// ${name}\n`);
    }
  }
  return root;
}

test.beforeAll(async () => {
  bigRoot = createBigTree();
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
  if (bigRoot !== '') cleanupTemp(bigRoot);
  if (smallRoot !== '') cleanupTemp(smallRoot);
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

let projectSeq = 0;
const createProject = (win: Page, name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

/** The name the big fixture's project is opened under, once, by the first test that needs it. */
const BIG_PROJECT = 'QOPerfBig';

/**
 * A tiny second project, existing only to be SWITCHED TO.
 *
 * Leaving the big root drops its last subscriber and UI main disposes the index (S9), so coming back
 * re-walks all twelve thousand files from nothing — which is the in-flight walk FR-015 is about.
 *
 * This used to be a side effect of the test that ran before the S3 one, and that test moved down a
 * layer (035 T038). The dependency was never written down as a requirement of the S3 test; it was
 * described in its header as a happy fact about its neighbour, and removing the neighbour broke it.
 * Owning the precondition here is what stops that happening to the next person.
 */
const SMALL_PROJECT = 'QOPerfSmall';
let smallRoot = '';

function createSmallTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-qop-small-'));
  writeFileSync(join(root, 'anchor.txt'), '// anchor\n');
  return root;
}
let bigProjectOpen = false;

/**
 * Open the big fixture as a project — ONCE for the whole file — and hand back the moment it lands.
 *
 * ══ WHY IT CANNOT BE OPENED PER TEST ══
 *
 * A project's root folder is EXCLUSIVE (FR-029, `assertFolderExclusive`): two projects may not share
 * a root, nor may one be inside the other. Three tests here each want the same 12,000-file fixture,
 * so the second `createProject` on that root is refused outright — the row never appears and the
 * failure surfaces as a harness timeout naming a project item, which reads as a slow app rather than
 * as a rule being enforced.
 *
 * ══ WHY THE FR-015 TEST GOES FIRST ══
 *
 * Opening the project is what starts the walk, and FR-015 is about a modal opened while that walk is
 * still in flight — so the test that observes the building state has to be the one that opens it.
 * The order is load-bearing, and this helper makes it visible: whichever test calls first pays for
 * the walk, and the file is ordered so that is the FR-015 test.
 */
async function useBigProject(win: Page): Promise<void> {
  if (bigProjectOpen) {
    await expect(win.locator('.project-item[data-active="true"]')).toContainText(BIG_PROJECT);
    return;
  }
  bigProjectOpen = true;
  await createProject(win, BIG_PROJECT, bigRoot);
}

/**
 * Record every `files.*` and `fileIndex.*` message the renderer sends, from the MAIN process.
 *
 * ══ WHY NOT IN THE PAGE, WHICH IS WHERE THE PLAN ASKED FOR IT ══
 *
 * Because it cannot be done there, and that was measured rather than assumed. `contextBridge`
 * exposes `window.throng` as a non-configurable, non-writable property whose namespace objects are
 * FROZEN — `Object.isFrozen(window.throng.files) === true`, and every one of the eighteen
 * assignments needed to wrap them is a silent no-op in a page that is not in strict mode. An
 * in-page recorder therefore installs successfully, records nothing, and reports "zero IPC calls"
 * about an application that made plenty. It is the exact shape of guard #244 exists to name, and it
 * would have passed for the wrong reason forever.
 *
 * The main process is the other end of the same wire, so it sees the same traffic:
 *
 *   - `invoke` channels live in `ipcMain._invokeHandlers`, keyed by channel. This is INTERNAL, and
 *     that is the reason for the return value: the caller asserts that the channels it cares about
 *     were actually found, so an Electron upgrade that renames the map fails this test loudly
 *     rather than making it vacuous.
 *   - `send` channels are ordinary EventEmitter events, so an extra listener is public API and
 *     rides alongside the real one.
 *
 * Only renderer → main traffic is recorded, which is the right half: FR-013 is about a KEYSTROKE
 * causing IPC, and an index update arriving from main while the user types was not caused by the
 * keystroke.
 */
async function instrumentMainIpc(
  app: OpenApp['app'],
): Promise<{ invoke: string[]; send: string[] }> {
  return app.evaluate(({ ipcMain }) => {
    const g = globalThis as unknown as { __ipcCalls?: string[] };
    g.__ipcCalls = [];
    const watched = /^throng:(files|fileIndex):/;
    const invoke: string[] = [];
    const send: string[] = [];

    const handlers = (
      ipcMain as unknown as {
        _invokeHandlers?: Map<string, (...args: unknown[]) => unknown>;
      }
    )._invokeHandlers;
    if (handlers) {
      for (const [channel, handler] of [...handlers]) {
        if (!watched.test(channel)) continue;
        handlers.set(channel, (...args: unknown[]) => {
          g.__ipcCalls!.push(channel);
          return handler(...args);
        });
        invoke.push(channel);
      }
    }

    for (const channel of ipcMain.eventNames()) {
      if (typeof channel !== 'string' || !watched.test(channel)) continue;
      ipcMain.on(channel, () => {
        g.__ipcCalls!.push(channel);
      });
      send.push(channel);
    }

    return { invoke, send };
  });
}

/** What the renderer has asked main to do since the last reset. */
const ipcCalls = (app: OpenApp['app']): Promise<string[]> =>
  app.evaluate(() => (globalThis as unknown as { __ipcCalls?: string[] }).__ipcCalls ?? []);

const resetIpcCalls = (app: OpenApp['app']): Promise<void> =>
  app.evaluate(() => {
    (globalThis as unknown as { __ipcCalls: string[] }).__ipcCalls = [];
  });

/**
 * Wait until the application has stopped talking to main of its own accord, then clear the log.
 *
 * ══ WHY THE MEASUREMENT WINDOW HAS TO BE EARNED ══
 *
 * Opening a project starts work that outlives the assertions that follow it: the explorer tree
 * settles, a watcher arms, and a `throng:files:list` lands a couple of hundred milliseconds later.
 * Measured with an instrumented probe against this very fixture: with the modal open and **nothing
 * typed at all**, one `throng:files:list` still arrived ~215 ms after a reset; with the twelve
 * characters typed, the log was EMPTY. So the call was never on the keystroke path — it was
 * background traffic that happened to land inside a window opened too early, and a reset taken at an
 * arbitrary moment charges the keyboard for it.
 *
 * Quiet is waited for as a CONDITION — two consecutive reads with the log unchanged — rather than
 * slept for, so the test costs what the machine costs and does not encode a duration that stops
 * being true on a loaded runner.
 */
async function quietThenReset(app: OpenApp['app']): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = (await ipcCalls(app)).length;
        await new Promise((resolve) => setTimeout(resolve, 400));
        return (await ipcCalls(app)).length === before;
      },
      { message: 'the application never stopped making files.* calls of its own accord' },
    )
    .toBe(true);
  await resetIpcCalls(app);
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── */

test('typing performs no IPC at all — no files.* call and no fileIndex subscription on the keystroke path (SC-002, FR-013, R5)', { tag: ['@extended', '@editor', '@reserve:runtime'] }, async () => {
  // 12,000 files to write, a project to open and a walk to complete before the measurement starts.
  test.setTimeout(180_000);
  await runApp(async (app, win) => {
    await settle(win);

    /*
     * INSTRUMENT FIRST — before the project, so the recorder can be proved to RECORD.
     *
     * `throng:files:list` is shipped and definitely registered, so requiring it in the attach report
     * is a statement about the instrument rather than about this feature: if the internal handler
     * map is ever renamed, this line fails and names it.
     */
    const attached = await instrumentMainIpc(app);
    expect(attached.invoke, 'the IPC recorder never found the shipped files channels').toContain(
      'throng:files:list',
    );

    await useBigProject(win);

    /*
     * …and the recorder demonstrably RECORDS. Opening a project reads the tree, which is `files.*`
     * traffic by construction. Without this line, an "empty array" at the end would be equally
     * consistent with a keystroke that did no IPC and with a recorder that was never wired to
     * anything — and those are the two worlds this test exists to tell apart.
     */
    await expect
      .poll(async () => (await ipcCalls(app)).some((c) => c.startsWith('throng:files:')))
      .toBe(true);

    await openQuickOpen(win);
    // Let the index settle to a real list first: the subscription itself is IPC and is entirely
    // legitimate (S2). What FR-013 forbids is IPC on the KEYSTROKE path.
    await expect(quickOpenRows(win).first()).toBeVisible();
    // …and only once the app has gone quiet is the window this assertion measures a window the
    // KEYBOARD is responsible for. See `quietThenReset`.
    await quietThenReset(app);

    await win.keyboard.type('components/w');
    await expect(quickOpenRows(win).first()).toBeVisible();

    expect(await ipcCalls(app), 'a keystroke reached the filesystem').toEqual([]);

    await win.keyboard.press('Escape');
    await expect(win.getByTestId('quickopen')).toHaveCount(0);
  });
});

/*
 * REMOVED 2026-08-18 (034 FR-018, SC-007): "keystroke-to-list stays inside its stated ceiling".
 *
 * It asserted `Math.max(...samples) <= 250` for a keystroke measured inside the page, and the 250
 * was a locally invented allowance — 033 SC-002 states 100 ms over the pure pipeline, and the extra
 * 150 was described in the deleted comment as room for "IPC, a React render and a paint". No reading
 * of the requirement produces the number, which is exactly what FR-018 forbids.
 *
 * The stronger reason is that 033 had already established the number could not work HERE. Its own
 * SC-002 was RESTATED by FR-073 after a hard 100 ms line at the UNIT tier reported 102.5, 105.1,
 * 105.3 and 147.0 ms across four runs with no code change between them — contention, not the
 * pipeline. A wall-clock line that is unfalsifiable at the cheapest, quietest layer cannot become
 * falsifiable by being moved to the most contended one; it can only become slower to disprove.
 *
 * What the claim rests on now, all of it stricter than a stopwatch:
 *   - `core/tests/unit/quick-open-budget.test.ts` — the pipeline over 50,000 paths, in the terms
 *     FR-073 restated SC-002 into.
 *   - The test ABOVE — a keystroke performs no IPC at all (FR-013). That is the property the
 *     latency ceiling was standing in for, and it is falsifiable on any machine at any load.
 *
 * Nothing measured here is left unasserted; only the stopwatch is gone.
 */

/*
 * PLACED HERE, and the position is load-bearing in two directions.
 *
 * It needs the big project ACTIVE and its standing index already warm, which is what the test above
 * leaves behind. And it must not come after the live-index test, because the final test in this file
 * depends on that one having switched away — leaving the big root's index disposed, so that
 * switching back re-walks. Sitting between them satisfies both.
 */
test('flipping the exclusion toggle on a large project SAYS it is still listing before it widens the list (FR-069d)', { tag: ['@extended', '@editor'] }, async () => {
  test.setTimeout(180_000);
  await runApp(async (_app, win) => {
    await settle(win);
    await useBigProject(win);

    await openQuickOpen(win);
    // The standing subscription is warm, so the modal opens with a list and no waiting state — the
    // baseline this test's claim is measured against.
    await expect(win.getByTestId('quickopen-building')).toHaveCount(0);
    await expect(quickOpenRows(win).first()).toBeVisible();

    /*
     * ══ WHAT FR-069d ACTUALLY REQUIRES, AND WHAT THIS ASSERTION USED TO SAY INSTEAD ══
     *
     * The prohibition is on presenting a PARTIAL list as though it were whole. This test used to
     * read that as "there are no rows while it builds" and asserted `toHaveCount(0)` — which was a
     * true description of the code on the day it was written and is not the behaviour the feature
     * wants. Emptying the list is the reported flash (`quick-open-target.e2e.ts` owns that half), so
     * the modal now BORROWS the previous, narrower list while the wider index builds.
     *
     * A borrowed list is a partial list. What makes it legitimate rather than a lie is that the
     * "Still listing this project's files…" line stands over it the whole time — so the two things
     * this samples are the rows AND the line, in one read, because either alone passes against a
     * broken build: the line with no rows is the old blink, and the rows with no line are the
     * silent partial list.
     */
    await win.getByTestId('quickopen-hidden').click();
    await expect(win.getByTestId('quickopen-hidden')).toHaveAttribute('data-value', 'include');
    await expect
      .poll(
        async () =>
          win.evaluate(() => ({
            listing: document.querySelector('[data-testid="quickopen-building"]') !== null,
            rows: document.querySelectorAll('[data-testid^="quickopen-row-"]').length > 0,
          })),
        {
          timeout: 10_000,
          message:
            'the flipped toggle never showed rows and the "still listing" line at the same moment — ' +
            'either the list blinked empty, or a narrower list was served with nothing saying so',
        },
      )
      .toEqual({ listing: true, rows: true });

    await expect(win.getByTestId('quickopen-building')).toHaveCount(0, { timeout: 60_000 });
    /*
     * `fill`, not `keyboard.type` — the toggle was CLICKED, so it holds focus.
     *
     * Typing after a click would go to the button and change nothing, and the list would still be
     * showing its uncapped default: two hundred rows, the FR-014 cap. Which is exactly what this
     * assertion caught the first time it ran, reported as `Expected: 60, Received: 200`. Worth the
     * note, because "200" reads like a truncation bug rather than a test that typed into a button.
     */
    await win.getByTestId('quickopen-input').fill('widget-0001');
    await expect(quickOpenRows(win)).toHaveCount(BIG_TREE_DIRS);

    // Back to the setting's value: the standing index is still there, so this costs no walk at all.
    await win.getByTestId('quickopen-input').fill('');
    await win.getByTestId('quickopen-hidden').click();
    await expect(win.getByTestId('quickopen-hidden')).toHaveAttribute('data-value', 'exclude');
    await expect(win.getByTestId('quickopen-building')).toHaveCount(0);

    await win.keyboard.press('Escape');
    await expect(win.getByTestId('quickopen')).toHaveCount(0);
  });
});

/*
 * ONE TEST REMOVED (035 T038) — "a file created and then deleted OUTSIDE throng becomes, and stops
 * being, choosable within two seconds", now split across two files that already existed and one that
 * did not:
 *
 *   - **the delta arrives within SC-005's two seconds** —
 *     `integration/project-file-index.integration.test.ts`, against a real watcher and a real
 *     filesystem ("a create, a rename and a delete each reach the subscriber as a delta within two
 *     seconds");
 *   - **the fold is applied correctly** — `core/tests/unit/file-index-view.test.ts`, ten cases;
 *   - **the window MIRRORS the push** — `component/use-file-index.test.ts`, which did not exist.
 *
 * That third file is the reason this could not simply be deleted against the first two. Both sides
 * of `useFileIndex` were well covered and the hook itself was covered by nothing, so every rule in
 * its own comments — which pushes belong to this subscription, when a bare `building` is a walk
 * starting rather than main disowning the index, whether a flag change may keep the list it has —
 * was load-bearing and untested. The integration test proves the delta is SENT; nothing proved the
 * window did anything with it.
 *
 * Red-proven against five mutations, each caught by the test that should catch it: ignore-flag,
 * accept-any-root, always-blank, never-disown, keep-across-roots.
 *
 * The replacement is also broader. This test watched one file appear and disappear; the hook tests
 * additionally pin the two-subscriptions-one-channel rule (FR-069) and the FR-005 root change, both
 * of which produce a list that is silently WRONG rather than merely late — and neither of which this
 * test could reach without a second project and a toggle.
 */

/*
 * LAST ON PURPOSE, and it depends on the test above having run.
 *
 * FR-015 is about a modal opened while the walk is STILL IN FLIGHT, so this test needs a walk it can
 * outrun. It cannot get one by opening the big fixture as a second project — a root is exclusive
 * (FR-029) and the big fixture is already open. What it can do is leave and come back: the previous
 * test switched the window to its own small project, which dropped the big root's last subscriber
 * and disposed its index in UI main (S9), so switching BACK subscribes afresh and re-walks all
 * twelve thousand files from nothing.
 *
 * That is the same enumeration a first open performs, reached without a second fixture — and it is
 * why this test sits at the end of the file rather than beside the other two big-project tests.
 */
test('a modal opened before enumeration finishes says it is still listing, then shows results (FR-015, S3)', { tag: ['@extended', '@editor'] }, async () => {
  test.setTimeout(180_000);
  await runApp(async (_app, win) => {
    await settle(win);

    /*
     * LEAVE the big project first, so that coming back is a fresh walk.
     *
     * This is the whole precondition, and it is done here rather than inherited: while the window is
     * on the big root, its index is held and switching "back" to it re-walks nothing — which is
     * exactly what happens if this step is missing, and `quickopen-building` then never appears.
     */
    smallRoot = createSmallTree();
    await createProject(win, SMALL_PROJECT, smallRoot);
    await expect(win.locator('.project-item[data-active="true"]')).toContainText(SMALL_PROJECT);

    // Back to the big fixture — a SWITCH, not a second project.
    await win
      .locator('.project-item', { hasText: BIG_PROJECT })
      .locator('[data-testid^="project-switch-"]')
      .click();
    await expect(win.locator('.project-item[data-active="true"]')).toContainText(BIG_PROJECT);

    /*
     * The chord goes in immediately, while the walk of 12,000 files is still in flight.
     *
     * The fixture's SIZE is the lever that makes this observable: a keypress costs milliseconds and
     * enumerating twelve thousand files costs considerably more, so the building state is on screen
     * for long enough to be seen. If this ever becomes racy, the fixture grows — the answer is never
     * to soften the assertion into one a partial list would also satisfy, which is the failure S3
     * exists to prevent.
     */
    await openQuickOpen(win);
    await expect(win.getByTestId('quickopen-building')).toBeVisible();

    // …and then the real list, which is the second half of S3: a partial list must never be
    // presented as though it were whole.
    await expect(win.getByTestId('quickopen-building')).toHaveCount(0, { timeout: 30_000 });
    await win.keyboard.type('widget-0001');
    await expect(quickOpenRows(win)).toHaveCount(BIG_TREE_DIRS);

    await win.keyboard.press('Escape');
    await expect(win.getByTestId('quickopen')).toHaveCount(0);
  });
});
