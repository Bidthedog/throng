/**
 * 030 FR-006/FR-006b/FR-007/FR-034/FR-048a — a notice record, from the bridge to a real file.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/notice-logging.e2e.ts` (034 FR-045/FR-046), specifically
 * "info and warning records survive diagnostics.logLevel: error (FR-006b)" — the most expensive
 * test in that file, which drove two panel renames past a debounced layout write and started a real
 * `cmd` shell in order to ask one question about a text file.
 *
 * ══ WHAT THIS PROVES THAT NOTHING CHEAPER DOES ══
 *
 * Main's half of the channel, assembled as `main.ts` assembles it, against the disk:
 * `startUiDiagnostics` → `createFileLog` → `registerNoticeLogIpc` → `logs/main.log`. The threshold
 * is set to `error`, which is what would eat an `info` or a `warning` written the ordinary way, so
 * a handler that reached for `log()` instead of `logAlways()` — the exact defect FR-006b names —
 * reddens here.
 *
 * The neighbouring layers, verified by reading them rather than assumed:
 *   • `packages/ui/tests/unit/notice-log.test.ts:184` proves the handler calls `logAlways` and
 *     stamps the `renderer-notice` component, against a FAKE sink — no file, no threshold.
 *   • `packages/platform-windows/tests/integration/file-log.integration.test.ts:60` proves
 *     `logAlways` outruns the threshold, but calls the log DIRECTLY — the notice channel is not in
 *     that picture at all.
 * Neither composes the two, and the composition is where a wiring mistake lives: `diagnostics.ts:69`
 * is one line forwarding `logAlways`, and forwarding it to `log` instead would satisfy both tests
 * above while silently dropping every silenced `info` and `warning` notice on the floor.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Change `LEVEL` below from `'error'` to `'debug'`. The threshold then admits everything, so the
 * three `logAlways`-specific assertions ("survives a threshold that would eat it") stop being able
 * to fail while still passing — which is exactly the shape of a vacuous test, and is why the
 * ordinary `log.info` control line is written in the same run: it MUST be absent, and its absence
 * is what proves the threshold was genuinely in force.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { noticeLogRecord, type LogLevel } from '@throng/core';
import { startUiDiagnostics, type UiDiagnostics } from '../../src/main/diagnostics.js';
import {
  NOTICE_LOG_CHANNEL,
  registerNoticeLogIpc,
  type NoticeLogIpc,
} from '../../src/main/notice-log.js';

/** The quietest useful setting — and the one that would eat every notice below (FR-006b). */
const LEVEL: LogLevel = 'error';

let userDataDir: string;
let diagnostics: UiDiagnostics;
let send: (payload: unknown) => void;

/** The `ipcMain` surface `registerNoticeLogIpc` narrows to, with a way to fire it. */
function ipcHarness(): { ipc: NoticeLogIpc; fire: (payload: unknown) => void } {
  const listeners: Array<(event: unknown, payload: unknown) => void> = [];
  return {
    ipc: {
      on(channel, listener) {
        expect(channel, 'the handler registered on some other channel').toBe(NOTICE_LOG_CHANNEL);
        listeners.push(listener);
      },
    },
    fire(payload) {
      expect(listeners.length, 'nothing registered a handler at all').toBeGreaterThan(0);
      for (const listener of listeners) listener({}, payload);
    },
  };
}

/** The log file's contents, or '' before anything has been written. */
function logText(): string {
  try {
    return readFileSync(join(userDataDir, 'logs', 'main.log'), 'utf8');
  } catch {
    return '';
  }
}

/** Just the renderer's notice records — main's own timeline is stamped `ui-main`. */
function noticeLines(): string[] {
  return logText()
    .split(/\r?\n/)
    .filter((line) => line.includes('[renderer-notice]'));
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'throng-notice-log-'));
  diagnostics = startUiDiagnostics({
    userDataDir,
    version: '0.0.0-test',
    buildId: 'test',
    level: LEVEL,
  });
  const harness = ipcHarness();
  registerNoticeLogIpc(diagnostics, harness.ipc);
  send = harness.fire;
});

afterEach(() => {
  // Tolerated rather than asserted: on Windows a log file the OS has not finished releasing throws
  // EBUSY, and a temp directory left behind is not what any test in this file is about.
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* the temp directory outlives the run; nothing here depends on it going */
  }
});

