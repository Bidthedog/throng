/**
 * 031 US4 — the name limit, in the running application (#226).
 *
 * `contracts/name-limit.md` splits into two halves, and only one of them can be settled by a unit
 * test. `countGraphemes`/`truncateGraphemes` are pure and are covered there (N1–N9). What is NOT
 * pure — and is the whole of what a user experiences — is the limit being APPLIED: a field that
 * stops at it, a counter that appears near it and is not an alarm, a stored name that is shortened
 * for display without being destroyed, and a persisted layout that loads whatever length it holds.
 * Those are C1–C6 and NP1–NP4, and they are what this file asserts — except NP2, which the
 * application does not yet do; the note at the foot of this file says what was measured and why no
 * test here claims it.
 *
 * ══ HOW THE LIMIT IS CHANGED, AND WHY THE WAITS ARE HONEST ══
 *
 * The limit is a setting, so these tests write `settings.json` in the run's own config root and let
 * hot-reload apply it (#108) — the preferences window would steal focus, and throng closes menus on
 * blur, so a focus-stealing spec makes some *unrelated* test flake.
 *
 * A settings write lands asynchronously, and no helper can tell you when. So no test here waits for
 * "the setting to apply": each waits for the CONDITION it is about — a counter whose total reads
 * the new limit, a title that shortened to it — which cannot come true at the old value. The wait
 * is therefore self-verifying rather than timed, which is the difference between a poll and a sleep.
 *
 * ══ EVERY TEST SEEDS ITS OWN PROJECT ══
 *
 * The app is shared for the file (docs/testing.md), but each test creates its own project and its
 * own tab. Inheriting a tab from the test above is fine until that test retries, at which point the
 * assumption is silently false — which is exactly how 031's first spec went flaky.
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Page } from '@playwright/test';
import { LAYOUT_SCHEMA_VERSION } from '@throng/core';
import {
  openApp,
  runApp as runOwnApp,
  createProject as newProject,
  seedDatabase,
  cleanupTemp,
  firstPanelId,
  settle,
  commitTabRename,
  type OpenApp,
} from './harness.js';
import { stripGeometry } from './helpers/tabs.js';
import {
  writeTabSettings,
  tabIdOf,
  startTabRename,
  tabRenameCounter,
  panelRenameCounter,
  counterText,
  awaitFieldLimit,
  counterStyle,
} from './helpers/tab-settings.js';

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let cfgRoot: string;
let dataDir: string;
const roots: string[] = [];

test.beforeAll(async () => {
  cfgRoot = mkdtempSync(join(tmpdir(), 'throng-namelimit-cfg-'));
  dataDir = mkdtempSync(join(tmpdir(), 'throng-namelimit-data-'));
  // The config root is OURS, so `writeTabSettings` can drive the limit; the data dir is ours so the
  // persistence guarantees (NP1–NP3) can be read from the store they are stated about.
  shared = await openApp({ dataDir, env: { THRONG_CONFIG_ROOT: cfgRoot } });
  await settle(shared.win);
});

test.afterAll(async () => {
  await shared?.close();
  cleanupTemp(cfgRoot);
  cleanupTemp(dataDir);
  for (const r of roots) cleanupTemp(r);
});

let seq = 0;

/** A fresh project (and therefore a fresh single-tab strip) for the test about to run. */
async function project(prefix: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'throng-namelimit-'));
  roots.push(root);
  const name = `${prefix}-${(seq += 1)}`;
  await newProject(shared.win, name, root);
  return name;
}

/**
 * Open an already-created project, which makes the app LOAD its layout from the store.
 *
 * The persistence guarantees are about what is on disk, and the only way to see that through the
 * interface is to make the app read it again — the window's own copy of the layout keeps the full
 * title however the strip is drawing it.
 */
async function switchTo(win: Page, projectName: string): Promise<void> {
  await win
    .locator('.project-item')
    .filter({ hasText: projectName })
    .first()
    .locator('[data-testid^="project-switch-"]')
    .click();
  const active = win.locator('.project-item[data-active="true"]');
  await expect(active).toHaveCount(1);
  await expect(active).toContainText(projectName);
}

