import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A secondary window must never resolve its parent by reading `const mainWindow` directly.
 *
 * ══ WHAT WENT WRONG ══
 *
 * `mainWindow` is a `const` declared several hundred lines into the startup scope, but the IPC
 * handlers that open Preferences and About are registered — and reachable — long before that line
 * runs. Between those two points the binding sits in its TEMPORAL DEAD ZONE, and reading a `const`
 * in its TDZ THROWS rather than yielding `undefined`:
 *
 *     ReferenceError: Cannot access 'mainWindow' before initialization
 *         at getMainWindow (main.js:633)
 *         at openPreferences (preferences-window.js:53)
 *
 * An uncaught throw inside an `ipcMain` listener is not a misbehaving menu — it takes the whole
 * MAIN PROCESS down. The user's app vanishes because they clicked the cog too early.
 *
 * Observed, not imagined: `theme-flash.e2e.ts` opened preferences from the cog during startup and
 * killed the app, surfacing only as `locator.click: Target page, context or browser has been closed`.
 * The About path had already been hardened this way, with a comment naming the hazard; Preferences
 * had been left reading the const, so the fix was known and simply not applied everywhere.
 *
 * ══ WHY A SOURCE GUARD ══
 *
 * The crash needs an IPC to arrive inside a window of a few hundred milliseconds during startup, so
 * a behavioural test would be timing-dependent — the very thing that let this hide as a rare flake.
 * The property that actually matters is static and can be asserted exactly: no `getMainWindow`
 * closure reads the const. Same reasoning as the sanitiser call-site guard in `spawn-env.test.ts`.
 */

const MAIN = readFileSync(
  fileURLToPath(new URL('../../src/main/main.ts', import.meta.url)),
  'utf8',
);

describe('secondary windows resolve their parent without touching a const in its TDZ', () => {
  it('declares the nullable ref, and a single accessor over it', () => {
    // A `let … = null` has no dead zone: read early it yields null, which both windows handle by
    // opening unparented. That is the entire reason the ref exists.
    expect(MAIN).toMatch(/let\s+mainWindowRef\s*:\s*BrowserWindow\s*\|\s*null\s*=\s*null/);
    expect(MAIN).toMatch(/const\s+currentMainWindow\s*=\s*\(\)\s*:\s*BrowserWindow\s*\|\s*null\s*=>/);
    expect(MAIN).toMatch(/mainWindowRef\s*&&\s*!mainWindowRef\.isDestroyed\(\)/);
  });

  it('assigns the ref as soon as the main window exists', () => {
    // Without this the accessor is permanently null and every secondary window opens unparented —
    // no crash, but the parenting requirement (FR-013) would be quietly dead.
    expect(MAIN).toMatch(/mainWindowRef\s*=\s*mainWindow\s*;/);
  });

  it('has NO getMainWindow that dereferences the const directly — the crash itself', () => {
    /*
     * The shipped defect verbatim:
     *
     *     getMainWindow: () => (mainWindow.isDestroyed() ? null : mainWindow),
     *
     * Any `getMainWindow` whose body names `mainWindow` rather than the ref is this bug returning.
     * Matched on the property's own body only, so the accessor's definition and the assignment
     * above (both legitimately naming `mainWindow`) are not caught.
     */
    const offenders = [...MAIN.matchAll(/getMainWindow\s*:\s*(\(\)[^,]*|[A-Za-z_$][\w$]*)/g)]
      .map((m) => m[1])
      .filter((body) => /\bmainWindow\b/.test(body) && !/\bmainWindowRef\b/.test(body));

    expect(
      offenders,
      `a getMainWindow reads the const directly: ${offenders.join(' | ')} — ` +
        'this throws a ReferenceError and kills the main process if it runs before the const is ' +
        'initialised. Use currentMainWindow (over mainWindowRef) instead.',
    ).toEqual([]);
  });

  it('routes BOTH secondary windows through the accessor', () => {
    // Preferences and About are the two windows parented to the main one. Counting them keeps a
    // third from being added with a fresh copy of the original mistake.
    const uses = [...MAIN.matchAll(/getMainWindow\s*:\s*currentMainWindow\b/g)];
    expect(uses).toHaveLength(2);
  });
});
