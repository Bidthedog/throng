import { createRequire } from 'node:module';
import process from 'node:process';
import type { IForegroundHandoff } from '@throng/core';

/**
 * Windows {@link IForegroundHandoff} (#199) — `user32!AllowSetForegroundWindow`.
 *
 * Windows refuses `SetForegroundWindow` from a process that does not already own the foreground;
 * it flashes the taskbar button instead of raising the window. That is why `az login` opens its
 * sign-in window BEHIND throng: the window belongs to a process several steps down the chain
 * (throng → daemon → PTY agent → conhost → shell → az → the auth window), and throng holds the
 * foreground, not it.
 *
 * `AllowSetForegroundWindow` is the OS's sanctioned way to hand that right on, and it must be
 * called BY the foreground owner — so it lives in the Electron main process, which owns the window,
 * and nowhere further down.
 *
 * ══ ASFW_ANY, and why the scope is TIME rather than a pid ══
 *
 * The API grants to ONE pid, and the grant is not transitive: a granted process may pass it on by
 * calling `AllowSetForegroundWindow` itself, which `az` and a browser will never do. Granting the
 * shell's pid therefore buys nothing — the window that needs raising is two or three processes
 * further on, and throng cannot know its pid in advance (that is the whole shape of the problem).
 *
 * `ASFW_ANY` (-1) is the only value that reaches it, and it means *any* process may take the
 * foreground. Stating the cost plainly, because it is real: for the life of the grant, a process
 * unrelated to the terminal could raise itself too.
 *
 * What keeps that acceptable is that the grant is SHORT-LIVED by the OS's own rules, not by ours.
 * Windows drops it the next time the user generates input that is not directed at the granted
 * process — so it lasts from the Enter that submitted a command until roughly the user's next
 * keystroke elsewhere. Combined with the call site (a submitted command in a focused terminal, and
 * nowhere else), the window in which "any process" applies is the window in which the user has just
 * asked a terminal to run something and is waiting for it. That is the narrowest scope the API
 * makes available; a per-pid grant would be narrower still and simply does not work here.
 *
 * ══ Failure ══
 *
 * Bound lazily via koffi (a prebuilt FFI — no native build step), exactly as `WindowsProcessCwd`
 * does. Anything that goes wrong — koffi missing, user32 unavailable, not on Windows, the call
 * refused — leaves the feature simply OFF and returns false. A terminal keystroke must never fail
 * because a window-manager hint did.
 *
 * ══ The return value is about the DESKTOP, not about this code ══
 *
 * A `true` does not mean a window will be raised, and a `false` does not mean the seam is broken.
 * The OS refuses a caller that does not own the foreground — but that rule is vacuous when NO window
 * owns it (a locked, disconnected or non-interactive desktop, where `GetForegroundWindow` returns
 * 0), and there the same call succeeds. Both were observed on one machine within an hour.
 *
 * So nothing may branch on this value except to log it, and no test may assert it — see the note in
 * `windows-foreground-handoff.contract.test.ts`, which asserted `false` and was wrong.
 */
const require = createRequire(import.meta.url);

/** `ASFW_ANY` — see the note above on why a pid cannot be used. */
const ASFW_ANY = -1;

type AllowFn = (processId: number) => boolean;

let allowFn: AllowFn | null | undefined;

/** Lazily bind `user32!AllowSetForegroundWindow` (once). null if unavailable. */
function loadFfi(): AllowFn | null {
  if (allowFn !== undefined) return allowFn;
  if (process.platform !== 'win32') {
    allowFn = null;
    return allowFn;
  }
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    allowFn = user32.func('AllowSetForegroundWindow', 'bool', ['int32']) as AllowFn;
  } catch {
    allowFn = null; // koffi missing or user32 failed to load → feature simply off
  }
  return allowFn;
}

export class WindowsForegroundHandoff implements IForegroundHandoff {
  allow(): boolean {
    const fn = loadFfi();
    if (!fn) return false;
    try {
      return fn(ASFW_ANY) === true;
    } catch {
      // A refused or failed grant is an ordinary outcome, not an error: the caller is a keystroke.
      return false;
    }
  }
}