/** The id of the project's one tab. */
async function onlyTabId(win: Page): Promise<string> {
  const g = await stripGeometry(win);
  expect(g.tabs.length, 'a fresh project opens with exactly one tab').toBe(1);
  return tabIdOf(g.tabs[0]!.testId);
}

/**
 * A deterministic name of `n` characters whose every prefix differs from every other prefix, so
 * "shortened to 30" and "shortened to 16" can never be confused for one another.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const name = (n: number): string =>
  Array.from({ length: n }, (_, i) => ALPHABET[i % ALPHABET.length]).join('');

/**
 * A ZWJ family: man + ZWJ + woman + ZWJ + girl. EIGHT UTF-16 code units, ONE grapheme cluster.
 *
 * Written as explicit escapes rather than pasted, deliberately: the joiners are invisible, and the
 * composition is the thing under test. A pasted character would be re-normalised or silently eaten
 * by the next editor to touch this file, and the test would then quietly measure something else.
 */
const ZWJ = String.fromCodePoint(0x200d);
const FAMILY = [0x1f468, 0x1f469, 0x1f467].map((cp) => String.fromCodePoint(cp)).join(ZWJ);

/** The stored layout for a project, read WITHOUT disturbing the daemon that owns the file. */
function storedLayout(projectName: string): string | null {
  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(join(dataDir, 'throng.db'), { readonly: true });
    const row = db
      .prepare(
        `SELECT w.layout_json AS json
           FROM workspace_layout w
           JOIN projects p ON p.id = w.project_id
          WHERE p.name = ?`,
      )
      .get(projectName) as { json?: string } | undefined;
    return row?.json ?? null;
  } catch {
    return null; // not written yet, or a transient read of a mid-write DB
  } finally {
    db?.close();
  }
}

/** Wait until the project's layout has ACTUALLY been persisted holding `needle`. */
async function expectStored(projectName: string, needle: string, why: string): Promise<void> {
  await expect
    .poll(() => storedLayout(projectName)?.includes(needle) ?? false, {
      timeout: 15_000,
      message: why,
    })
    .toBe(true);
}

// ── C1–C3, C6: the counter ────────────────────────────────────────────────────────────────────

test('T078 — the field stops at the limit; the counter shows within ten of it and is not an error', async () => {
  const win = shared.win;
  await project('Counter');
  const tab = await onlyTabId(win);
  writeTabSettings(cfgRoot, { maxNameLength: 30 });

  const input = await startTabRename(win, tab);
  const counter = tabRenameCounter(win, tab);
  await awaitFieldLimit(input, counter, 30);

  // C1 — hidden while the name is more than ten from the limit. Nineteen is eleven away.
  await input.fill(name(19));
  await expect(counter, 'C1: eleven characters from the limit, so no counter').toHaveCount(0);

  // C2 — from ten remaining onwards, used against total.
  await input.fill(name(20));
  await expect(counter, 'C2: the counter appears at ten remaining').toHaveText('20/30');
  await expect(counter).toHaveAttribute('data-at-limit', 'false');
  const approaching = await counterStyle(counter);

  // The field STOPS at the limit: forty characters offered, thirty accepted, cut where the limit is.
  await input.fill(name(40));
  expect(await input.inputValue(), 'the field caps what it accepts').toBe(name(30));
  await expect(counter, 'C2: at-limit reads used === total').toHaveText('30/30');
  await expect(counter).toHaveAttribute('data-at-limit', 'true');

  /*
   * C3 — NOT an error state.
   *
   * Asserted as "nothing about it changed", which is stronger than checking for the absence of one
   * class name: a red counter, a bolded one, or a notice raised behind it would each fail. The
   * counter is asserted PRESENT first, so the absence checks cannot pass against an unrendered DOM.
   */
  const atLimit = await counterStyle(counter);
  expect(atLimit.color, 'C3: reaching the limit must not recolour the counter').toBe(
    approaching.color,
  );
  expect(atLimit.fontWeight, 'C3: nor re-weight it').toBe(approaching.fontWeight);
  await expect(input, 'C3: the field is not marked invalid').not.toHaveAttribute('aria-invalid', /.*/);
  await expect(win.locator('[data-testid^="notice-"]'), 'C3: no notice is raised').toHaveCount(0);

  // C3 — and the commit is not blocked.
  await input.press('Enter');
  await expect(win.getByTestId(`tab-title-${tab}`)).toHaveText(name(30));
});

