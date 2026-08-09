import { describe, it, expect } from 'vitest';
import { classifyFailure } from '@throng/core';

/**
 * 029 FR-011 / FR-011a / FR-011b — classification.
 *
 * The classified set is CLOSED. That is the whole design: a closed set has a completion signal and
 * can be tested to exhaustion, where an open-ended instruction to "classify errors" is a sweep with
 * no end (#195 is where sweeps belong). Everything unmatched keeps today's behaviour EXACTLY, which
 * is what guarantees this feature cannot make anything worse.
 */

/** A Node-shaped errno error, as `fs` actually throws it. */
function errno(code: string, message: string): NodeJS.ErrnoException {
  const e = new Error(message) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

describe('classifyFailure — the five kinds (FR-011a)', () => {
  it('classifies EBUSY as held', () => {
    const cause = classifyFailure(
      errno('EBUSY', "EBUSY: resource busy or locked, rename 'C:\\p\\Held' -> 'C:\\p\\Renamed'"),
      { subject: 'Held', operation: 'lock' },
    );
    expect(cause?.kind).toBe('held');
    expect(cause?.subject).toBe('Held');
  });

  it('classifies ENOENT as path-missing', () => {
    const cause = classifyFailure(errno('ENOENT', "ENOENT: no such file or directory, realpath 'C:\\gone'"), {
      subject: 'ProjectBravo',
      operation: 'access',
    });
    expect(cause?.kind).toBe('path-missing');
  });

  it('classifies EACCES as permission-denied', () => {
    const cause = classifyFailure(errno('EACCES', 'EACCES: permission denied, open'), {
      subject: 'notes.txt',
      operation: 'access',
    });
    expect(cause?.kind).toBe('permission-denied');
  });

  it('classifies ENOTEMPTY as not-empty', () => {
    const cause = classifyFailure(errno('ENOTEMPTY', 'ENOTEMPTY: directory not empty, rmdir'), {
      subject: 'Docs',
      operation: 'lock',
    });
    expect(cause?.kind).toBe('not-empty');
  });
});

describe('classifyFailure — the EPERM ambiguity (data-model.md)', () => {
  /*
   * Windows returns EPERM both for a held handle and for an ACL refusal, and the errno alone cannot
   * separate them. The OPERATION decides — and getting this backwards is the exact harm #196
   * reports: "operation not permitted" sends a user to check permissions for a lock.
   */
  it('resolves EPERM to held for a lock-class operation', () => {
    const cause = classifyFailure(errno('EPERM', 'EPERM: operation not permitted, rename'), {
      subject: 'PJ Replacement',
      operation: 'lock',
    });
    expect(cause?.kind).toBe('held');
  });

  it('resolves EPERM to permission-denied for an access-class operation', () => {
    const cause = classifyFailure(errno('EPERM', 'EPERM: operation not permitted, open'), {
      subject: 'PJ Replacement',
      operation: 'access',
    });
    expect(cause?.kind).toBe('permission-denied');
  });
});

describe('classifyFailure — unmatched failures pass through (FR-011b)', () => {
  it('returns null for an errno outside the closed set', () => {
    expect(
      classifyFailure(errno('ENOSPC', 'ENOSPC: no space left on device, write'), {
        subject: 'big.bin',
        operation: 'access',
      }),
    ).toBeNull();
  });

  it('returns null for an error with no errno at all', () => {
    expect(classifyFailure(new Error('something went sideways'), { subject: 'x', operation: 'access' })).toBeNull();
  });

  it('returns null for a non-Error throwable', () => {
    expect(classifyFailure('a string', { subject: 'x', operation: 'access' })).toBeNull();
  });
});

describe('classifyFailure — the raw text is carried, never replaced (FR-018)', () => {
  it('keeps the original message on the cause', () => {
    const raw = "EBUSY: resource busy or locked, rename 'C:\\p\\Held' -> 'C:\\p\\Renamed'";
    const cause = classifyFailure(errno('EBUSY', raw), { subject: 'Held', operation: 'lock' });
    expect(cause?.raw).toBe(raw);
  });

  it('carries a holder when one is supplied', () => {
    const cause = classifyFailure(errno('EBUSY', 'EBUSY: resource busy or locked, rename'), {
      subject: 'Inner',
      operation: 'lock',
      holder: { isThrong: true, panelTitle: 'Build' },
    });
    expect(cause?.holder).toEqual({ isThrong: true, panelTitle: 'Build' });
  });

  it('leaves holder absent when none is supplied — "not identified" is a real state (FR-012)', () => {
    const cause = classifyFailure(errno('EBUSY', 'EBUSY: resource busy or locked, rename'), {
      subject: 'Held',
      operation: 'lock',
    });
    expect(cause?.holder).toBeUndefined();
  });
});
