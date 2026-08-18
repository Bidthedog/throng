/**
 * 030 US1 (#224) — SILENCE ON SCREEN IS NEVER SILENCE IN THE RECORD, asked of the RENDERER.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/notice-logging.e2e.ts` (034 FR-045/FR-046).
 *
 * ══ WHY THIS LAYER, AND WHAT IS LEFT ABOVE IT ══
 *
 * The E2E file spent NINE Electron launches on one question that splits cleanly in three, and only
 * one third of it ever needed a browser:
 *
 *   • WHAT THE RENDERER DECIDES — that an accepted notice files exactly one record, that a silenced
 *     one files it anyway, that a repeat files none, that a growth files a further one naming what
 *     joined, and that the raw system error rides in `detail` and never in the message. Every one of
 *     those is `NotificationProvider.notify` reasoning about its own state, and that is this file.
 *   • WHAT THE LINE LOOKS LIKE in the file — `packages/ui/tests/unit/notice-log.test.ts`, which
 *     asserts the field layout, the `detail | …` line, the per-panel lines and the `logAlways` sink.
 *   • WHAT REACHES THE DISK under a threshold that would eat it —
 *     `packages/ui/tests/integration/notice-log-file.integration.test.ts` (new, this migration) and
 *     `packages/platform-windows/tests/integration/file-log.integration.test.ts:60`.
 *
 * ONE E2E SURVIVES ON PURPOSE: "a displayed error notice writes a record at ERROR carrying its
 * severity and message". Nothing below this comment can see the preload bridge, main's handler
 * registration or the real `logs/main.log`, so deleting the last end-to-end witness of that pipe
 * would be a coverage loss dressed as a migration. It is the cheapest launch in the file — a project
 * on a folder that never existed, no shell, no restore.
 *
 * ══ THE FAILURES ARE REAL, NOT COMPOSED ══
 *
 * The classified cases drive `useErrorNotice` — the ONE raiser the explorer, the projects panel and
 * sub-workspaces all share — with the literal `ENOENT … realpath` string the E2E's ghost project
 * produced. So the classification, the spoken sentence, the `causeKey` and the demoted raw error are
 * all the production path's, not a fixture's.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Remove the `NotificationProvider` element from `mount()` below (leaving `ConfigProvider` and the
 * probe). `useNotify`/`useErrorNotice` throw rather than defaulting, so EVERY test in this file
 * fails — 9 of 9. Nothing here is an absence assertion standing on its own: each of the two
 * "nothing was rendered" checks sits beside a POSITIVE assertion that the record was nonetheless
 * filed, so an empty DOM cannot make either of them pass.
 */
import { render, screen, waitFor, act } from '@testing-library/react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AffectedPanel, NoticeSubject } from '@throng/core';
import {
  NotificationProvider,
  useErrorNotice,
  useNotify,
  type NoticeInput,
} from '../../src/renderer/common/notification.js';
import { ConfigProvider, useAppSettings, useConfigLoaded } from '../../src/renderer/config/config-store.js';

/** The record shape `noticeLogRecord` produces, as the bridge receives it. */
interface LoggedRecord {
  level: string;
  severity: string;
  message: string;
  subject: string;
  title?: string;
  action?: string;
  causeKey?: string;
  affectedCount?: number;
  detail?: string;
  affectedDetails?: readonly { panel: string; detail: string }[];
}

let logged: LoggedRecord[] = [];
/** The settings payload `ConfigProvider` will pull. Partial — the parse fills every other key. */
let settingsPayload: Record<string, unknown> = { version: 1 };

/**
 * The raw error the E2E's ghost project really produced, verbatim.
 *
 * `kindFromMessage` matches `^ENOENT`, `subjectFromMessage` takes the last segment inside the quotes,
 * and `causeMessage` speaks it — so everything asserted below about the wording is derived, here, by
 * the same code that derives it in the application.
 */
const GHOST_ENOENT =
  "ENOENT: no such file or directory, realpath 'C:\\throng-e2e-missing\\loggedone'";

const GHOST_SUBJECT: NoticeSubject = { kind: 'folder', name: 'loggedone' };