describe('the configured log level must not eat a notice record (FR-006b)', () => {
  it('writes info and warning records under a threshold of error, and an ordinary write is not', () => {
    /*
     * The CONTROL first, and it is what makes the two assertions after it mean something. An
     * ordinary `info` at this threshold must reach nowhere — if it does reach the file, the
     * threshold was never in force and the two records below prove nothing whatever.
     */
    diagnostics.log.info('an ordinary write, below the threshold');

    send(noticeLogRecord({ severity: 'warning', message: 'Another panel is already called Build (2).' }));
    send(noticeLogRecord({ severity: 'info', message: 'The terminal you closed has exited.' }));

    const text = logText();
    expect(text, 'the threshold let an ordinary sub-threshold write through').not.toContain(
      'an ordinary write, below the threshold',
    );

    const lines = noticeLines();
    expect(lines, 'a notice record was eaten by the level threshold').toHaveLength(2);
    expect(lines[0]).toContain('WARN');
    expect(lines[0]).toContain('severity=warning | Another panel is already called Build (2).');
    expect(lines[1]).toContain('INFO');
    expect(lines[1]).toContain('severity=info | The terminal you closed has exited.');
  });

  it('stamps every notice record with its own component, so main’s timeline stays separable', () => {
    // The reason `noticeLines()` above can filter at all. `ui-main` is the log's own component; a
    // reader who cannot tell main's events from the renderer's notices has to guess.
    diagnostics.log.error('a failure main itself reported');
    send(noticeLogRecord({ severity: 'error', message: 'It could not be found.' }));

    const lines = logText().split(/\r?\n/).filter(Boolean);
    expect(lines.some((l) => l.includes('[ui-main]') && l.includes('a failure main itself reported'))).toBe(true);
    expect(lines.some((l) => l.includes('[renderer-notice]') && l.includes('It could not be found.'))).toBe(true);
  });
});

describe('one record, one line per fact, in the file (FR-007/FR-034/FR-048a)', () => {
  it('writes the subject, the cause and the raw system error the notice refused to render', () => {
    send(
      noticeLogRecord({
        severity: 'error',
        message: 'It could not be found. It may have been moved, renamed or deleted.',
        subject: { kind: 'folder', name: 'loggedone', dir: 'C:\\throng-e2e-missing' },
        causeKey: 'path-missing:loggedone',
        detail: "ENOENT: no such file or directory, realpath 'C:\\throng-e2e-missing\\loggedone'",
      }),
    );

    const lines = noticeLines();
    expect(lines).toHaveLength(2);
    // FR-007 — the head line identifies the event without the screen.
    expect(lines[0]).toContain('subject="C:\\throng-e2e-missing — loggedone"');
    expect(lines[0]).toContain('cause="path-missing:loggedone"');
    expect(lines[0]).toContain('| It could not be found.');
    // FR-034 — the errno is on its OWN line, so a notice never has to be reassembled from a wrapped
    // fragment, and it is NOT in the prose the user read.
    expect(lines[0], 'the raw system error leaked into the head line').not.toContain('ENOENT');
    expect(lines[1]).toContain(
      "detail | ENOENT: no such file or directory, realpath 'C:\\throng-e2e-missing\\loggedone'",
    );
  });

  it('writes one further line per affected panel, each carrying that panel’s own error', () => {
    send(
      noticeLogRecord({
        severity: 'error',
        message: 'Some panels could not be opened.',
        subject: { kind: 'project', name: 'Ghost' },
        affectedCount: 2,
        affectedDetails: [
          { panel: 'Tab 1 — Shell', detail: 'Cannot lock "C:\\ghost": the path does not exist' },
          { panel: 'Tab 1 — Docs', detail: "ENOENT: no such file or directory, open 'C:\\ghost\\two.txt'" },
        ],
      }),
    );

    const lines = noticeLines();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('affected=2 | Some panels could not be opened.');
    expect(lines[1]).toContain('panel="Tab 1 — Shell" detail | Cannot lock "C:\\ghost"');
    expect(lines[2]).toContain('panel="Tab 1 — Docs" detail | ENOENT');
    // Four lines in the file for this one record — the three above plus the trailing newline's
    // empty tail. A record folded onto one line would leave `noticeLines()` at 1 and be unfindable
    // by the per-panel grep a reader actually runs.
    expect(logText().split(/\r?\n/).filter(Boolean)).toHaveLength(3);
  });
});
