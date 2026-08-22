import { describe, expect, it, vi } from 'vitest';
import type { Disposable, IFileWatcher } from '@throng/core';
import { TerminalReconnect, type TerminalReconnectDeps } from '../../src/main/terminal-reconnect.js';

/**
 * Arming and releasing a terminal path-availability watch (039 US3, #237).
 *
 * ══ THE DEFECT SHAPE THIS FILE EXISTS FOR ══
 *
 * Modelled on `subworkspace-open.contract.test.ts`, and for a sharper version of its reason. That
 * file records an `ipcMain.on(…, () => { void (async () => { … })(); })` handler where anything
 * thrown became an unhandled rejection: **no window, no error, no notice** — the user pressed Open
 * and nothing happened.
 *
 * These handlers have the same shape. `armReconnect` and `disarmReconnect` are `ipcMain.handle`
 * bodies, and the renderer calls them as `void window.throng.terminal.armReconnect(…)`, so a
 * rejection is discarded at both ends.
 *
 * **It is worse here than in the sub-workspace case, and that is the argument for this file.** The
 * sub-workspace user at least knew they had pressed a button, so silence was visibly wrong. #237's
 * entire value proposition is that recovery happens *without the user asking* — so a throw from
 * `arm` leaves the terminal permanently unrecoverable, with nothing on screen to say so, and nobody
 * aware that an attempt was ever made. The failure is indistinguishable from the feature not
 * existing.
 *
 * ══ SO EVERY OUTCOME IS A VALUE ══
 *
 * `arm` returns a discriminated result and never throws. The three failures are distinguished
 * because they mean different things: `no-existing-ancestor` says this panel genuinely cannot
 * self-recover and ↻ Retry is its route back (FR-039), while `probe-failed` and `watch-failed` say
 * the attempt itself broke and a later one might not.
 *
 * The two paths that run inside a WATCHER CALLBACK — where a throw is an unhandled exception in the
 * main process rather than something any caller sees — are covered at the foot of this file.
 *
 * ══ AND THE SHAPE FOUND A REAL DEFECT BEFORE THIS FILE EVER RAN ══
 *
 * `arm` used to push its pending entry BEFORE establishing the watch. If `fileWatcher.watch` threw —
 * ENOSPC on watcher limits being the realistic case — the panel was recorded as pending with no
 * watch behind it: waiting for an event that can never arrive, and from outside indistinguishable
 * from a healthy entry. The terminal never comes back, quietly, for ever. **That is #237's own
 * failure mode, reproduced by #237's implementation**, and it would have shipped.
 *
 * It was not found by reading. **It came out of asking "what does this RETURN when the watcher
 * refuses" — which is a question you can only ask of a function that returns something.** That is
 * the argument for the value-not-exception shape, and it is why the ordering is now pinned by a test
 * rather than left to whoever edits this next.
 */

function fakeWatcher(over: Partial<IFileWatcher> = {}): IFileWatcher {
  return {
    watch: (): Disposable => ({ dispose: () => {} }),
    ...over,
  };
}

/** Deps whose every step succeeds, so a test only has to say which one it is breaking. */
function deps(over: Partial<TerminalReconnectDeps> = {}): TerminalReconnectDeps {
  return {
    fileWatcher: fakeWatcher(),
    exists: (p) => p === 'C:/dev',
    parentOf: (p) => {
      const i = p.lastIndexOf('/');
      return i <= 0 ? null : p.slice(0, i);
    },
    notify: () => {},
    ...over,
  };
}

