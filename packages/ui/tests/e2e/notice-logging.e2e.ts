/**
 * 030 US1 (#224) — silence on screen is never silence in the record (FR-005 → FR-008).
 *
 * ══ WHY THIS SPEC EXISTS ══
 *
 * *Never display* is only offerable because the event still reaches `logs/main.log`. That is the
 * whole of the bargain FR-008's confirmation puts to the user, so it is the one property of this
 * feature that must not rest on inspection: every accepted notice writes a record, at the level its
 * severity maps to, carrying enough to identify the event afterwards.
 *
 * ══ TIER: PARALLEL, DELIBERATELY ══
 *
 * This spec seeds display modes through the CONFIG ROOT (`THRONG_CONFIG_ROOT` + a `settings.json`
 * written before launch), never through the Preferences window, and it opens no context menu — the
 * panel renames below use the header's double-click affordance rather than the right-click menu.
 * It therefore steals no focus and stays out of `parallel-plan.json`'s serial list, which already
 * holds 103 entries; serialising a spec that does not need it costs the whole suite time. Its
 * sibling `notification-prefs.e2e.ts` drives the same settings through Preferences and IS serial.
 *
 * The one real shell here is a `cmd` that is started and immediately killed — short-lived, so it
 * does not starve at high worker counts the way `ping`/`findstr` loops do.
 *
 * ══ WHAT EXISTS AND WHAT DOES NOT ══
 *
 * The MAIN-side channel has landed in full: `preload.cts` exposes `throng.notices.log`,
 * `notice-log.ts` formats and writes it through `UiDiagnostics.logAlways`, and `main.ts` registers
 * it. The first test drives that channel directly and passes — it is the anchor that makes every
 * failure below mean "the renderer never called it" rather than "the log is broken".
 *
 * What does not exist is T025–T025c: `NotificationProvider` does not log anything at all.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect, type Page } from '@playwright/test';
import { addPanels, cleanupTemp, createProject, panelIds, runApp, settle } from './harness.js';

const cfgRoots: string[] = [];

/** A config root carrying `settings.json` BEFORE the app launches — no Preferences window needed. */
function seededCfgRoot(settings: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-notice-log-'));
  cfgRoots.push(dir);
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ version: 1, ...settings }), 'utf8');
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) cleanupTemp(dir);
});

/**
 * The notice records in this run's log, one string per line.
 *
 * Matched on the COMPONENT rather than on the text: `formatLogLine` renders
 * `<iso> <LEVEL> [<component>] <message>`, and `renderer-notice` is the component this feature
 * introduced precisely so a reader can tell main's own timeline from the renderer's notices.
 */