test('T078b — at a limit of ten the counter shows from the first character, and ten emoji fit', async () => {
  const win = shared.win;
  await project('Ten');
  const tab = await onlyTabId(win);
  writeTabSettings(cfgRoot, { maxNameLength: 10 });

  const input = await startTabRename(win, tab);
  const counter = tabRenameCounter(win, tab);
  await awaitFieldLimit(input, counter, 10);

  /*
   * C6 — at a limit of 10 every character is within ten of the end, so the counter is visible from
   * the first one. Correct, not a bug: the approach threshold is itself ten.
   */
  await input.fill('x');
  await expect(
    counter,
    'C6: at a limit of ten the counter is visible from the first character',
  ).toHaveText('1/10');

  /*
   * N1/N2 in the APP, which is the only place they can go wrong for the user.
   *
   * Twelve ZWJ families are offered at a limit of ten. If the cap counted UTF-16 code units the
   * field would hold one family and a fragment of a second; if it cut mid-cluster the value would
   * end in a lone joiner or half a person. Exactly ten whole families is the only value that is
   * both within the limit and unbroken — and the counter must agree with the field (C4).
   */
  await input.fill(FAMILY.repeat(12));
  expect(await input.inputValue(), 'ten whole families — cut on a cluster boundary').toBe(
    FAMILY.repeat(10),
  );
  expect(FAMILY.length, 'a ZWJ family is eight code units, so this is not counting characters').toBe(8);
  await expect(counter, 'C4: the counter counts what the field permits').toHaveText('10/10');
  await expect(counter).toHaveAttribute('data-at-limit', 'true');

  await input.press('Enter');
  await expect(win.getByTestId(`tab-title-${tab}`)).toHaveText(FAMILY.repeat(10));
});

test('T079 — a paste longer than the room left inserts as much as fits (FR-036, FR-036a)', async () => {
  const win = shared.win;
  await project('Paste');
  const tab = await onlyTabId(win);
  writeTabSettings(cfgRoot, { maxNameLength: 16 });

  const input = await startTabRename(win, tab);
  const counter = tabRenameCounter(win, tab);

  await awaitFieldLimit(input, counter, 16);

  // Eight of the sixteen used, so eight remain — inside the counter's ten-remaining threshold, and
  // far short of what the paste below offers.
  await input.fill(name(8));
  await expect(counter, 'eight used, eight to go').toHaveText('8/16');

  /*
   * `insertText`, not Ctrl+V.
   *
   * Electron's clipboard does not work under this harness — text written to it reads back empty
   * (harness.ts, THRONG_E2E_CLIPBOARD) — so a real paste would insert nothing and this test would
   * pass by asserting that nothing arrived. `insertText` produces the same single bulk insertion at
   * the caret, with the same `input` event, which is precisely what the field's cap sees.
   */
  await input.click();
  await win.keyboard.press('End');
  await win.keyboard.insertText(name(60));

  expect(
    await input.inputValue(),
    'FR-036: as much as fits is inserted, rather than the paste being refused',
  ).toBe((name(8) + name(60)).slice(0, 16));
  await expect(counter, 'FR-036a: the counter reads at-limit, so the user can see it was cut').toHaveText(
    '16/16',
  );
  await expect(counter).toHaveAttribute('data-at-limit', 'true');
});

test('T080 — a panel rename behaves identically: one setting, one counter, one behaviour (FR-035g)', async () => {
  const win = shared.win;
  await project('PanelCap');
  const panelId = await firstPanelId(win);
  writeTabSettings(cfgRoot, { maxNameLength: 30 });

  await win.getByTestId(`panel-handle-${panelId}`).dblclick();
  const input = win.getByTestId(`panel-rename-input-${panelId}`);
  await expect(input).toBeVisible();
  const counter = panelRenameCounter(win, panelId);
  await awaitFieldLimit(input, counter, 30);

  await input.fill(name(19));
  await expect(counter, 'C1 on a panel: eleven from the limit, so nothing shown').toHaveCount(0);

  await input.fill(name(40));
  await expect(
    counter,
    'the panel counter reads the SAME limit the tab counter does',
  ).toHaveText('30/30');
  await expect(counter).toHaveAttribute('data-at-limit', 'true');
  expect(await input.inputValue(), 'the panel field caps at the same limit').toBe(name(30));

  await input.press('Enter');
  await expect(win.getByTestId(`panel-title-${panelId}`)).toHaveText(name(30));
});

