import { describe, it, expect } from 'vitest';
import { causeKey, groupKey, type FailureCause } from '@throng/core';

/**
 * 030 FR-029 / FR-029a / FR-029b — what decides that two failures are ONE notice.
 *
 * Renaming a project's root folder while it has editors and terminals open produces a failure per
 * casualty: today that is a storm of near-identical toasts. The key below is what collapses them,
 * and the two dimensions it carries are the two that make consolidation correct rather than merely
 * quiet — the CAUSE (so unrelated failures never merge) and the PROJECT (so "one notice per project"
 * is a property of the key rather than a rule somebody has to remember).
 *
 * It is built on 029's `causeKey` and does NOT widen `FailureKind` (FR-029b). The closed set is the
 * design: a set with a completion signal can be tested to exhaustion, and anything unmatched keeps
 * today's behaviour exactly.
 */

const cause = (kind: FailureCause['kind'], subject: string): FailureCause => ({
  kind,
  subject,
  raw: `${kind}: ${subject}`,
});

describe('groupKey — a classified cause (FR-029)', () => {
  it('builds the key from the cause key and the project', () => {
    const c = cause('path-missing', 'Alpha');
    expect(groupKey({ cause: c, projectId: 'p1' })).toBe(`${causeKey(c)}::p1`);
  });

  it('reuses 029 causeKey rather than re-deriving one from the message', () => {
    /*
     * The two failures measured on the missing-root path produce DIFFERENT message text for one
     * cause (`ENOENT … realpath` from the explorer, `Cannot lock …` from a terminal). A key derived
     * from text would collapse neither, which is the defect `causeKey` already solved — so this key
     * is built on it and inherits that property.
     */
    const explorer: FailureCause = { kind: 'path-missing', subject: 'Alpha', raw: "ENOENT: realpath 'C:\\Alpha'" };
    const terminal: FailureCause = { kind: 'path-missing', subject: 'Alpha', raw: 'Cannot lock C:\\Alpha' };
    expect(groupKey({ cause: explorer, projectId: 'p1' })).toBe(groupKey({ cause: terminal, projectId: 'p1' }));
  });

  it('separates two projects defeated by the same cause', () => {
    const c = cause('path-missing', 'root');
    expect(groupKey({ cause: c, projectId: 'p1' })).not.toBe(groupKey({ cause: c, projectId: 'p2' }));
  });

  it('separates two causes within one project', () => {
    expect(groupKey({ cause: cause('path-missing', 'Alpha'), projectId: 'p1' })).not.toBe(
      groupKey({ cause: cause('permission-denied', 'Alpha'), projectId: 'p1' }),
    );
  });

  it('spells an absent project as none, so a project-less failure still has one stable key', () => {
    const c = cause('daemon-stopped', 'daemon');
    expect(groupKey({ cause: c })).toBe(`${causeKey(c)}::none`);
    expect(groupKey({ cause: c })).toBe(groupKey({ cause: c, projectId: undefined }));
  });

  it('ignores an operation id when the failure is classified — the cause is the stronger key', () => {
    const c = cause('held', 'notes.txt');
    expect(groupKey({ cause: c, operationId: 'op-1', projectId: 'p1' })).toBe(
      groupKey({ cause: c, projectId: 'p1' }),
    );
  });
});

describe('groupKey — unclassified, with an operation (FR-029a)', () => {
  it('groups by the operation and the project', () => {
    expect(groupKey({ cause: null, operationId: 'open-42', projectId: 'p1' })).toBe('op:open-42::p1');
  });

  it('treats an absent cause the same as an explicit null', () => {
    expect(groupKey({ operationId: 'open-42', projectId: 'p1' })).toBe('op:open-42::p1');
  });

  it('gives two different operations two different keys (FR-036)', () => {
    expect(groupKey({ operationId: 'open-42', projectId: 'p1' })).not.toBe(
      groupKey({ operationId: 'open-43', projectId: 'p1' }),
    );
  });

  it('carries the project here too', () => {
    expect(groupKey({ operationId: 'open-42', projectId: 'p1' })).not.toBe(
      groupKey({ operationId: 'open-42', projectId: 'p2' }),
    );
    expect(groupKey({ operationId: 'open-42' })).toBe('op:open-42::none');
  });

  it('cannot collide with a classified key, because no FailureKind is spelled "op"', () => {
    const classified = groupKey({ cause: cause('held', 'x'), projectId: 'p1' });
    expect(classified).not.toBe(groupKey({ operationId: 'held:x', projectId: 'p1' }));
  });
});

describe('groupKey — neither', () => {
  it('returns undefined, so the notice does not consolidate and behaves as today', () => {
    expect(groupKey({})).toBeUndefined();
    expect(groupKey({ cause: null })).toBeUndefined();
    expect(groupKey({ projectId: 'p1' })).toBeUndefined();
  });

  it('treats an empty operation id as no operation rather than minting the key "op:::p1"', () => {
    expect(groupKey({ operationId: '', projectId: 'p1' })).toBeUndefined();
    expect(groupKey({ operationId: '   ', projectId: 'p1' })).toBeUndefined();
  });
});
