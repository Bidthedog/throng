/**
 * 030 US2 (#195) — A NOTICE NAMES WHAT IT IS ABOUT.
 *
 * ══ THE DEFECT ══
 *
 * "An error occurred when you tried to rename this item." Which item? A user with four projects,
 * six tabs and a dozen panels open is told that something, somewhere, failed. The information the
 * notice is FOR — which thing — is the one thing it withholds.
 *
 * FR-019 makes the subject a required, structured field of every raise; FR-020 puts it in the
 * heading, with the message stating only what went wrong; FR-021 gives it exactly one formatter, so
 * two notices about the same kind of thing name it identically.
 *
 * ══ TIER: SERIAL, DELIBERATELY ══
 *
 * Registered in `parallel-plan.json`'s serial list because the terminal test below drives a REAL
 * shell (`cmd`) and then kills it: a long-running real shell starves at high worker counts, which is
 * the same reason `notice-consolidation.e2e.ts` is serial (T042). Nothing here opens the Preferences
 * window or a context menu — the panel renames use the header's double-click affordance — so focus
 * theft is not the reason; the shell is. Sharing one app does not change that: the shell is still
 * real, so the file stays in the serial tier.
 *
 * ══ ONE APP FOR THE FILE (034 FR-045) — 5 launches → 1 ══
 *
 * Five tests, five `runApp()` calls, five Electron launches and five daemons. Nothing here seeds
 * state before the app starts — every project is created in-app, under its own temp root, with its
 * own name — so root exclusivity (FR-029) and `.project-item` ambiguity are both already answered.
 *
 * THE BLOCKER was the notice stack itself, and it is worth stating precisely because it is not
 * obvious from the tests. `explorer-error` notices are raised at severity `error`, and
 * `DEFAULT_NOTIFICATION_SETTINGS.error` is `{ mode: 'dismiss', timeoutMs: 5000 }`
 * (packages/core/src/notice/display-mode.ts) — `dismiss` means RENDERED UNTIL THE USER SAYS
 * OTHERWISE, with no timer armed. So the notice test 1 raises is still on screen when test 4 counts,
 * and four assertions here are window-wide counts of exactly that locator:
 * `toHaveCount(1)`, then `1 → 2`, then `1 → 2 → 1`. Worse, test 5 picks `short` and `wide` out of
 * that stack by POSITION (`.first()` / `.last()`) and compares their widths, so a leftover card does
 * not merely fail the count — it compares the wrong two notices, and can pass or fail for reasons
 * that have nothing to do with FR-028.
 *
 * THE FIX is cleanup, not an assertion change: `beforeEach` empties the notice stack, so every one
 * of those counts still means exactly what it meant against a pristine app, character for
 * character. It clicks each notice's own dismiss control rather than reaching past the UI, which
 * matters: `useErrorNotice`'s `onDismiss` calls the store's `clearError()`, so the explorer's error
 * FIELD is cleared too — and without that, the next identical failure ("A file or folder with this
 * name already exists." about a file also called `alpha.txt`) would be the same value in the same
 * state, the effect would not re-run, and no notice would be raised at all. The test would then
 * fail on a count for the one reason that is not a defect.
 *
 * In `beforeEach` rather than `afterEach` on purpose: a test that needs an empty stack should be the
 * one that establishes it, so a cleanup that cannot complete fails the test it would have broken,
 * not the innocent one before it.
 *
 * Deliberately NOT `mode: 'serial'` (which is about test SKIPPING, not about the serial TIER above).
 * These five ask five independent questions — a file subject, a panel subject, a terminal subject,
 * one formatter, and truncation — and a first failure that skipped the rest would turn four answers
 * into none. `fullyParallel: false` already keeps a file to one worker in declaration order, so the
 * shared window is never driven by two tests at once, and the `beforeEach` above means a failure
 * that leaves notices behind cannot decide the next test's outcome.
 *
 * ══ HOW THE FAILURES ARE PRODUCED ══
 *
 * Every failure here is deterministic and needs no lock holder, no elevation and no external
 * process:
 *
 *   • renaming a file onto a name a sibling already has — `FilesService.renameInBracket` returns
 *     "A file or folder with this name already exists.", a message that names NOTHING, which is
 *     exactly the case FR-025 is about;
 *   • renaming a file to a name containing a separator — "Invalid name.", equally anonymous;
 *   • two panels asking for one name — the daemon adjusts the second and says so;
 *   • a terminal the test itself kills — the exit notice, which FR-026 requires to name its flavour.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { addPanels, cleanupTemp, createProject, daemonRpc, openApp, panelIds, settle, type OpenApp } from './harness.js';

/** The em dash with spaces that `formatSubject` joins parts with (`SUBJECT_SEPARATOR`). */
const SEP = ' — ';