test('T081 — committing a rename applies the limit, so an over-long name cannot be reintroduced (FR-035f)', async () => {
  const win = shared.win;
  const projectName = await project('Reintro');
  const tab = await onlyTabId(win);

  // A name that fits the limit it was typed at…
  writeTabSettings(cfgRoot, { maxNameLength: 64 });
  const first = await startTabRename(win, tab);
  await awaitFieldLimit(first, tabRenameCounter(win, tab), 64);
  await first.fill(name(64));
  await first.press('Enter');
  await expect(win.getByTestId(`tab-title-${tab}`)).toHaveText(name(64));

  // …and a limit lowered underneath it. The stored name is now over-long (FR-040).
  writeTabSettings(cfgRoot, { maxNameLength: 30 });
  const label = win.getByTestId(`tab-title-${tab}`);
  await expect(label, 'FR-039: the longer name is brought within the new limit when next read').toHaveText(
    name(30),
    { timeout: 15_000 },
  );
  await expect(label, 'FR-037c: a name that WAS cut is marked as cut, at render time').toHaveClass(
    /tab-chip__label--truncated/,
  );

  /*
   * FR-035f — what is settled here is the half that protects the DATA: a rename made while the
   * stored name is over-long CANNOT put an over-long name back, however much text is offered.
   *
   * Forty-two characters are typed into a field limited to thirty. What is committed is the first
   * thirty, and the sixty-four-character name is gone from the store for good.
   *
   * Two things this deliberately does NOT assert, both reported alongside this spec:
   *
   *  - The box opens already cut. FR-035f says it should open showing the FULL name, with the
   *    counter reading over its total until the user deletes down to it; `NameLimitField` bounds
   *    `initialValue` at mount instead. That is a product decision to make, not a behaviour for
   *    this test to bless in either direction.
   *  - Committing an UNTOUCHED box is a no-op, so it does not shorten the stored name either. That
   *    follows from #218's "only a changed name is a rename", and it agrees with FR-040 — reading
   *    a name is not a reason to rewrite it — but it does mean "committing applies the limit" only
   *    bites when the user actually edits, which is why this test edits.
   */
  const typed = 'zz' + name(40);
  const second = await startTabRename(win, tab);
  await second.fill(typed);
  expect(await second.inputValue(), 'the field cut the new text at the limit').toBe(
    typed.slice(0, 30),
  );
  await second.press('Enter');

  await expect(label, 'the commit applied the limit to what was typed').toHaveText(typed.slice(0, 30));
  await expect(
    label,
    'FR-037d: a name that is exactly the limit and was not cut is not marked',
  ).not.toHaveClass(/tab-chip__label--truncated/);

  // …and the over-long name it replaced is not lurking in the store, ready to come back.
  await expectStored(projectName, typed.slice(0, 30), 'the rename never reached the store');
  expect(
    storedLayout(projectName)?.includes(name(64)),
    'FR-035f: the rename could not be used to reintroduce the over-long name',
  ).toBe(false);
});

test('T082 — lowering the limit mid-rename updates the counter immediately (C5)', async () => {
  const win = shared.win;
  await project('Live');
  const tab = await onlyTabId(win);
  writeTabSettings(cfgRoot, { maxNameLength: 64 });

  const input = await startTabRename(win, tab);
  const counter = tabRenameCounter(win, tab);
  await awaitFieldLimit(input, counter, 64);
  await input.fill(name(60));
  await expect(counter, 'sixty of sixty-four used').toHaveText('60/64');

  // The preferences window is a SEPARATE window and settings hot-reload, so the limit really can
  // change while this box is open. C5 says the box must follow it.
  writeTabSettings(cfgRoot, { maxNameLength: 30 });

  await expect
    .poll(() => counterText(counter), {
      timeout: 15_000,
      message: 'C5: the counter tracks the limit changing while the field is open',
    })
    .toBe('30/30');
  expect(
    await input.inputValue(),
    'C5: what is already typed is brought within the new limit, or the commit would silently cut it',
  ).toBe(name(30));
});

