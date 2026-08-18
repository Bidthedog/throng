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
 * Nothing here starts a shell any more: the three cases that configured terminals moved to the
 * component layer with the rest of US1 (see the note below).
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
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect, type Page } from '@playwright/test';
import { cleanupTemp, createProject, runApp, settle } from './harness.js';

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

/**
 * ANCHOR — the main-side channel, driven directly.
 *
 * Not a US1 behaviour; a diagnostic. Every other test in this file asserts that the RENDERER writes
 * a record, and if this one failed too they would all be reporting the same broken pipe under seven
 * different names. It also pins the line layout `log-channel.md` specifies, which is the only part
 * of the format the renderer cannot get wrong on its own.
 */
/*
 * DELETED (034 FR-045): "the notice log channel writes one line per record, with severity, subject
 * and cause".
 *
 * It launched Electron to call `window.throng.notices.log(...)` with a HAND-WRITTEN payload — no
 * notice, no failure, nothing the application did — and then asserted eight fields of the line that
 * came out. Every one of those fields is asserted directly on `noticeLogLines` in
 * `packages/ui/tests/unit/notice-log.test.ts`: the severity the level cannot carry, the quoted
 * subject, the quoted cause, the message after the bar, the affected count, omitted fields written
 * as nothing rather than as empties, the raw system error on its own line, an escaped quote inside a
 * quoted field, and a Windows path left exactly as the user would paste it. The channel itself has
 * seven more in the same file, including that it is the channel the preload actually sends on.
 *
 * What it uniquely reached was the real log FILE at the end of the bridge — and the test below it
 * reaches the same file from a REAL notice the user was shown, which is a strictly stronger witness
 * of the same path. A synthetic payload proves the pipe; a real failure proves the pipe and what is
 * put into it.
 */

/**
 * T015 — every accepted notice reaches the log, at the level its severity maps to.
 */