function noticeRecords(userDataDir: string): string[] {
  try {
    return readFileSync(join(userDataDir, 'logs', 'main.log'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.includes('[renderer-notice]'));
  } catch {
    return []; // the file may not exist yet — an empty list is the honest answer
  }
}

/** Records whose text matches, polled — the write is asynchronous IPC plus a file append. */
async function recordsMatching(userDataDir: string, pattern: RegExp): Promise<string[]> {
  let found: string[] = [];
  await expect
    .poll(
      () => {
        found = noticeRecords(userDataDir).filter((line) => pattern.test(line));
        return found.length;
      },
      { timeout: 15_000, message: `no [renderer-notice] record matching ${String(pattern)}` },
    )
    .toBeGreaterThan(0);
  return found;
}

/**
 * A real, CLASSIFIED error notice: a project whose folder does not exist.
 *
 * The explorer's first listing fails with `ENOENT … realpath`, which `speakFailure` classifies as
 * `path-missing` — so the notice carries a spoken message, a `causeKey`, and the raw errno in
 * `copyDetail`, which is what FR-034 requires to reach the log.
 */
async function ghostProject(win: Page, name: string): Promise<void> {
  await createProject(win, name, `C:/throng-e2e-missing/${name.toLowerCase()}`);
}

/** Rename a panel through its header, WITHOUT a context menu — this spec must stay parallel. */
async function renamePanel(win: Page, panelId: string, to: string): Promise<void> {
  await win.getByTestId(`panel-handle-${panelId}`).dblclick();
  const input = win.getByTestId(`panel-rename-input-${panelId}`);
  await expect(input).toBeVisible();
  await input.fill(to);
  // Asserted present above: a blind Enter goes wherever focus happens to be.
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}

/**
 * ANCHOR — the main-side channel, driven directly.
 *
 * Not a US1 behaviour; a diagnostic. Every other test in this file asserts that the RENDERER writes
 * a record, and if this one failed too they would all be reporting the same broken pipe under seven
 * different names. It also pins the line layout `log-channel.md` specifies, which is the only part
 * of the format the renderer cannot get wrong on its own.
 */
test('the notice log channel writes one line per record, with severity, subject and cause', async () => {
  await runApp(async (_app, win, ctx) => {
    await settle(win);
    await win.evaluate(() =>
      window.throng?.notices?.log({
        level: 'warn',
        severity: 'warning',
        message: 'Anchor: the channel is wired.',
        subject: 'Anchor Project — Tab 1 — one.txt',
        causeKey: 'path-missing:test 1',
        affectedCount: 3,
        detail: "ENOENT: no such file or directory, realpath 'D:\\anchor'",
      }),
    );

    const [head] = await recordsMatching(ctx.userDataDir, /Anchor: the channel is wired\./);
    // The LEVEL comes from the record, and the severity is a field of its own — `info` and
    // `success` are two severities and one level, so the level alone cannot carry FR-007.
    expect(head).toMatch(/\bWARN\b/);
    expect(head).toContain('severity=warning');
    expect(head).toContain('subject="Anchor Project — Tab 1 — one.txt"');
    expect(head).toContain('cause="path-missing:test 1"');
    expect(head).toContain('affected=3');
    // Prose after the pipe, so a message may contain anything at all.
    expect(head).toMatch(/\| Anchor: the channel is wired\.$/);

    // The raw system error is its own LINE, not an embedded newline: a log line is a line.
    const [detail] = await recordsMatching(ctx.userDataDir, /detail \| ENOENT/);
    expect(detail).toContain("realpath 'D:\\anchor'");
  });
});

/**
 * T015 — every accepted notice reaches the log, at the level its severity maps to.
 */
test('a displayed error notice writes a record at ERROR carrying its severity and message', async () => {
  const cfgRoot = seededCfgRoot({});
  await runApp(
    async (_app, win, ctx) => {
      await settle(win);
      await ghostProject(win, 'LoggedOne');
      // It is on screen — so the record below is about a notice the user really was shown, and a
      // missing record cannot be explained away as "the notice never happened".
      await expect(win.getByTestId('explorer-error')).toHaveCount(1, { timeout: 20_000 });

      const [record] = await recordsMatching(ctx.userDataDir, /severity=error/);
      expect(record).toMatch(/\bERROR\b/);
      // FR-007: the message the user read, verbatim, not a paraphrase composed for the log.
      expect(record).toContain('could not be found');
      expect(record).toContain('loggedone');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * T015 — and the same is true when the user has turned that severity OFF.
 *
 * This is the case the whole feature turns on. `error` is *Never display* here, seeded through the
 * config root, so there is nothing on screen at all — and the record has to be there anyway.
 */
test('a NEVER-DISPLAY error notice writes its record even though nothing is shown (FR-005/FR-006)', async () => {
  const cfgRoot = seededCfgRoot({
    notifications: { error: { mode: 'never', timeoutMs: 60000 } },
  });
  await runApp(
    async (_app, win, ctx) => {
      await settle(win);
      await ghostProject(win, 'SilentOne');
      // The project really did open, so the failure really was raised — the empty notice list below
      // is a decision and not an unrendered DOM.
      await expect(win.locator('.project-item[data-active="true"]')).toContainText('SilentOne');
      await win.waitForTimeout(2000);
      await expect(win.getByTestId('explorer-error')).toHaveCount(0);

      const [record] = await recordsMatching(ctx.userDataDir, /severity=error/);
      expect(record).toMatch(/\bERROR\b/);
      expect(record).toContain('could not be found');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * T015 (subject half) — ENABLED BY US2 (T031/T033a), and live.
 *
 * FR-007 asks the record to carry the notice's SUBJECT. `NoticeInput.subject` is now required and
 * the explorer's shared raiser threads the folder it was listing, so a record with no subject is a
 * real failure rather than the absence of a field. The fixme is removed as the task that enabled it
 * (T029) predicted.
 */
test('the record names the subject the notice is about (FR-007)', async () => {
  const cfgRoot = seededCfgRoot({ notifications: { error: { mode: 'never', timeoutMs: 60000 } } });
  await runApp(
    async (_app, win, ctx) => {
      await settle(win);
      await ghostProject(win, 'SubjectOne');
      const [record] = await recordsMatching(ctx.userDataDir, /severity=error/);
      expect(record).toMatch(/subject="[^"]*subjectone[^"]*"/i);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * T015b — the log LEVEL THRESHOLD must not eat a notice record.
 *
 * Every ordinary write in `createFileLog` opens `if (!passesThreshold(threshold, level)) return;`,
 * so with `diagnostics.logLevel: 'error'` an `info` or `warning` notice would reach nowhere at all
 * — not the screen if the user silenced it, and not the file because the threshold ate it.
 * Silently. `logAlways` exists for exactly this and the handler must use it (FR-006b).
 *
 * Both notices are left VISIBLE here on purpose. The screen assertions prove the producers fired,
 * so a failure below is unambiguously about the log and never about a warning that never happened.
 */
test('info and warning records survive diagnostics.logLevel: error (FR-006b)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-notice-log-thresh-'));
  const cfgRoot = seededCfgRoot({
    diagnostics: { logLevel: 'error' },
    notifications: {
      warning: { mode: 'dismiss', timeoutMs: 60000 },
      info: { mode: 'timed', timeoutMs: 60000 },
    },
  });
  try {
    await runApp(
      async (_app, win, ctx) => {
        await settle(win);
        await createProject(win, 'ThreshProj', root);
        await addPanels(win, 2);
        const ids = await panelIds(win);
        expect(ids.length).toBeGreaterThanOrEqual(3);

        // ── A WARNING: two panels, one name. The daemon adjusts the second and says so once.
        await renamePanel(win, ids[0]!, 'Build');
        await win.waitForTimeout(1500); // the layout write is debounced; the claim reads what is saved
        await renamePanel(win, ids[1]!, 'Build');
        const warned = win.getByTestId('panel-name-adjusted');
        await expect(warned).toBeVisible({ timeout: 15_000 });

        // ── An INFO: a terminal the USER ended. `unexpected` is false because the kill was asked
        // for, and `noticeSeverityForExit` maps that to `info` — the only `info` notice this
        // application raises anywhere (see the report on this spec).
        const term = ids[2]!;
        await win.getByTestId(`panel-type-select-${term}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${term}`).click();
        await expect(win.getByTestId(`terminal-${term}`)).toContainText(basename(root), {
          timeout: 20_000,
        });
        await win.evaluate((id) => window.throng?.terminal?.kill?.(id), term);
        const exited = win.getByTestId(`panel-exit-${term}`);
        await expect(exited).toBeVisible({ timeout: 20_000 });
        await expect(exited).toHaveClass(/notice--info/);

        // Both are on screen. Both must be in the file, under a threshold that admits neither.
        const [warning] = await recordsMatching(ctx.userDataDir, /severity=warning/);
        expect(warning).toMatch(/\bWARN\b/);
        expect(warning).toContain('Build (2)');

        const [info] = await recordsMatching(ctx.userDataDir, /severity=info/);
        expect(info).toMatch(/\bINFO\b/);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(root);
  }
});

/**
 * T015c — a silenced notice is de-duplicated exactly as a displayed one is (SC-003, FR-005b).
 *
 * A displayed notice gets this for free: `notify` compares the incoming content against the LIVE
 * list and drops a match. A silenced notice never enters that list, so without the `silencedRecently`
 * shadow (T025a) a watcher re-reporting one unchanged failure writes a record per repeat, and
 * SC-003's "exactly as often as when displayed" is false in the direction nobody checks.
 *
 * The repeat is exact by construction: `panel-name-service.claim` excludes the claiming panel from
 * the taken set, so asking for "Build" twice from the same panel is granted "Build (2)" both times
 * and the two notices are character-identical.
 */
test('the same event raised twice under Never display writes ONE record, not two (SC-003)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-notice-log-dedupe-'));
  const cfgRoot = seededCfgRoot({
    notifications: { warning: { mode: 'never', timeoutMs: 60000 } },
  });
  try {
    await runApp(
      async (_app, win, ctx) => {
        await settle(win);
        await createProject(win, 'DedupeProj', root);
        await addPanels(win, 1);
        const ids = await panelIds(win);
        expect(ids.length).toBeGreaterThanOrEqual(2);

        await renamePanel(win, ids[0]!, 'Build');
        await win.waitForTimeout(1500);
        await renamePanel(win, ids[1]!, 'Build');
        await expect(win.getByTestId(`panel-title-${ids[1]!}`)).toHaveText('Build (2)');
        // That the notice is not SHOWN under this mode is the subject of the never-display test
        // above, and is deliberately not re-asserted here: `toHaveCount(0)` taken immediately after
        // a rename is satisfied by a DOM that has not mounted the notice yet, which is a wait
        // dressed as an assertion. What this test is about is what reaches the FILE.

        // The SAME event again: the same panel asking for the same taken name, granted the same
        // adjustment, producing the same sentence.
        await win.waitForTimeout(1500);
        await renamePanel(win, ids[1]!, 'Build');
        await expect(win.getByTestId(`panel-title-${ids[1]!}`)).toHaveText('Build (2)');

        const records = await recordsMatching(ctx.userDataDir, /severity=warning/);
        expect(
          records,
          'two raises of one unchanged event must leave one record, as they do when displayed',
        ).toHaveLength(1);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(root);
  }
});

/**
 * T015e — the raw system error reaches the log (FR-034).
 *
 * FR-034 forbids rendering it, and for a silenced severity there is no toast to copy it from — so
 * the log is the ONLY route by which `ENOENT: … realpath '…'` reaches the person trying to work out
 * what happened. It is written on its own line, `detail | …`, so one notice never has to be
 * reassembled from a wrapped fragment.
 */
test('the record carries the raw system error on its own line (FR-034)', async () => {
  const cfgRoot = seededCfgRoot({
    notifications: { error: { mode: 'never', timeoutMs: 60000 } },
  });
  await runApp(
    async (_app, win, ctx) => {
      await settle(win);
      await ghostProject(win, 'DetailOne');
      await expect(win.locator('.project-item[data-active="true"]')).toContainText('DetailOne');

      const [detail] = await recordsMatching(ctx.userDataDir, /detail \| /);
      // The errno, verbatim — the part a user cannot accurately retype and the part the spoken
      // message deliberately drops.
      expect(detail).toMatch(/ENOENT|Cannot lock/);
      expect(detail.toLowerCase()).toContain('detailone');
      // …and it is NOT smuggled into the head line's prose, which the user reads.
      const [head] = await recordsMatching(ctx.userDataDir, /severity=error/);
      expect(head).not.toContain('ENOENT');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * T015a — FIXME until US3.
 *
 * Two halves, one requirement. A notice suppressed as a duplicate or by cause writes NO record; a
 * notice that GROWS — the same cause claiming further panels — writes a further record naming them
 * (FR-006a). The growth half cannot be constructed at all until `affected` exists on the notice
 * model, which is T044, and the two halves are one behaviour: a model that records growth without
 * suppressing repeats writes a record per repeat.
 *
 * ENABLED BY: T038, by name.
 */
test.fixme('a growing notice writes a further record naming the panels that joined (FR-006a)', async () => {
  // Needs `affected` on NoticeInput (T044) and the consolidated raise (T050).
  expect(true).toBe(false);
});

/**
 * T015d — FIXME until US3.
 *
 * The mirror of the rule above, and the one that stops the shadow from over-suppressing: a silenced
 * notice reporting a panel NOT YET REPORTED for its group key does write a record (FR-005c). The
 * duplicate key contains nothing that changes when new panels are discovered, so without this the
 * silenced path records the first batch and nothing after it — for a cause that keeps claiming
 * panels, that is most of the story missing from the only record there is.
 *
 * ENABLED BY: T038, alongside T015a.
 */
test.fixme('a silenced notice reporting a newly discovered panel writes a record (FR-005c)', async () => {
  // Needs `affected` and the `reported` panel-id set on the shadow entry (T025b, T044).
  expect(true).toBe(false);
});

/**
 * T015f — FIXME until US3.
 *
 * FR-048a: a notice carrying per-panel errors writes one further line per panel, each naming its
 * own. `affected` does not exist on `NoticeInput` until T044, so no US1 test can construct such a
 * notice — the handler's ability to WRITE those lines is already there (`noticeLogLines`) and is
 * pinned by the anchor test above; what is missing is anything to populate them from.
 *
 * ENABLED BY: T038, alongside T015a and T015d.
 */
test.fixme('a notice with per-panel errors writes one further line per panel (FR-048a)', async () => {
  // Needs `affectedDetails` populated from `affected` (T025c + T044/T050).
  expect(true).toBe(false);
});