beforeEach(() => {
  logged = [];
  settingsPayload = { version: 1 };
  (window as unknown as { throng: unknown }).throng = {
    notices: {
      log: (record: LoggedRecord) => {
        logged.push(record);
      },
    },
    config: {
      get: () => Promise.resolve({ settings: settingsPayload }),
    },
  };
});

afterEach(() => {
  delete (window as unknown as { throng?: unknown }).throng;
});

/** Everything the harness hands back to a test: the raise function and the resolved display mode. */
interface Probe {
  notify?: (input: NoticeInput) => void;
  loaded?: boolean;
  errorMode?: string;
}

function ProbeView({ into }: { into: Probe }): ReactElement | null {
  into.notify = useNotify().notify;
  into.loaded = useConfigLoaded();
  into.errorMode = useAppSettings().notifications.error.mode;
  return null;
}

/**
 * Mount the provider over the real config store, and do not return until the seeded settings have
 * actually landed.
 *
 * The wait is not politeness. `notify` reads the display settings at RAISE time (FR-016), so a raise
 * issued before the payload arrives is decided by the SHIPPED defaults — and a *Never display* test
 * that raced the provider would silently become a *Dismiss only* test and pass for the wrong reason.
 */
async function mount(children?: ReactNode): Promise<Probe> {
  const probe: Probe = {};
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        NotificationProvider,
        null,
        // Keyed because two children make an array, and React warns about an unkeyed one — noise in
        // a file whose whole subject is what did and did not get reported.
        createElement(ProbeView, { into: probe, key: 'probe' }),
        children ?? null,
      ),
    ),
  );
  await waitFor(() => {
    expect(probe.loaded, 'the seeded settings never reached the config store').toBe(true);
  });
  return probe;
}

/** Seed `notifications` before mounting — the config-root equivalent of the E2E's `settings.json`. */
function silence(...severities: readonly ('error' | 'warning' | 'info' | 'success')[]): void {
  const notifications: Record<string, unknown> = {};
  for (const severity of severities) notifications[severity] = { mode: 'never', timeoutMs: 30000 };
  settingsPayload = { version: 1, notifications };
}

/** A panel casualty, as the consolidated raise builds them (`notice/affected.ts`). */
function panel(id: string, name: string, order: number, detail?: string): AffectedPanel {
  return {
    panelId: id,
    panelName: name,
    tabId: 't1',
    tabName: 'Tab 1',
    tabOrder: 0,
    panelOrder: order,
    ...(detail ? { detail } : {}),
  };
}

/** The consolidated raise's shape: one group key, one project subject, a list that grows. */
function consolidated(affected: readonly AffectedPanel[]): NoticeInput {
  return {
    severity: 'error',
    message: 'Some panels could not be opened.',
    subject: { kind: 'project', name: 'Ghost' },
    testId: 'panel-failure-notice',
    causeKey: 'path-missing:ghost',
    groupKey: 'path-missing:ghost|Ghost',
    copyDetail: "Cannot lock \"C:\\throng-e2e-missing\\ghost\": the path does not exist",
    affected,
  };
}

/** The rendered notice cards, whatever raised them. */
function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.notice'));
}

describe('every accepted notice files exactly one record (FR-006)', () => {
  it('files it at the level the severity maps to, carrying the message the user read', async () => {
    // The E2E's first ghost project, through the raiser the explorer really uses.
    await mount(
      createElement(function Raiser(): null {
        useErrorNotice(GHOST_ENOENT, 'explorer-error', GHOST_SUBJECT);
        return null;
      }),
    );

    // On screen — so the record below is about a notice the user really was shown, and a missing
    // record cannot be explained away as "the notice never happened".
    const card = screen.getByTestId('explorer-error');
    expect(card).toHaveTextContent('could not be found');

    expect(logged, 'one accepted notice must file exactly one record').toHaveLength(1);
    const [record] = logged;
    expect(record!.level).toBe('error');
    expect(record!.severity).toBe('error');
    // FR-007 — the message the user read, verbatim, not a paraphrase composed for the log.
    expect(record!.message).toBe(card.querySelector('.notice__message')?.textContent);
    expect(record!.message).toContain('could not be found');
  });

  it('names the subject the notice is about (FR-007)', async () => {
    await mount(
      createElement(function Raiser(): null {
        useErrorNotice(GHOST_ENOENT, 'explorer-error', GHOST_SUBJECT);
        return null;
      }),
    );
    expect(logged).toHaveLength(1);
    // Through `formatSubject`, with NO context: a log line has no heading above it to lean on.
    expect(logged[0]!.subject).toBe('loggedone');
    // …and the cause the classifier settled on, so a reader can group the record with its siblings.
    expect(logged[0]!.causeKey).toBe('path-missing:loggedone');
  });

  it('carries the raw system error in `detail`, and keeps it out of the message (FR-034)', async () => {
    await mount(
      createElement(function Raiser(): null {
        useErrorNotice(GHOST_ENOENT, 'explorer-error', GHOST_SUBJECT);
        return null;
      }),
    );
    expect(logged).toHaveLength(1);
    // The errno, verbatim — the part a user cannot accurately retype, and for a silenced severity
    // there is no toast to copy it from, so this is its only route to them.
    expect(logged[0]!.detail).toBe(GHOST_ENOENT);
    // …and it is NOT smuggled into the prose the user reads.
    expect(logged[0]!.message).not.toContain('ENOENT');
  });
});

