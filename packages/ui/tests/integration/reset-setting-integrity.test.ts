import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildShippedDefaults } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { ShippedDefaultsService } from '../../src/main/shipped-defaults-service.js';

/**
 * 032 T020a / T010a — the MAIN PROCESS has the same defect, and nothing serialises it.
 *
 * ══ WHY THIS FILE EXISTS ══
 *
 * Three drafts of spec 032 audited "every config write site" and found none of these, because all
 * three grepped `packages/ui/src/renderer` and stopped. `ShippedDefaultsService` is a writer too:
 * `resetSetting` (:133) reads the WHOLE settings document, computes the next one, and writes all of
 * it back — the exact read-modify-write-whole-document shape the feature exists to remove — and
 * `resetBinding` (:122) does the same to `keybindings.json`.
 *
 * Two independent defects follow, and both are asserted below against today's code:
 *
 *   1. NOTHING SERIALISES THE CYCLE. `config-write-ipc.ts` has no chain, queue, mutex or lock. The
 *      only serialisation in the system is `writeChains` at `write-config.ts:24`, which is
 *      module-scoped in a RENDERER — so it orders one window's writes and nothing else. Two
 *      concurrent read-modify-write calls in main therefore interleave as read-A, read-B, write-A,
 *      write-B, and B silently drops A's change. (FR-002a, G11, G12)
 *
 *   2. THE READ FALLS BACK TO THE DEFAULTS. `store.read(..., DEFAULT_APP_SETTINGS, ...)` returns the
 *      shipped defaults when the document cannot be parsed, so resetting ONE setting against a
 *      corrupt file rewrites EVERY OTHER setting to its shipped value. That is a strictly worse
 *      version of the loss FR-006a closes on the renderer side. (FR-001b, FR-006a)
 *
 * ══ EXPECTED STATE ══
 *
 * RED until T010b/T010c add the per-document lock and T020c/T020d stop the reset paths reading
 * through a fallback. These are the regression tests for both.
 */
const tempDirs: string[] = [];
function freshService(): { store: FileConfigStore; svc: ShippedDefaultsService; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'throng-reset-integrity-'));
  tempDirs.push(root);
  const store = new FileConfigStore(root);
  return { store, svc: new ShippedDefaultsService(store, buildShippedDefaults()), root };
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function settingsOf(root: string): Record<string, any> {
  return JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'));
}

/*
 * Two leaves with different shipped values, so "was it reset?" and "was it clobbered?" are
 * distinguishable per key rather than collapsing into one observation.
 */
const SHIPPED = buildShippedDefaults().settings;
const ERROR_MODE_SHIPPED = SHIPPED.notifications.error.mode; // 'dismiss'
const DESTROY_SHIPPED = SHIPPED.confirmations.destroyProject; // 'double'

describe('ShippedDefaultsService.resetSetting — concurrency', () => {
  it('two concurrent resets of DIFFERENT settings both survive', async () => {
    const { svc, root } = freshService();

    // Both leaves start away from their shipped values, so a successful reset is observable.
    writeFileSync(
      join(root, 'settings.json'),
      JSON.stringify({
        version: 1,
        notifications: { error: { mode: 'never' } },
        confirmations: { destroyProject: 'single' },
      }),
      'utf8',
    );

    /*
     * Fired without awaiting the first, which is exactly what two IPC handlers do. Each reads the
     * document before either writes, so each computes its next document from the same base and the
     * second write erases the first's change. A lost update, in the plainest form there is.
     */
    const [a, b] = await Promise.all([
      svc.resetSetting('notifications.error.mode'),
      svc.resetSetting('confirmations.destroyProject'),
    ]);

    /*
     * The `ok` flags are REPORTED, not asserted, and that is deliberate.
     *
     * An earlier version of this test asserted `expect(a.ok).toBe(true)` first, and it failed there
     * — which looked like the lost update but was not it. Two concurrent `writeFilesAtomic` calls
     * stage a temp file each and rename both onto the same target, so one can fail outright once
     * the bounded rename retry is spent. That is a second, distinct defect of the same missing
     * lock, and asserting on it first HID the one this test is about.
     *
     * So the outcome on disk is the assertion, and the flags ride along in the message. Both
     * failure modes are visible, and neither masks the other.
     */
    const outcome = `resetSetting results: error-mode ok=${a.ok}, destroyProject ok=${b.ok}`;

    const after = settingsOf(root);
    expect(
      after.notifications.error.mode,
      `the error-mode reset must not be erased by the concurrent destroyProject reset. ${outcome}`,
    ).toBe(ERROR_MODE_SHIPPED);
    expect(
      after.confirmations.destroyProject,
      `the destroyProject reset must not be erased by the concurrent error-mode reset. ${outcome}`,
    ).toBe(DESTROY_SHIPPED);
  });

  /*
   * ══ WHY THERE IS NOT A SECOND TEST HERE ══
   *
   * A draft of this file added one asserting that both resets REPORT success, on the grounds that a
   * rename collision can make one return ok:false. Measured across runs, that assertion passed
   * sometimes and failed others — the collision depends on how the two writes interleave — so the
   * test would have been flaky, and the constitution is unambiguous that a flaky test is a defect
   * rather than a cost of doing business. Adding one to a spec whose entire subject is
   * timing-dependent failure would have been an unusually poor joke.
   *
   * The concern is not lost: BOTH failure modes reach the developer through the message above.
   * Whichever way the race falls, the outcome assertion is red and the flags say which happened.
   */
});

