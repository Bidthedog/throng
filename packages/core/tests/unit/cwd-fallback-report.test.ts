import { describe, it, expect } from 'vitest';
import { fallbackToReport, resolveStartDirectory } from '@throng/core';

/**
 * 029 FR-005a / FR-005b — telling the user their remembered directory is gone, and not telling them
 * about the boundary throng enforces on purpose.
 *
 * ══ WHY THE TWO FALLBACKS ARE NOT THE SAME EVENT ══
 *
 * `resolveStartDirectory` falls back to the project root for two unrelated reasons: the directory is
 * GONE, or the directory ESCAPED THE PROJECT. They produce an identical outcome and deserve opposite
 * treatment. A missing folder is news the user can act on — #204's cycle leaves a shell at the root
 * with no explanation, which reads as "remember-my-directory is broken". An escaped folder is a rule
 * throng applies deliberately, and reporting it explains our own boundary at someone who never
 * crossed it on purpose.
 *
 * This lived inline in an Electron IPC handler, where the only way to exercise it was to launch the
 * whole app. The condition is a rule about two paths and a predicate, so it is tested as one.
 */

const ROOT = 'C:/proj';
const exists =
  (present: string[]) =>
  (p: string): boolean =>
    present.includes(p);

describe('fallbackToReport (029 FR-005b)', () => {
  it('reports a remembered directory that has GONE', () => {
    const cwd = resolveStartDirectory(ROOT, 'C:/proj/src', exists([]));
    expect(cwd).toBe(ROOT);
    expect(fallbackToReport('C:/proj/src', cwd, exists([]))).toBe('C:/proj/src');
  });

  it('says NOTHING when the remembered directory was honoured', () => {
    const remembered = 'C:/proj/src';
    const cwd = resolveStartDirectory(ROOT, remembered, exists([remembered]));
    expect(cwd).toBe(remembered);
    // The overwhelmingly common case. A notice here would appear on every single terminal start.
    expect(fallbackToReport(remembered, cwd, exists([remembered]))).toBeUndefined();
  });

  it('says NOTHING when nothing was remembered', () => {
    const cwd = resolveStartDirectory(ROOT, undefined, exists([]));
    expect(fallbackToReport(undefined, cwd, exists([]))).toBeUndefined();
  });

  it('says NOTHING when the directory still exists but ESCAPED the project', () => {
    // Still on disk, so the fallback was containment, not loss. This is the case the naive condition
    // ("we fell back, so say so") gets wrong, and it would nag on every start of a panel whose
    // remembered path sits outside its project.
    const outside = 'C:/elsewhere/src';
    const cwd = resolveStartDirectory(ROOT, outside, exists([outside]));
    expect(cwd).toBe(ROOT);
    expect(fallbackToReport(outside, cwd, exists([outside]))).toBeUndefined();
  });

  it('DOES report a directory that both escaped and vanished', () => {
    // Gone is gone. Containment is irrelevant once there is nothing to contain, and the user's
    // remembered directory really has disappeared.
    const outside = 'C:/elsewhere/src';
    const cwd = resolveStartDirectory(ROOT, outside, exists([]));
    expect(fallbackToReport(outside, cwd, exists([]))).toBe(outside);
  });

  it('is not fooled by a separator or case difference between the two paths', () => {
    // `resolveStartDirectory` compares with the path helpers, so the value it returns can be spelled
    // differently from the value passed in. A raw `!==` here would call an honoured directory a
    // fallback and report a folder that is sitting exactly where the user left it.
    const remembered = 'C:\\proj\\src';
    expect(fallbackToReport(remembered, 'C:/proj/src', exists([remembered]))).toBeUndefined();
  });
});