test('a displayed error notice writes a record at ERROR carrying its severity and message', { tag: ['@extended', '@failure'] }, async () => {
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
/*
 * MIGRATED (034 FR-045/FR-046) — EIGHT of this file’s nine tests, and eight of its nine Electron
 * launches. This was the heaviest file in batch 6 and it was heavy for one reason: it asked nine
 * separate applications what a text file contained.
 *
 * WHERE THEY WENT
 *
 *   packages/ui/tests/component/notice-log-emission.test.ts   (9 tests) — everything the RENDERER
 *     decides: that an accepted notice files exactly one record, that a silenced one files it
 *     anyway while rendering nothing, that a repeat files none, that a growth files a further
 *     record naming what joined and leaves the first unaltered, and that the raw system error
 *     rides in `detail` and never in the prose. `NotificationProvider.notify` reasoning about its
 *     own state — no window, no daemon, no shell, no disk.
 *
 *   packages/ui/tests/integration/notice-log-file.integration.test.ts   (4 tests) — the FR-006b
 *     case, which was the single most expensive test here: two panel renames past a debounced
 *     layout write plus a real `cmd` shell, to ask whether `diagnostics.logLevel: error` eats an
 *     `info` record. It now assembles main’s half exactly as `main.ts` does — `startUiDiagnostics`
 *     → `createFileLog` → `registerNoticeLogIpc` → a real `logs/main.log` — at a threshold of
 *     `error`, with an ordinary sub-threshold write beside it as the control.
 *
 * WHAT THE REPLACEMENTS ASSERT MORE STRONGLY THAN THIS FILE DID
 *
 *   • EXACTLY ONE RECORD, not "at least one". `recordsMatching` polled until a match appeared and
 *     then read `[0]`, so a provider filing a record twice — the StrictMode double-invoke this
 *     model was restructured to prevent — passed every test in this file. The component tests
 *     count the calls.
 *   • THE MESSAGE IS THE ONE THE USER READ, compared against the notice’s own rendered
 *     `.notice__message` node rather than against a substring the test chose.
 *   • THE GROWTH DOES NOT RE-ANNOUNCE. This file asserted the growth record matched /Terminal|Panel/;
 *     the replacement asserts it names `Tab 1 — Docs` and does NOT name the panel already reported.
 *   • THE PER-PANEL LINES ARE COMPARED WHOLE — panel name and errno, in order — rather than
 *     counted by a `Set` of extracted ids.
 *   • THE THRESHOLD IS PROVEN IN FORCE by an ordinary sub-threshold write that must be ABSENT from
 *     the same file. This file had no such control, so a run in which the level had silently
 *     defaulted to `debug` would have passed identically.
 *
 * WHAT DID NOT MOVE, AND WHY THE SURVIVOR IS NOT A LEFTOVER
 *
 * The test below is the only END-TO-END witness that the renderer’s record reaches the file at
 * all: preload `contextBridge` → `ipcRenderer.send` → main’s registration → `logs/main.log`. The
 * layers above cover both ENDS of that bridge and neither covers the bridge — the preload’s
 * channel name is a source grep (`tests/unit/notice-log.test.ts`), not a wiring proof. Deleting it
 * would be a coverage loss dressed as a migration, and it is the cheapest launch this file had: a
 * project on a folder that never existed, no shell, no restore, no second launch.
 *
 * It cannot share an app with anything (034 SC-010): it is now the only test in the file.
 *
 * ANTI-VACUITY CONTROL for the replacements: remove the `NotificationProvider` element from
 * `mount()` in the component file — `useNotify` throws rather than defaulting, and all 9 fail.
 * Neither "nothing was rendered" assertion stands alone; each sits beside a positive assertion
 * that the record was filed regardless, so an empty DOM cannot satisfy either.
 */

/**
 * T015 (subject half) — ENABLED BY US2 (T031/T033a), and live.
 *
 * FR-007 asks the record to carry the notice's SUBJECT. `NoticeInput.subject` is now required and
 * the explorer's shared raiser threads the folder it was listing, so a record with no subject is a
 * real failure rather than the absence of a field. The fixme is removed as the task that enabled it
 * (T029) predicted.
 */

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

/**
 * T015e — the raw system error reaches the log (FR-034).
 *
 * FR-034 forbids rendering it, and for a silenced severity there is no toast to copy it from — so
 * the log is the ONLY route by which `ENOENT: … realpath '…'` reaches the person trying to work out
 * what happened. It is written on its own line, `detail | …`, so one notice never has to be
 * reassembled from a wrapped fragment.
 */

/**
 * T015a — a notice that GROWS is a further event, and the log says so (FR-006a).
 *
 * A cause that keeps claiming panels writes one record when it first speaks and one more each time
 * it claims another. Without the second, a user who silenced the severity would have the first batch
 * of casualties in the log and every later one nowhere — which is most of the story missing from the
 * only record there is.
 */

/**
 * T015d — and the same is true when the user cannot see any of it (FR-005c).
 *
 * The silenced shadow suppresses a repeat, which is the whole of T015c. This is the other half: an
 * incoming notice naming a panel the shadow has NOT recorded is not a repeat, and must write its
 * record. The duplicate tuple — severity, message, title, action, testId, subject — contains nothing
 * that changes when a cause discovers a further panel, so without the `reported` set the shadow
 * records the first casualty and swallows every one after it.
 *
 * And the record it writes is the one T015a asserts for the DISPLAYED path, not a lesser version of
 * it: same growth message, same naming of what joined, same cumulative count. That is FR-005c's own
 * sentence — "matching the displayed growth record in content as well as in count" — and it is what
 * makes SC-003 true in the log rather than only in the count of lines.
 */

/**
 * T015f — one further line per panel, each carrying that panel's OWN error (FR-048a).
 *
 * The notice states the shared cause; the per-panel errno is what differs between casualties and is
 * never rendered (FR-034). Copy is one route to it and this file is the other, so a record that
 * counted its panels without carrying their errors would leave the machine text reachable nowhere
 * for a severity the user has silenced.
 */