// ── NP1–NP4: what the limit does, and does not, do to what is stored ──────────────────────────

test('T083 — a persisted layout holding a 300-character name loads, shortened and marked (NP4)', async () => {
  /*
   * Its OWN app, because the state that matters is seeded BEFORE launch. A 300-character name
   * cannot be produced through the interface at all — the limit's own ceiling is 128 — so the only
   * way to test the case FR-038 is actually about (a layout written by something else, or by an
   * older build) is to write one.
   */
  const ownData = mkdtempSync(join(tmpdir(), 'throng-longname-data-'));
  const ownCfg = mkdtempSync(join(tmpdir(), 'throng-longname-cfg-'));
  const root = mkdtempSync(join(tmpdir(), 'throng-longname-root-'));
  mkdirSync(root, { recursive: true });
  writeTabSettings(ownCfg, { maxNameLength: 30 });

  const owner = userInfo().username || 'throng-user';
  const projectId = 'p-longname';
  const tabId = 't-longname';
  const panelId = 'pan-longname';
  const LONG = name(300);

  seedDatabase(ownData, (db) => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (id, owner_user, name, colour, root_folder, is_active, created_at, updated_at, position, hidden_paths)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(projectId, owner, 'LongName', '#6aa3ff', root, 1, now, now, 0, '[]');
    db.prepare(
      `INSERT INTO workspace_layout (owner_user, project_id, schema_version, layout_json, updated_at)
       VALUES (?,?,?,?,?)`,
    ).run(
      owner,
      projectId,
      LAYOUT_SCHEMA_VERSION,
      JSON.stringify({
        projectId,
        schemaVersion: LAYOUT_SCHEMA_VERSION,
        tabs: [
          {
            id: tabId,
            title: LONG,
            root: { type: 'panel', id: panelId, originProjectId: projectId, title: 'Panel 1' },
            activePanelId: panelId,
          },
        ],
        activeTabId: tabId,
      }),
      now,
    );
  });

  try {
    await runOwnApp(
      async (_app, win) => {
        await settle(win);
        // Loading is lazy, so open the project to make it read the layout.
        await win.getByTestId(`project-switch-${projectId}`).click();

        const label = win.getByTestId(`tab-title-${tabId}`);
        await expect(label, 'FR-038: the layout LOADED — it was not rejected').toBeVisible({
          timeout: 15_000,
        });
        await expect(label, 'brought within the limit for display').toHaveText(name(30));
        await expect(label, 'FR-037c: and marked as cut').toHaveClass(/tab-chip__label--truncated/);

        // Asserted only once something IS on screen, so it cannot pass against an unrendered DOM.
        await expect(win.getByTestId('restore-notice'), 'no error, no fallback layout').toHaveCount(0);

        /*
         * NP1/NP3 at the point they matter most: the app has just READ a 300-character name and
         * shown 30 of it. The other 270 must still be in the store.
         */
        let db: InstanceType<typeof Database> | undefined;
        try {
          db = new Database(join(ownData, 'throng.db'), { readonly: true });
          const row = db
            .prepare(`SELECT layout_json AS json FROM workspace_layout WHERE project_id = ?`)
            .get(projectId) as { json?: string } | undefined;
          expect(row?.json?.includes(LONG), 'NP1: shortening on read did not rewrite the store').toBe(
            true,
          );
        } finally {
          db?.close();
        }
      },
      { dataDir: ownData, env: { THRONG_CONFIG_ROOT: ownCfg } },
    );
  } finally {
    cleanupTemp(ownCfg);
    cleanupTemp(ownData);
    cleanupTemp(root);
  }
});

