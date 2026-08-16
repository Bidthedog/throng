import { describe, it, expect } from 'vitest';
import { fallbackToReport, requestedStartDirectory, resolveStartDirectory } from '@throng/core';

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
 *
 * ══ 033 ADDED A SECOND SOURCE FOR "THE DIRECTORY THAT WAS ASKED FOR" ══
 *
 * Open In → Terminal gives a panel a `startDirectory` before it has ever run, so a panel can now
 * fall back with no memory at all — and FR-034 requires that substitution to be announced in the
 * same words. `fallbackToReport`'s first argument therefore stopped meaning "the remembered
 * directory" and started meaning "the directory that was requested". See `requestedCwd` below for
 * what that rename does and does not cover.
 */

const ROOT = 'C:/proj';
const exists =
  (present: string[]) =>
  (p: string): boolean =>
    present.includes(p);

/**
 * WHICH directory was asked for (033 FR-034) — the REAL function, not a copy of it.
 *
 * This was a mirror of an expression inlined in `terminal-ipc.ts`, and the mirror was the problem:
 * these cases pinned the RULE while leaving the WIRING free, so reverting that handler to pass
 * `req.rememberedCwd` into `fallbackToReport` — the precise defect §B.6's correction was written to
 * record — left every test below green, because none of them ran that line.
 *
 * `requestedStartDirectory` now lives beside `resolveStartDirectory` and the handler calls it, so a
 * revert at the call site fails here instead of shipping. That is the whole reason a two-line
 * `??` earned a name: it is not that the expression was hard, it is that an expression cannot be
 * shared with the test that guards it.
 */
const requestedCwd = requestedStartDirectory;

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

/**
 * 033 FR-032 / FR-034 — the same report, for a directory the user never worked in.
 *
 * Open In → Terminal hands a brand-new panel a `startDirectory`. It has no memory, so every case
 * below is one 029 could not produce: the folder that goes missing is the one the user right-clicked,
 * and FR-034 requires that substitution to be announced in exactly the same words 029 chose for a
 * lost remembered directory. `requestedCwd` (above) is what decides which of the two is at stake —
 * read its note before treating a green bar here as coverage of the handler.
 */
describe('fallbackToReport with a START DIRECTORY (033 FR-032/FR-034)', () => {
  it('reports the START DIRECTORY when there is no memory and the folder has GONE (033 FR-034)', () => {
    // A panel opened from the tree and never run has no `rememberedCwd` at all. Delete the folder
    // between the right-click and the launch and the shell starts at the root — the user must be
    // told which folder was substituted, exactly as a lost remembered directory is.
    const startDirectory = 'C:/proj/feature';
    const requested = requestedCwd(undefined, startDirectory);
    const cwd = resolveStartDirectory(ROOT, requested, exists([]));
    expect(cwd).toBe(ROOT);
    expect(fallbackToReport(requested, cwd, exists([]))).toBe(startDirectory);
    // The defect this pins: reading `rememberedCwd` instead of the requested value says NOTHING,
    // and a silent substitution is what FR-034 forbids.
    expect(fallbackToReport(undefined, cwd, exists([]))).toBeUndefined();
  });

  it('reports the REMEMBERED directory, not the start directory, when both exist (033 FR-034)', () => {
    // Memory wins as the requested cwd (FR-034), so it must also be what the notice names. By the
    // time a panel has a remembered directory the user has moved the shell themselves, and naming
    // the folder they right-clicked days ago would name a folder that is not the one they lost.
    const startDirectory = 'C:/proj/feature';
    const rememberedCwd = 'C:/proj/src/deep';
    const requested = requestedCwd(rememberedCwd, startDirectory);
    expect(requested).toBe(rememberedCwd);
    // Both gone: the report is about the directory that was actually asked for.
    const cwd = resolveStartDirectory(ROOT, requested, exists([]));
    expect(cwd).toBe(ROOT);
    expect(fallbackToReport(requested, cwd, exists([]))).toBe(rememberedCwd);
    expect(fallbackToReport(requested, cwd, exists([]))).not.toBe(startDirectory);
  });

  it('says NOTHING when the start directory was honoured', () => {
    const startDirectory = 'C:/proj/feature';
    const requested = requestedCwd(undefined, startDirectory);
    const cwd = resolveStartDirectory(ROOT, requested, exists([startDirectory]));
    expect(cwd).toBe(startDirectory);
    expect(fallbackToReport(requested, cwd, exists([startDirectory]))).toBeUndefined();
  });

  it('says NOTHING when the start directory ESCAPED the project but still exists (FR-032)', () => {
    // Refused by containment, which throng does on purpose. Same silence a remembered directory gets.
    const outside = 'D:/somewhere/else';
    const requested = requestedCwd(undefined, outside);
    const cwd = resolveStartDirectory(ROOT, requested, exists([outside]));
    expect(cwd).toBe(ROOT);
    expect(fallbackToReport(requested, cwd, exists([outside]))).toBeUndefined();
  });

  it('says NOTHING when the start directory walked out with `..` (FR-032 containment)', () => {
    // Refused by `isUnderPath`'s `..` rule rather than by the prefix check, and refused SILENTLY for
    // the same reason any containment fallback is: it is throng's boundary, not the user's loss.
    const escape = 'C:/proj/../Windows/System32';
    const requested = requestedCwd(undefined, escape);
    const cwd = resolveStartDirectory(ROOT, requested, exists([escape]));
    expect(cwd).toBe(ROOT);
    expect(fallbackToReport(requested, cwd, exists([escape]))).toBeUndefined();
  });
});
