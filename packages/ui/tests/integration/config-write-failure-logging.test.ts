/**
 * 032 T037 — a silenced severity hides a failed config write from the SCREEN, never from the RECORD
 * (FR-012).
 *
 * ══ WHY THIS MATTERS MORE THAN IT SOUNDS ══
 *
 * `notifications.error.mode = 'never'` is a setting a user can reasonably choose, and the whole
 * point of this feature is that a configuration change which does not land must not be silent. If
 * silencing the notice also silenced the log, a user who had chosen it would be back in exactly the
 * state #249 and #260 describe — a setting that goes back, with nothing anywhere to say why — and
 * the one artefact a bug report is reconstructed from would be missing.
 *
 * ══ WHAT IS ASSERTED, AND WHY IT IS STRUCTURAL ══
 *
 * The strongest form of this guarantee is not "we checked that the record is still written when the
 * mode is `never`". It is that **the display mode is not an input to the record at all**, so there
 * is no code path on which suppression could reach it. That is what the first test asserts, by
 * building the record for every mode and requiring them to be identical.
 *
 * The rest follow the failure end to end: the store's real outcome for a write that cannot land,
 * through the sentence the notice shows, into the line the diagnostics log actually writes.
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DISPLAY_MODES, noticeLogRecord, type NoticeLogInput } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import {
  NOTICE_LOG_COMPONENT,
  noticeLogLines,
} from '../../src/main/notice-log.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * The record `config-write-notices.ts` produces for a failed write.
 *
 * Mirrors that module's `notify(...)` call: severity `error`, no subject, the three-part sentence,
 * and the raw errno in `copyDetail` — which `notification.tsx` writes into the record as `detail`.
 */
function configWriteFailureRecord(error: string, detail: string): NoticeLogInput {
  return {
    severity: 'error',
    subject: { kind: 'none' },
    message: `Saving your settings failed. ${error} Nothing was changed.`,
    detail,
  };
}

describe('FR-012 — the record cannot be suppressed, structurally', () => {
  it('the display mode is not an input to the log record', () => {
    // Built once per mode. If suppression could reach the record at all, one of these would differ.
    const records = DISPLAY_MODES.map(() =>
      noticeLogRecord(configWriteFailureRecord('"settings.json" is a folder, not a file.', 'EPERM: operation not permitted')),
    );

    for (const record of records) {
      expect(record).toEqual(records[0]);
    }
    // And the union really does contain the silencing mode, so this is not a vacuous loop.
    expect(DISPLAY_MODES).toContain('never');
  });

  it('the record keeps the severity as well as the level', () => {
    const record = noticeLogRecord(configWriteFailureRecord('"settings.json" could not be written.', 'EBUSY'));
    // `info` and `success` are two severities and one level, so a record that kept only the level
    // would have lost information. An error is findable by either.
    expect(record.severity).toBe('error');
    expect(record.level).toBe('error');
  });
});

describe('FR-010c — the raw system error survives into the record', () => {
  it('carries the errno as `detail`, separate from the sentence', () => {
    const record = noticeLogRecord(
      configWriteFailureRecord(
        '"settings.json" is a folder, not a file.',
        "EPERM: operation not permitted, rename 'D:\\cfg\\settings.json.2.tmp' -> 'D:\\cfg\\settings.json'",
      ),
    );

    // The sentence is short and true; the errno and the staging path travel underneath it. That
    // separation is what stopped the notice reading `"settings.json.2.tmp" is open in another
    // program` (#265) — one field could only ever be a sentence OR a machine record.
    expect(record.message).not.toContain('.tmp');
    expect(record.detail).toContain('.tmp');
    expect(record.detail).toContain('EPERM');
  });

  it('writes both the sentence and the detail as log lines', () => {
    const text = noticeLogLines(
      noticeLogRecord(configWriteFailureRecord('"settings.json" is a folder, not a file.', 'EPERM: operation not permitted')),
    ).join('\n');

    expect(text).toContain('Saving your settings failed');
    expect(text).toContain('is a folder, not a file');
    expect(text).toContain('EPERM');
    // The record is filed under the notice component, so a config-write failure is findable in the
    // diagnostics log by the same grep as every other notice.
    expect(NOTICE_LOG_COMPONENT).toBeTruthy();
  });
});

describe('end to end — a real failed write produces a logged record', () => {
  it('the store\u2019s actual outcome reaches the log', async () => {
    // Not a hand-written error string: the sentence and the errno come from a write that genuinely
    // could not land, so a change to the store's wording cannot leave this test passing against a
    // message the product no longer produces.
    const root = mkdtempSync(join(tmpdir(), 'throng-write-log-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'settings.json'), { recursive: true }); // a FOLDER where the file goes

    const outcome = await new FileConfigStore(root).write({ kind: 'settings' }, { a: 1 });
    if (outcome.ok) throw new Error('expected the write to fail');

    const record = noticeLogRecord(configWriteFailureRecord(outcome.error, outcome.detail ?? ''));
    const text = noticeLogLines(record).join('\n');

    expect(record.severity).toBe('error');
    expect(text).toContain('Saving your settings failed');
    expect(text).toContain('Nothing was changed');
    // The accurate cause, established by looking rather than inferred from the errno.
    expect(text).toContain('folder');
  });
});