test('T084a — lower then raise the limit with nothing else changed, and the full names return (NP1, NP3)', async () => {
  const win = shared.win;
  const projectName = await project('Reversible');
  const tab = await onlyTabId(win);

  writeTabSettings(cfgRoot, { maxNameLength: 64 });
  const input = await startTabRename(win, tab);
  await awaitFieldLimit(input, tabRenameCounter(win, tab), 64);
  await input.fill(name(64));
  await input.press('Enter');

  const label = win.getByTestId(`tab-title-${tab}`);
  await expect(label).toHaveText(name(64));
  await expectStored(projectName, name(64), 'the full name was never persisted, so nothing is proven');

  // Lower it. The display shortens…
  writeTabSettings(cfgRoot, { maxNameLength: 16 });
  await expect(label, 'FR-039: read at the new limit').toHaveText(name(16), { timeout: 15_000 });

  /*
   * NP3 — and LOADING the layout at the low limit is still not a reason to write it. Switching
   * away and back is a real load, and it is also a deterministic sync point: the strip cannot
   * render this tab again until the layout has come back from the daemon.
   */
  await project('Elsewhere');
  await switchTo(win, projectName);
  await expect(label, 'the original project is open again, loaded at the LOW limit').toHaveText(
    name(16),
  );

  expect(
    storedLayout(projectName)?.includes(name(64)),
    'NP1/NP3: neither reading nor loading may rewrite the stored name',
  ).toBe(true);

  /*
   * Raise it again with nothing else changed → the full name comes back.
   *
   * Read from the STORE rather than from what the window happens to be holding: the renderer's
   * in-memory layout keeps the full title whatever the display does, so a raise that restored the
   * name from memory would look identical to one that restored it from disk. Another switch away
   * and back forces the value to come from the store, which is what NP1 is actually about.
   */
  writeTabSettings(cfgRoot, { maxNameLength: 64 });
  await expect(label, 'the raised limit is live').toHaveText(name(64), { timeout: 15_000 });
  await project('Elsewhere-again');
  await switchTo(win, projectName);
  await expect(
    label,
    'NP1: the full name survived the lower limit, so a reload at the higher one returns it',
  ).toHaveText(name(64));
});

/*
 * NP2 — the deliberately lossy half of FR-040.
 *
 * This block used to say NP2 was UNIMPLEMENTED, and it was right when it was written: the limit
 * was applied at render time only, so lowering it and saving the layout for another reason left
 * the full name in the store. That is now fixed at the write boundary (`boundLayoutNames`, wired
 * into both save paths in `workspace-store.tsx`), so the guarantee is real and testable — and the
 * test below is the one the old comment said could not be written yet.
 */
test('T084b — an ordinary layout save at the lower limit makes the shortening permanent (NP2)', async () => {
  const win = shared.win;
  const projectName = await project('Persists');
  const tab = await onlyTabId(win);

  writeTabSettings(cfgRoot, { maxNameLength: 64 });
  const input = await startTabRename(win, tab);
  await awaitFieldLimit(input, tabRenameCounter(win, tab), 64);
  await input.fill(name(64));
  await input.press('Enter');
  await expectStored(projectName, name(64), 'the full name was never persisted, so nothing is proven');

  // Lower the limit. Display shortens; the STORE must still hold the full name (NP1).
  writeTabSettings(cfgRoot, { maxNameLength: 16 });
  const label = win.getByTestId(`tab-title-${tab}`);
  await expect(label).toHaveText(name(16), { timeout: 15_000 });
  expect(
    storedLayout(projectName)?.includes(name(64)),
    'precondition: reading alone has not rewritten it',
  ).toBe(true);

  /*
   * Now write the layout FOR ANOTHER REASON. Creating a second tab is an ordinary layout change —
   * it is not about this tab's name at all, which is precisely what NP2 is about: the shortened
   * form rides along on the next save that was going to happen anyway.
   */
  await win.getByTestId('tab-add').click();
  await commitTabRename(win);

  await expect
    .poll(() => storedLayout(projectName)?.includes(name(64)), {
      message: 'NP2: an ordinary save at the lower limit must persist the SHORTENED name',
      timeout: 15_000,
    })
    .toBe(false);

  /*
   * And it is permanent. Raising the limit cannot bring back what is no longer stored — this is the
   * half of FR-040 that is deliberately lossy, and the reason the rule is stated in two parts.
   */
  writeTabSettings(cfgRoot, { maxNameLength: 64 });
  await project('Elsewhere-np2');
  await switchTo(win, projectName);
  await expect(
    label,
    'NP2: the shortening survived the raise, because a save had already made it the stored name',
  ).toHaveText(name(16));
});