function explorerNotices(win: Page): Locator {
  return win.getByTestId('explorer-error');
}

/** Rename `name` to `to` from the Files & Folders tree (F2, as `fileop-lock-cause` does). */
async function renameInTree(win: Page, name: string, to: string): Promise<void> {
  const tree = win.getByTestId('file-explorer-tree');
  await expect(tree).toBeVisible();
  await tree.getByText(name, { exact: true }).first().click();
  await win.keyboard.press('F2');
  const input = tree.locator('input.tree-rename');
  await expect(input).toBeVisible();
  await input.fill(to);
  await input.press('Enter');
}

/** Rename a panel through its header — no context menu, so this spec steals no focus. */
async function renamePanel(win: Page, panelId: string, to: string): Promise<void> {
  await win.getByTestId(`panel-handle-${panelId}`).dblclick();
  const input = win.getByTestId(`panel-rename-input-${panelId}`);
  await expect(input).toBeVisible();
  await input.fill(to);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}

/** A project root holding the named files. */
function seedRoot(prefix: string, files: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const name of files) writeFileSync(join(root, name), 'content\n');
  return root;
}

/**
 * Empty the notice stack, through each notice's own dismiss control.
 *
 * Scoped to `[data-testid="notices"]` so it can never reach a dismiss button belonging to something
 * else. Bounded, and loud if it does not converge: a stack that will not empty makes the next
 * test's counts wrong, and saying so here is far cheaper than debugging the count.
 */
async function dismissAllNotices(win: Page): Promise<void> {
  const buttons = win.getByTestId('notices').locator('[data-testid$="-dismiss"]');
  for (let i = 0; i < 25; i += 1) {
    const n = await buttons.count();
    if (n === 0) return;
    await buttons.first().click();
    // "Fewer than before" rather than "exactly one fewer": a timed notice may expire on its own
    // during the click, and this loop is cleanup, not an assertion about how many went.
    await expect.poll(() => buttons.count(), { timeout: 10_000 }).toBeLessThan(n);
  }
  throw new Error('dismissAllNotices: the notice stack did not empty after 25 dismissals');
}

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
});

test.beforeEach(async () => {
  // Every count below is window-wide, so each test starts from an empty stack — which is what a
  // fresh app used to give it. See the header for why this is a dismiss and not a clear.
  await dismissAllNotices(shared.win);
});

/**
 * FR-025 — the file is NAMED, and the message is left to say only what went wrong.
 *
 * The message here ("A file or folder with this name already exists.") is the whole of the problem
 * in one sentence: it is accurate, it is unclassified — so 029 leaves it exactly as it is — and it
 * identifies nothing. Everything that tells the user WHICH file has to come from the subject.
 */
test('a file failure names the file, not "this item"', { tag: ['@extended', '@failure'] }, async () => {
  const win = shared.win;
  const root = seedRoot('throng-subj-file-', ['alpha.txt', 'beta.txt']);
  try {
    await settle(win);
    await createProject(win, 'SubjFile', root);
    const tree = win.getByTestId('file-explorer-tree');
    await expect(tree.getByText('alpha.txt', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });

    await renameInTree(win, 'alpha.txt', 'beta.txt');
    await expect(explorerNotices(win)).toHaveCount(1, { timeout: 15_000 });
    const notice = explorerNotices(win).first();

    // RED — the notice names the file it is about.
    await expect(notice, 'the notice does not name the file').toContainText('alpha.txt');
    // …in the HEADING, above the message (FR-020), not smuggled into the prose.
    const heading = notice.locator('.notice__title');
    await expect(heading).toContainText('alpha.txt');
    // The message states what went wrong and nothing else (FR-023): it must not restate the name.
    await expect(notice.locator('.notice__message')).toHaveText(
      'A file or folder with this name already exists.',
    );
    // FR-058's generic stand-in is gone from the whole notice, not merely from the message.
    expect(await notice.innerText()).not.toMatch(/this item|the item|this file/i);
  } finally {
    cleanupTemp(root);
  }
});

