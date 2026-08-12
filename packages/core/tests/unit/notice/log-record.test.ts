import { describe, it, expect } from 'vitest';
import { NOTICE_SEVERITIES, noticeLogLevel, noticeLogRecord } from '@throng/core';

/**
 * 030 FR-006/FR-007 — the record a notice becomes on its way to the diagnostic log.
 *
 * The factory exists so the renderer cannot compose a record by hand. Two things would go wrong if
 * it could: the level would be chosen at the call site (and drift from `noticeLogLevel`, filing
 * records under a level nobody filters for), and the subject would be whatever string that call site
 * happened to have — which is the ambiguity #195 is about, arriving in the log instead of the toast.
 */
describe('noticeLogRecord (FR-006, FR-007)', () => {
  it('derives the level from the severity rather than taking one', () => {
    for (const severity of NOTICE_SEVERITIES) {
      const record = noticeLogRecord({ severity, message: 'something happened' });
      expect(record.level).toBe(noticeLogLevel(severity));
      expect(record.severity).toBe(severity);
    }
  });

  it('carries severity separately, because the level cannot express it', () => {
    // `info` and `success` are one level and two severities. A reader of the file who only had the
    // level could never tell a confirmation from a notice — FR-007 requires the severity itself.
    const good = noticeLogRecord({ severity: 'success', message: 'Renamed.' });
    const neutral = noticeLogRecord({ severity: 'info', message: 'Renaming.' });
    expect(good.level).toBe(neutral.level);
    expect(good.severity).not.toBe(neutral.severity);
  });

  it('formats the subject through the one formatter, with no context elided', () => {
    // The toast may drop the project because its heading already names it. The log has no heading,
    // so a record must carry the WHOLE subject — a record naming "one.txt" and nothing else is the
    // same unanswerable question the notice used to ask.
    const record = noticeLogRecord({
      severity: 'error',
      message: 'Could not rename it.',
      subject: { kind: 'panel', name: 'one.txt', tab: 'Tab 1', project: 'Alpha' },
    });
    expect(record.subject).toBe('Alpha — Tab 1 — one.txt');
  });

  it('renders a subject of kind none as an empty string, never the word "none"', () => {
    const record = noticeLogRecord({ severity: 'info', message: 'x', subject: { kind: 'none' } });
    expect(record.subject).toBe('');
    expect(noticeLogRecord({ severity: 'info', message: 'x' }).subject).toBe('');
  });

  it('omits the optional fields it was not given, so a record has no empty labels', () => {
    const record = noticeLogRecord({ severity: 'warning', message: 'Careful.' });
    expect(record).toEqual({ level: 'warn', severity: 'warning', message: 'Careful.', subject: '' });
  });

  it('keeps the cause, the affected count and the raw system error when present (FR-034)', () => {
    const record = noticeLogRecord({
      severity: 'error',
      message: 'Could not open it.',
      subject: { kind: 'file', name: 'one.txt' },
      causeKey: 'path-missing',
      affectedCount: 3,
      detail: "ENOENT: no such file or directory, realpath 'D:\\one.txt'",
    });
    expect(record.causeKey).toBe('path-missing');
    expect(record.affectedCount).toBe(3);
    expect(record.detail).toBe("ENOENT: no such file or directory, realpath 'D:\\one.txt'");
  });

  it('drops a blank cause, detail or count instead of writing an empty field', () => {
    const record = noticeLogRecord({
      severity: 'error',
      message: 'Could not open it.',
      causeKey: '   ',
      detail: '',
      affectedCount: 0,
    });
    expect(record.causeKey).toBeUndefined();
    expect(record.detail).toBeUndefined();
    // Zero affected panels is not a fact worth a field; it is the absence of one.
    expect(record.affectedCount).toBeUndefined();
  });

  it('carries per-panel errors, dropping entries that name nothing (FR-048a)', () => {
    const record = noticeLogRecord({
      severity: 'error',
      message: 'Some panels could not be restored.',
      affectedDetails: [
        { panel: 'Tab 1 — one.txt', detail: 'EPERM: operation not permitted, open' },
        { panel: 'Tab 2 — two.txt', detail: '  ' },
      ],
    });
    expect(record.affectedDetails).toEqual([
      { panel: 'Tab 1 — one.txt', detail: 'EPERM: operation not permitted, open' },
    ]);
  });

  it('omits affectedDetails entirely when every entry was empty', () => {
    const record = noticeLogRecord({
      severity: 'error',
      message: 'x',
      affectedDetails: [{ panel: '', detail: '' }],
    });
    expect(record.affectedDetails).toBeUndefined();
  });

  it('produces a plain object that survives structured cloning across the IPC boundary', () => {
    const record = noticeLogRecord({
      severity: 'error',
      message: 'Could not rename it.',
      subject: { kind: 'file', name: 'one.txt', dir: 'D:\\work' },
      causeKey: 'name-taken',
      affectedDetails: [{ panel: 'Tab 1', detail: 'EPERM' }],
    });
    expect(structuredClone(record)).toEqual(record);
  });
});