describe('arming reports every outcome as a value (039 FR-030)', () => {
  it('succeeds, naming the directory it actually watched', () => {
    const r = new TerminalReconnect(deps()).arm('p1', 'A', 'C:/dev/proj/src');
    // The ancestor, not the target — the target is the thing that is missing.
    expect(r).toEqual({ ok: true, watching: 'C:/dev' });
  });

  it('reports no-existing-ancestor rather than throwing, when nothing in the chain exists', () => {
    const r = new TerminalReconnect(deps({ exists: () => false })).arm('p1', 'A', 'Z:/gone/deep');
    expect(r).toEqual({ ok: false, reason: 'no-existing-ancestor' });
  });

  /*
   * `exists` is a filesystem call. A path too long, an ACL on an ancestor, or a drive that
   * disappeared between two calls all throw — and this runs on a path throng has just been told is
   * unreliable, which makes it the LIKELIEST place to meet one.
   */
  it('reports probe-failed rather than throwing, when the filesystem probe itself breaks', () => {
    const r = new TerminalReconnect(
      deps({
        exists: () => {
          throw new Error('EACCES: permission denied, stat');
        },
      }),
    ).arm('p1', 'A', 'C:/dev/proj/src');
    expect(r).toEqual({ ok: false, reason: 'probe-failed' });
  });

  it('reports watch-failed rather than throwing, when the watcher will not attach', () => {
    const r = new TerminalReconnect(
      deps({
        fileWatcher: fakeWatcher({
          watch: () => {
            throw new Error('ENOSPC: System limit for number of file watchers reached');
          },
        }),
      }),
    ).arm('p1', 'A', 'C:/dev/proj/src');
    expect(r).toEqual({ ok: false, reason: 'watch-failed' });
  });

  /*
   * The subtlety a returned failure makes testable at all: a panel must not be RECORDED as pending
   * when no watch exists for it. A pending entry with no watch waits for an event that can never
   * arrive, and from the outside it is indistinguishable from one being watched properly — the
   * terminal simply never comes back, quietly, for ever.
   */
  it('does not record a panel it failed to watch', () => {
    const watcher = new TerminalReconnect(
      deps({
        fileWatcher: fakeWatcher({
          watch: () => {
            throw new Error('nope');
          },
        }),
      }),
    );
    expect(watcher.arm('p1', 'A', 'C:/dev/proj/src').ok).toBe(false);
    // Nothing was recorded, so disarming is a no-op rather than a removal — and, more to the point,
    // no later event can find a half-registered entry.
    expect(() => watcher.disarm('p1')).not.toThrow();
  });
});

describe('disarming is total (039 FR-042)', () => {
  it('an unknown panel is a no-op, not a throw', () => {
    expect(() => new TerminalReconnect(deps()).disarm('never-armed')).not.toThrow();
  });

  it('a watcher that fails to close does not escape the disarm', () => {
    /*
     * The entry is dropped either way, so propagating would leave the caller with an exception AND
     * a map that has been mutated — the worst of both. `disarmReconnect` is an IPC handler, so the
     * exception would go nowhere a user can see regardless.
     */
    const r = new TerminalReconnect(
      deps({
        fileWatcher: fakeWatcher({
          watch: () => ({
            dispose: () => {
              throw new Error('watcher already closed');
            },
          }),
        }),
      }),
    );
    r.arm('p1', 'A', 'C:/dev/proj/src');
    expect(() => r.disarm('p1')).not.toThrow();
  });

  it('disposing everything survives a watcher that throws on close', () => {
    const r = new TerminalReconnect(
      deps({
        fileWatcher: fakeWatcher({
          watch: () => ({
            dispose: () => {
              throw new Error('watcher already closed');
            },
          }),
        }),
      }),
    );
    r.arm('p1', 'A', 'C:/dev/proj/src');
    expect(() => r.dispose()).not.toThrow();
  });
});

describe('the watcher callback never throws into the main process (039 FR-030)', () => {
  /** Arm a panel and hand back the callback the watcher was given, so a test can fire it. */
  function armed(over: Partial<TerminalReconnectDeps> = {}) {
    let fire = (): void => {
      throw new Error('nothing armed a watch — the fixture is wrong, not the code');
    };
    const r = new TerminalReconnect(
      deps({
        fileWatcher: fakeWatcher({
          watch: (dir, onChange) => {
            fire = () => onChange(dir);
            return { dispose: () => {} };
          },
        }),
        ...over,
      }),
    );
    r.arm('p1', 'A', 'C:/dev/proj/src');
    return { fire: () => fire() };
  }

  /*
   * This runs inside a filesystem watcher's callback, so a throw is an unhandled exception in the
   * main process — not a rejected promise some caller could log. It would take down more than this
   * feature.
   *
   * Swallowing leaves every pending panel ARMED, which is the right failure: the next event asks
   * the same question again, and ↻ Retry was never taken away.
   */
  /*
   * The first version of this test counted `exists` calls and threw after the first — which threw
   * during ARMING, not during the event, so nothing was ever armed and `fire()` reported "nothing
   * armed a watch". The anti-vacuity guard caught the fixture rather than the code, which is
   * precisely what it is for: `watchTargetFor` calls `exists` once per ancestor while walking up,
   * so "the second call" is still arming.
   *
   * A flag flipped between the two phases says what is meant, and cannot drift when the walk
   * changes length.
   */
  it('an exists() that throws mid-event does not escape', () => {
    let arming = true;
    const { fire } = armed({
      exists: (p) => {
        if (!arming) throw new Error('EIO: i/o error, stat');
        return p === 'C:/dev';
      },
    });
    arming = false;
    expect(() => fire()).not.toThrow();
  });

  it('a notify() that throws does not escape', () => {
    // Broadcasting to a window that is mid-destruction throws, and a project closing while its
    // folder reappears is exactly when that happens.
    const notify = vi.fn(() => {
      throw new Error('Object has been destroyed');
    });
    const { fire } = armed({ exists: () => true, notify });
    expect(() => fire()).not.toThrow();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