describe('a severity the user turned off (FR-005/FR-005b/FR-006)', () => {
  it('renders nothing at all, and files the record anyway', async () => {
    silence('error');
    const probe = await mount();
    expect(probe.errorMode, 'the Never-display mode never reached the provider').toBe('never');

    act(() => {
      probe.notify!({
        severity: 'error',
        message: 'It could not be found. It may have been moved, renamed or deleted.',
        subject: { kind: 'folder', name: 'silentone' },
        testId: 'explorer-error',
        causeKey: 'path-missing:silentone',
        copyDetail: GHOST_ENOENT,
      });
    });

    // Both halves in one test, deliberately: the absence is only meaningful beside the record.
    expect(cards(), 'a Never-display notice was rendered').toHaveLength(0);
    expect(logged, 'a silenced notice filed no record — the bargain FR-005 offers is void').toHaveLength(1);
    expect(logged[0]!.severity).toBe('error');
    expect(logged[0]!.level).toBe('error');
    expect(logged[0]!.message).toContain('could not be found');
  });

  it('files ONE record for the same event raised twice, exactly as a displayed one would (SC-003)', async () => {
    // A warning with no cause — the panel-name adjustment the E2E used. Without a `causeKey` the
    // only thing that can suppress the repeat is the silenced shadow, which is what this is about.
    silence('warning');
    const probe = await mount();
    const adjustment: NoticeInput = {
      severity: 'warning',
      message: 'Another panel is already called Build, so this one is Build (2).',
      subject: { kind: 'panel', name: 'Build (2)', tab: 'Tab 1', project: 'DedupeProj' },
    };

    act(() => probe.notify!({ ...adjustment }));
    act(() => probe.notify!({ ...adjustment }));

    expect(
      logged,
      'two raises of one unchanged event must leave one record, as they do when displayed',
    ).toHaveLength(1);
    expect(logged[0]!.level).toBe('warn');
    expect(logged[0]!.message).toContain('Build (2)');
  });
});