/**
 * FR-022 — a panel is named `Project — Tab — Panel`, wherever it is named at all.
 *
 * The panel-name warning is raised the moment the daemon adjusts a taken name. Today it says
 * "Another panel is already called X, so this one was named Y" and leaves the reader to work out
 * which of their panels, in which tab, in which project, just changed name underneath them.
 *
 * `Build` is claimed by no other test in this file, which is what keeps `Build (2)` exact in a
 * shared app: the daemon's name claim spans the store, so a literal here is only safe because the
 * name is this test's alone.
 */
test('a panel failure names Project — Tab — Panel', { tag: ['@extended', '@failure'] }, async () => {
  const win = shared.win;
  const root = seedRoot('throng-subj-panel-', []);
  try {
    await settle(win);
    await createProject(win, 'SubjPanel', root);
    await addPanels(win, 1);
    const ids = await panelIds(win);
    expect(ids.length).toBeGreaterThanOrEqual(2);

    await renamePanel(win, ids[0]!, 'Build');
    /*
     * The claim reads what has been SAVED, and the layout write is debounced — so ask the daemon's
     * OWN name-claim RPC, read-only, with the exact params the second rename below is about to send
     * it. That is the precise condition "has the write landed" means; polling it is a poll on daemon
     * state (panelName.claim only reads persisted layouts, see panel-name-service.ts), not a guess
     * at how long a 400ms debounce plus a round trip actually takes on a loaded machine.
     */
    await expect
      .poll(
        async () => {
          const probe = (await daemonRpc(shared.pipeName, 'panelName.claim', {
            panelId: ids[1]!,
            desired: 'Build',
          })) as { adjusted?: boolean } | null;
          return probe?.adjusted === true;
        },
        {
          timeout: 15_000,
          message: 'the first panel\'s rename to "Build" never reached the persisted layout the daemon reads',
        },
      )
      .toBe(true);
    await renamePanel(win, ids[1]!, 'Build');

    const notice = win.getByTestId('panel-name-adjusted');
    await expect(notice).toBeVisible({ timeout: 15_000 });
    const heading = notice.locator('.notice__title');

    // RED — all three parts, in that order, joined by the one separator.
    await expect(heading).toContainText('SubjPanel');
    await expect(heading).toContainText('Build (2)');
    expect(await heading.innerText(), 'the panel is not named Project — Tab — Panel').toMatch(
      new RegExp(`SubjPanel${SEP}.+${SEP}Build \\(2\\)`),
    );
  } finally {
    cleanupTemp(root);
  }
});

/**
 * FR-026 — a terminal failure names the FLAVOUR involved.
 *
 * "The terminal exited" is not actionable on a panel that can host any of several shells. The exit
 * notice is raised by the type-selection form the panel reverts to, which is exactly the moment the
 * terminal itself is gone — so the flavour has to come from what the panel REMEMBERED, not from a
 * live session.
 */
test('a terminal failure names its flavour', { tag: ['@extended', '@failure'] }, async () => {
  const win = shared.win;
  const root = seedRoot('throng-subj-term-', []);
  try {
    await settle(win);
    await createProject(win, 'SubjTerm', root);
    const [panel] = await panelIds(win);
    expect(panel).toBeTruthy();

    await win.getByTestId(`panel-type-select-${panel!}`).selectOption('terminal');
    await win.getByTestId('terminal-flavour').selectOption('cmd');
    await win.getByTestId(`panel-type-confirm-${panel!}`).click();
    await expect(win.getByTestId(`terminal-${panel!}`)).toContainText(basename(root), {
      timeout: 25_000,
    });

    await win.evaluate((id) => window.throng?.terminal?.kill?.(id), panel!);
    const notice = win.getByTestId(`panel-exit-${panel!}`);
    await expect(notice).toBeVisible({ timeout: 25_000 });

    // RED — the flavour is named. Matched loosely on purpose: the label is the flavour registry's
    // ("Command Prompt"), and pinning it here would make this a spelling check.
    const heading = notice.locator('.notice__title');
    expect(await heading.innerText(), 'the exit notice does not name the flavour').toMatch(
      /cmd|command prompt/i,
    );
    // …and the panel it happened in, through the same formatter (FR-022).
    await expect(heading).toContainText('SubjTerm');
  } finally {
    cleanupTemp(root);
  }
});

/**
 * FR-021 — ONE formatter, so two notices about one thing name it identically.
 *
 * Two genuinely different failures about `alpha.txt`, raised minutes apart in the user's terms and
 * seconds apart here. If either call site were allowed to spell the subject itself, this is the test
 * that would catch it — and it is why the formatter is a function in core rather than a convention.
 */
