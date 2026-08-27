/**
 * 041 FR-013/FR-015 (#327) — WHAT IS REFUSED, AND WHAT IS MERELY MISSING.
 *
 * ══ WHY THIS DISTINCTION CARRIES THE WHOLE FEATURE ══
 *
 * FR-013 stops throng creating a panel for a file it will not open. `openInto` decides that BEFORE a
 * panel exists, and it decides it from this set — so the set is the difference between "no panel is
 * created" and "no panel is created for a file that should have had one".
 *
 * A MISSING file is not a refusal. 018 shipped a recovery path where a panel holds a recovered buffer
 * and can be saved back to write its contents out, and that panel only exists because the open was
 * allowed to proceed. Inverting this one predicate would delete that feature silently: no error, no
 * failing test anywhere near the editor, just a file the user could previously recover and now
 * cannot. It is the single highest-value assertion in this feature, which is why it is stated
 * positively here rather than left to the absence of a refusal somewhere else.
 *
 * ══ WHY THE SET LIVES IN CORE ══
 *
 * It was a renderer module's until 041. Main now needs it too, and main cannot import from the
 * renderer — one pure decision, two processes, which is Constitution II's test.
 */
import { describe, expect, it } from 'vitest';
import { NOT_A_MISSING_FILE, isMissingReason } from '../../../src/index.js';

describe('NOT_A_MISSING_FILE', () => {
  it('holds exactly the four reasons that are refusals', () => {
    // Enumerated, and asserted as a whole rather than member by member: the defect this set replaced
    // was a rule that silently classified every reason it had not heard of as a missing file, so what
    // matters is the boundary, not the members.
    expect([...NOT_A_MISSING_FILE].sort()).toEqual(['binary', 'folder', 'out-of-tree', 'too-large']);
  });
});

describe('isMissingReason', () => {
  it.each(['binary', 'too-large', 'out-of-tree', 'folder'])('says %s is NOT a missing file', (reason) => {
    expect(isMissingReason(reason)).toBe(false);
  });

  it('says a missing file IS missing, which is what keeps its recovery path (FR-015)', () => {
    expect(isMissingReason('missing')).toBe(true);
  });

  it('treats an unrecognised reason as missing, keeping 018 FR-061 behaviour unchanged', () => {
    // Deliberate. A reason nobody has enumerated is not a refusal, because refusing on an unknown
    // reason would create the exact defect 018 fixed — telling the user a file "may have been moved"
    // when throng simply declined to open it, or the reverse.
    expect(isMissingReason('io')).toBe(true);
    expect(isMissingReason('something-nobody-has-written-yet')).toBe(true);
  });
});
