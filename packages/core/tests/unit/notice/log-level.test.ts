import { describe, it, expect } from 'vitest';
import { LOG_LEVELS, NOTICE_SEVERITIES, noticeLogLevel } from '@throng/core';

/**
 * 030 FR-006 — severity → diagnostic log level.
 *
 * Derived in core, once. Main writes the record and the renderer raises the notice, so if either end
 * mapped it for itself the two would disagree the first time a severity was added — and the symptom
 * would be a notice that is in the log at a level nobody thinks to filter for.
 *
 * The mapping is not the identity, which is the reason it needs a function at all: the log has four
 * levels and the notice model has four severities, and they are not the same four. `warning` and
 * `warn` are the same idea spelled differently, and `success` has no level of its own — it is an
 * `info` that happens to be good news.
 */

describe('noticeLogLevel (FR-006)', () => {
  it('maps error to error', () => {
    expect(noticeLogLevel('error')).toBe('error');
  });

  it('maps warning to warn — the two vocabularies differ by one letter and are not the same set', () => {
    expect(noticeLogLevel('warning')).toBe('warn');
  });

  it('maps info to info', () => {
    expect(noticeLogLevel('info')).toBe('info');
  });

  it('maps success to info — good news is still worth a record, at no special level', () => {
    expect(noticeLogLevel('success')).toBe('info');
  });

  /*
   * Nothing may map to `debug`. A notice was shown to a user (or deliberately silenced), which is
   * never a debugging detail — and `debug` is below the shipped threshold, so it would be dropped
   * before it reached the file and FR-006's guarantee would be silently false.
   */
  it('never maps a severity to debug', () => {
    for (const severity of NOTICE_SEVERITIES) {
      expect(noticeLogLevel(severity)).not.toBe('debug');
    }
  });

  it('returns a real LogLevel for every severity', () => {
    for (const severity of NOTICE_SEVERITIES) {
      expect(LOG_LEVELS).toContain(noticeLogLevel(severity));
    }
  });
});
