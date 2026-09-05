import { describe, expect, it } from 'vitest';
import { WindowsForegroundHandoff } from '../../src/windows-foreground-handoff.js';

/**
 * #199: the foreground-handoff OS seam calls `user32!AllowSetForegroundWindow`, so that a window
 * opened by a command running in a terminal can raise itself over throng.
 *
 * ══ What this contract proves ══
 *
 * That the koffi binding loads and the call executes. Not a formality: every failure mode of an FFI
 * seam — the library missing, the symbol misspelled, the signature wrong — surfaces here as a throw
 * or a non-boolean, and the seam's whole promise is that it degrades to `false` rather than taking a
 * terminal keystroke down with it.
 *
 * ══ What it must NOT assert, and how that was learned ══
 *
 * **The return VALUE.** The first version of this file asserted `false`, reasoning that
 * `AllowSetForegroundWindow` refuses any caller that does not already own the foreground and that a
 * vitest worker never does. That is only half the rule, and the run said so: it returned **true**.
 *
 * The half that was missing is that the foreground lock is vacuous when NO window owns the
 * foreground. On a locked, disconnected or non-interactive desktop `GetForegroundWindow` returns 0 —
 * measured at 0 for an entire E2E run on this machine — and with nothing holding the foreground
 * there is nothing to refuse, so the grant succeeds.
 *
 * So the value depends on desktop state no test controls, and asserting it makes this file fail on
 * one machine and pass on another while the code is identical. Asserting only the invariants is not
 * a weaker test; it is the only honest one, and it is the same judgement `terminal-foreground-handoff.e2e.ts`
 * makes when it skips rather than reds on an invalid reading.
 *
 * Whether Windows honours a granted handoff across the process chain is that E2E's question, and
 * needs a real desktop.
 */
describe('WindowsForegroundHandoff (AllowSetForegroundWindow)', () => {
  it('binds and calls the OS, returning a boolean rather than throwing', () => {
    // The FFI assertion. A throw or an `undefined` here means the binding is broken, which is the
    // one thing this layer can and must catch.
    expect(typeof new WindowsForegroundHandoff().allow()).toBe('boolean');
  });

  it('survives repeated calls — the binding is cached, not rebuilt per call', () => {
    // The seam is called on every submitted command, so a per-call `koffi.load` would be a leak as
    // well as a cost. Consistency of TYPE across calls is what is checkable without a desktop.
    const handoff = new WindowsForegroundHandoff();
    const results = Array.from({ length: 5 }, () => handoff.allow());
    expect(results.every((r) => typeof r === 'boolean')).toBe(true);
    // Whatever the desktop state, it must not CHANGE between immediate successive calls — that
    // would mean the seam was rebinding or carrying state it should not.
    expect(new Set(results).size).toBe(1);
  });

  it('is safe to call from several instances, since the binding is module-level', () => {
    expect(() => {
      new WindowsForegroundHandoff().allow();
      new WindowsForegroundHandoff().allow();
    }).not.toThrow();
  });
});