describe('ShippedDefaultsService.resetSetting — an unreadable base', () => {
  it('does not rewrite every OTHER setting to its shipped value when the document is corrupt', async () => {
    const { svc, root } = freshService();

    // A user with two non-default choices, and a file caught mid-write (or hand-corrupted).
    writeFileSync(
      join(root, 'settings.json'),
      '{"version":1,"notifications":{"error":{"mode":"never"}},"confirmations":{"destroyPro',
      'utf8',
    );

    const corrupt = readFileSync(join(root, 'settings.json'), 'utf8');
    const result = await svc.resetSetting('confirmations.destroyProject');

    /*
     * WHAT THE RIGHT ANSWER IS, AND WHY IT IS NOT "PRESERVE THE OTHER SETTINGS".
     *
     * The first draft of this test asserted that `notifications.error.mode` was still 'never' after
     * the reset. That assertion is unsatisfiable and the test was wrong to make it: you cannot
     * preserve values you were unable to read. Demanding it would push an implementer towards
     * guessing at a base, which is precisely the defect — the old code guessed
     * DEFAULT_APP_SETTINGS and wrote the whole shipped document over the user's choices.
     *
     * The contract is to REFUSE and change nothing, so the corrupt file survives for the user (or
     * the watcher's re-read) to recover from, and the caller is told plainly that it did not happen.
     */
    expect(result.ok, 'a reset with no readable base must not report success').toBe(false);
    expect(result.reason).toBe('unreadable');
    expect(
      readFileSync(join(root, 'settings.json'), 'utf8'),
      'a refused reset must leave the document byte-for-byte untouched',
    ).toBe(corrupt);
  });
});

describe('ShippedDefaultsService.resetBinding — an unreadable base', () => {
  it('does not rewrite every OTHER binding to its shipped value when the document is corrupt', async () => {
    const { svc, root } = freshService();

    // A user with a custom chord, and a keybindings file caught mid-write.
    writeFileSync(join(root, 'keybindings.json'), '{"version":1,"bindings":{"tabs.openPick', 'utf8');

    const corrupt = readFileSync(join(root, 'keybindings.json'), 'utf8');
    const result = await svc.resetBinding('terminal.redraw');

    /*
     * `resetBinding` is `resetSetting`'s exact twin, and it had the same defect: reading through
     * `DEFAULT_KEYBINDINGS` meant a corrupt document was replaced by the shipped chords in full, so
     * every rebinding the user had made was gone. Same contract, same reason.
     *
     * Worth recording where this document sits in the story: three drafts of spec 032 called
     * `keybindings.json` a "single-window document" and scoped it out. It is written from the
     * Preferences window, from the main process, AND from an E2E spec.
     */
    expect(result.ok, 'a binding reset with no readable base must not report success').toBe(false);
    expect(result.reason).toBe('unreadable');
    expect(
      readFileSync(join(root, 'keybindings.json'), 'utf8'),
      'a refused reset must leave the document byte-for-byte untouched',
    ).toBe(corrupt);
  });
});