describe('a notice that GROWS is a further event (FR-006a/FR-005c/FR-048a)', () => {
  it('files a further record naming the panels that joined, without rewriting the first', async () => {
    const probe = await mount();

    act(() => probe.notify!(consolidated([panel('p1', 'Shell', 0, 'Cannot lock: p1')])));
    expect(logged).toHaveLength(1);
    expect(logged[0]!.affectedCount).toBe(1);

    // A second panel defeated by the SAME absent folder joins the live notice rather than raising
    // its own — and that join is an event.
    act(() =>
      probe.notify!(
        consolidated([
          panel('p1', 'Shell', 0, 'Cannot lock: p1'),
          panel('p2', 'Docs', 1, 'Cannot lock: p2'),
        ]),
      ),
    );

    expect(logged, 'the growth filed no record of its own').toHaveLength(2);
    const growth = logged[1]!;
    expect(growth.affectedCount).toBe(2);
    // It NAMES what joined rather than merely counting: a record saying "now 2" would leave a reader
    // unable to tell which panel the second one was.
    expect(growth.message).toContain('Also affecting: Tab 1 — Docs.');
    expect(growth.message, 'the growth re-announced a panel already reported').not.toContain('Shell');
    // …and the first record stands unaltered beside it. Growth appends; it does not rewrite.
    expect(logged[0]!.affectedCount).toBe(1);
    expect(logged[0]!.message).not.toContain('Also affecting');

    // One notice on screen throughout — the growth joined it, it did not stack beside it.
    expect(cards()).toHaveLength(1);
  });

  it('does the same when the user cannot see any of it (FR-005c)', async () => {
    silence('error');
    const probe = await mount();

    act(() => probe.notify!(consolidated([panel('p1', 'Shell', 0, 'Cannot lock: p1')])));
    expect(cards(), 'a silenced consolidated notice was rendered').toHaveLength(0);
    expect(logged).toHaveLength(1);
    expect(logged[0]!.affectedCount).toBe(1);

    act(() =>
      probe.notify!(
        consolidated([
          panel('p1', 'Shell', 0, 'Cannot lock: p1'),
          panel('p2', 'Docs', 1, 'Cannot lock: p2'),
        ]),
      ),
    );

    /*
     * TWO records, and the second is the GROWTH record — the shape the displayed path writes, not a
     * lesser version of it. Two records each saying `affected=1` are what TWO UNRELATED FAILURES
     * look like, which is exactly the distinction the count exists to draw. Silencing a severity may
     * cost the user the screen; it may not cost them the record.
     */
    expect(logged).toHaveLength(2);
    expect(logged[1]!.affectedCount).toBe(2);
    expect(logged[1]!.message).toContain('Also affecting: Tab 1 — Docs.');
    expect(logged[0]!.affectedCount).toBe(1);

    // …and each record carries its OWN panel's raw error (FR-048a) — the growth record names only
    // the panel that joined, so between them the two records name both.
    const named = logged.flatMap((r) => (r.affectedDetails ?? []).map((d) => d.panel));
    expect(new Set(named).size).toBe(2);
    expect(named).toContain('Tab 1 — Shell');
    expect(named).toContain('Tab 1 — Docs');
  });

  it('files one per-panel detail per casualty, each naming its panel and its own error (FR-048a)', async () => {
    const probe = await mount();
    act(() =>
      probe.notify!(
        consolidated([
          panel('p1', 'Shell', 0, 'Cannot lock "C:\\ghost": the path does not exist'),
          panel('p2', 'Docs', 1, "ENOENT: no such file or directory, open 'C:\\ghost\\two.txt'"),
        ]),
      ),
    );

    expect(logged).toHaveLength(1);
    // The panel is named in the workspace's own terms — a log line has no group heading above it to
    // lean on, so it carries the tab too. The project is NOT repeated: the subject already states it.
    expect(logged[0]!.affectedDetails).toEqual([
      { panel: 'Tab 1 — Shell', detail: 'Cannot lock "C:\\ghost": the path does not exist' },
      {
        panel: 'Tab 1 — Docs',
        detail: "ENOENT: no such file or directory, open 'C:\\ghost\\two.txt'",
      },
    ]);
    // The head line, meanwhile, is still clean of every one of them (FR-034 both ways).
    expect(logged[0]!.message).not.toMatch(/Cannot lock|ENOENT/i);
    // …as is the notice on screen.
    expect(cards()[0]!.textContent ?? '').not.toMatch(/Cannot lock|ENOENT/i);
  });
});

describe('what is NOT logged', () => {
  it('files nothing for a notice suppressed as a duplicate of a live one', async () => {
    // The displayed half of SC-003: the same event twice while the first is still on screen. A
    // suppressed notice is the same event the log already carries, so a second record would be a
    // second event that never happened.
    const probe = await mount();
    const raise: NoticeInput = {
      severity: 'error',
      message: 'A file or folder with this name already exists.',
      subject: { kind: 'file', name: 'a.txt' },
      testId: 'explorer-error',
    };
    act(() => probe.notify!({ ...raise }));
    act(() => probe.notify!({ ...raise }));

    expect(cards(), 'the duplicate stacked a second notice').toHaveLength(1);
    expect(logged, 'a suppressed duplicate filed a record').toHaveLength(1);
  });
});