test('two different failures about one file name it identically', { tag: ['@extended', '@failure'] }, async () => {
  const win = shared.win;
  const root = seedRoot('throng-subj-same-', ['alpha.txt', 'beta.txt']);
  try {
    await settle(win);
    await createProject(win, 'SubjSame', root);
    const tree = win.getByTestId('file-explorer-tree');
    await expect(tree.getByText('alpha.txt', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });

    await renameInTree(win, 'alpha.txt', 'beta.txt'); // already exists
    await expect(explorerNotices(win)).toHaveCount(1, { timeout: 15_000 });
    await renameInTree(win, 'alpha.txt', 'sub/dir.txt'); // invalid name
    await expect(explorerNotices(win)).toHaveCount(2, { timeout: 15_000 });

    const first = explorerNotices(win).first();
    const second = explorerNotices(win).last();
    // Two DIFFERENT problems — the stacking rule (#178) still holds with subjects in play.
    expect(await first.locator('.notice__message').innerText()).not.toBe(
      await second.locator('.notice__message').innerText(),
    );
    // …named identically, character for character.
    expect(await first.locator('.notice__title').innerText()).toBe(
      await second.locator('.notice__title').innerText(),
    );
    expect(await first.locator('.notice__title').innerText()).toContain('alpha.txt');
  } finally {
    cleanupTemp(root);
  }
});

/**
 * T029a / FR-028 — NAMING A SUBJECT CHANGES NOTHING ELSE.
 *
 * A subject is presented in a heading the notice could already carry, so it introduces no new
 * element — but a 200-character folder name would still burst the toast if truncation were left to
 * CSS. FR-021 puts the bound in the formatter (48 characters per part), and this asserts the
 * consequence a unit test cannot see: the toast does not grow, does not scroll sideways, still
 * stacks, still carries its severity colour, and still dismisses one at a time.
 */
test('a long subject is truncated and nothing else about the notice changes', { tag: ['@extended', '@failure'] }, async () => {
  const win = shared.win;
  const long = `${'w'.repeat(70)}.txt`;
  const root = seedRoot('throng-subj-long-', ['alpha.txt', 'beta.txt', long]);
  try {
    await settle(win);
    await createProject(win, 'SubjLong', root);
    const tree = win.getByTestId('file-explorer-tree');
    await expect(tree.getByText('alpha.txt', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });

    await renameInTree(win, 'alpha.txt', 'beta.txt');
    await expect(explorerNotices(win)).toHaveCount(1, { timeout: 15_000 });
    await renameInTree(win, long, 'beta.txt');
    // STACKING is unchanged: two failures about two files are two notices, even though their
    // messages are identical. Before subjects existed these two WERE one event.
    await expect(explorerNotices(win)).toHaveCount(2, { timeout: 15_000 });

    // `.first()` / `.last()` are positional, and they are only "the two this test raised" because
    // the stack started empty — see the `beforeEach`.
    const short = explorerNotices(win).first();
    const wide = explorerNotices(win).last();

    // Truncated by the formatter, per part, ellipsis included.
    const headingText = await wide.locator('.notice__title').innerText();
    expect(headingText, 'a 74-character name was not truncated').toContain('…');
    expect(headingText).not.toContain('w'.repeat(50));

    // LAYOUT: the long-subject notice is exactly as wide as the short one, and neither scrolls
    // sideways. A subject that changed the toast's geometry would be FR-028's failure.
    const shortBox = await short.boundingBox();
    const wideBox = await wide.boundingBox();
    expect(shortBox && wideBox).toBeTruthy();
    expect(Math.abs(wideBox!.width - shortBox!.width)).toBeLessThanOrEqual(1);
    const overflow = await wide.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, 'the notice scrolls sideways').toBeLessThanOrEqual(1);
    // …and it stays inside the notices container.
    const stack = await win.getByTestId('notices').boundingBox();
    expect(wideBox!.x + wideBox!.width).toBeLessThanOrEqual(stack!.x + stack!.width + 1);

    // COLOUR and DISMISSAL, unchanged.
    await expect(short).toHaveClass(/notice--error/);
    await expect(wide).toHaveClass(/notice--error/);
    await win.getByTestId('explorer-error-dismiss').first().click();
    await expect(explorerNotices(win)).toHaveCount(1);
  } finally {
    cleanupTemp(root);
  }
});
