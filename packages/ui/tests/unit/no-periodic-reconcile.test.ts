import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * The periodic terminal repaint stays deleted (028 FR-014b, re-sited by 034 FR-045).
 *
 * `terminal-refresh.e2e.ts` guarded this by idling nine seconds — longer than the backstop's old
 * 8-second period — and then asserting `diagnostics.reconcile.backstop === 0`. That assertion
 * **cannot fail**. 028 removed the timer outright, and `recordReconcile` has **zero call sites in
 * `packages/ui/src`**, so the counter is initialised to 0 and nothing in the application can ever
 * increment it. Nine seconds of a real Electron run, to compare a constant against itself.
 *
 * It is worth being precise about why that is a defect rather than merely wasteful. The test reads
 * as protection against the timer coming back, and it is not: reintroduce the timer WITHOUT calling
 * `recordReconcile` — which is exactly what a reintroduction would look like, since nobody adds a
 * feature by remembering to increment the counter that proves it exists — and the E2E stays green
 * while repainting every eight seconds. The counter can only catch a timer that announces itself.
 *
 * This catches the reintroduction instead, at the layer where the fact actually lives. It costs
 * milliseconds, it fails on the change that matters, and it does not care whether whoever added the
 * timer remembered to count it.
 *
 * The E2E keeps its other two claims — that an idle terminal still shows its content, and that the
 * panel reverts when the shell exits — because those need a real ConPTY and a real xterm surface.
 * Only the counter assertion moved.
 */

const USE_TERMINAL = fileURLToPath(
  new URL('../../src/renderer/terminal/use-terminal.ts', import.meta.url),
);

/** Strip comments, so the note recording that the timer was removed is not read as the timer. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('no periodic terminal reconcile', () => {
  const src = code(USE_TERMINAL);

  it('reads the file it claims to read', () => {
    // Without this, a renamed or moved module turns every assertion below into a pass over an empty
    // string — the vacuous-guard failure this test exists to replace, reproduced in the replacement.
    expect(src.length, 'use-terminal.ts is empty or unreadable after comment-stripping').toBeGreaterThan(1000);
    expect(src, 'this is not use-terminal.ts').toContain('useTerminal');
  });

  it('arms no repeating timer', () => {
    // `setInterval` is the mechanism 028 removed. A reintroduction would not need to touch the
    // diagnostics counter, which is precisely why the E2E's counter check could not see it.
    expect(
      src.match(/setInterval\s*\(/g) ?? [],
      'use-terminal.ts arms a repeating timer again. 028 FR-014b removed the periodic reconcile ' +
        'backstop because a repaint nobody asked for hides the defect it was meant to paper over: ' +
        'a reproduction then passes because the timer fired, not because the code is right.',
    ).toEqual([]);
  });

  it('records no backstop reconcile, because there is no backstop to record', () => {
    // Kept as a paired assertion rather than dropped: if someone reintroduces the timer AND counts
    // it, this is the line that names what happened. The one above catches the case where they don't.
    expect(
      src.includes("'backstop'"),
      "use-terminal.ts records a 'backstop' reconcile again — the periodic repaint is back.",
    ).toBe(false);
  });
});
