import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { readConfigOnce, readConfigPayload } from '../../src/main/config-watcher.js';

/**
 * 032 T004 — the probe for R2, the #260 hypothesis.
 *
 * ══ THE HYPOTHESIS ══
 *
 * #260 reports a Preferences change being lost, "leaving the setting at its DEFAULT" — not at its
 * previous value. That wording is the clue. `startConfigWatcher` re-reads through
 * `readConfigPayload`, which calls `store.read(..., DEFAULT_APP_SETTINGS, parseSettingsGuarded)`.
 * The guarded parser CORRECTS a bad document rather than reporting that it could not read one, so a
 * read that catches a partially written file plausibly returns the defaults and broadcasts them as
 * though they were the user's settings.
 *
 * The second half is what makes it stick: `startConfigWatcher` re-reads only when the watcher fires
 * AGAIN. A writer that has finished does not touch the file again, so one bad read strands every
 * window on that payload indefinitely. #253 says the same thing from the test side — "the event is
 * lost, not late", and "nothing then re-reads".
 *
 * ══ WHAT THIS PROBE ESTABLISHES ══
 *
 * The constitution forbids asserting a root cause without a reproducing test or an instrumented
 * probe. This is the probe. It does not go through the watcher (that needs a real filesystem event);
 * it drives the READ the watcher performs, against the file states a partial write produces, and
 * asks one question: can a caller tell "this document could not be read" from "this document says
 * defaults"?
 *
 * It could not, and that was the defect. It now can: `readConfigOnce` reports `settingsUnreadable`,
 * which is what made the bounded re-read in `config-watcher-retry.test.ts` writable at all — you
 * cannot retry a condition you cannot detect.
 *
 * ══ WHAT THIS FILE DOES *NOT* CLAIM, AND WHY ══
 *
 * It does not assert that a PERMANENTLY truncated file yields the user's old values. It cannot, and
 * nothing should: the old bytes are gone. G7 is explicit that once the retries are spent the last
 * read is broadcast anyway, because an application visibly running on defaults is a better failure
 * than one that quietly stops accepting configuration changes.
 *
 * An earlier revision of this file asserted exactly that — a title describing the defect
 * ("...are replaced by the DEFAULTS") over an assertion describing a fix that was never specified
 * ("...must not be silently replaced"). It was unsatisfiable by construction. The RECOVERABLE case —
 * a file truncated for a moment and then completed, which is what a partial write actually is —
 * belongs to `config-watcher-retry.test.ts`, and is asserted there.
 */
const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-partial-read-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The states a temp-file+rename write is briefly visible in, plus the states a crash leaves. */
const PARTIAL_STATES: Array<{ name: string; content: string }> = [
  { name: 'empty (truncate, before fill)', content: '' },
  { name: 'truncated mid-object', content: '{"version":1,"notifications":{"error":{"mo' },
  { name: 'truncated mid-string', content: '{"version":1,"appearance":{"theme":"Thr' },
  { name: 'whitespace only', content: '   \n' },
];

describe('a partially written settings.json is not mistaken for the defaults', () => {
  it('a COMPLETE document holding non-default values reads back as those values', async () => {
    // The control. Without it, a failure below could mean "the read is broken" rather than
    // "the read cannot distinguish unreadable from default".
    const root = freshRoot();
    writeFileSync(
      join(root, 'settings.json'),
      JSON.stringify({ version: 1, notifications: { error: { mode: 'never' } } }),
      'utf8',
    );
    const payload = await readConfigPayload(new FileConfigStore(root));
    expect(payload.settings.notifications.error.mode).toBe('never');
  });

  it.each(PARTIAL_STATES)(
    'reports that it could not read the document — $name',
    async ({ content }) => {
      const root = freshRoot();
      writeFileSync(join(root, 'settings.json'), content, 'utf8');

      const result = await readConfigOnce(new FileConfigStore(root));

      /*
       * THE ASSERTION THAT MATTERS. The payload is DEFAULT_APP_SETTINGS either way; what changed is
       * that it now arrives WITH a signal saying so, instead of being indistinguishable from a
       * document that really did say defaults. Without that signal the watcher broadcast the
       * defaults over the user's real settings and nothing re-read.
       */
      expect(
        result.settingsUnreadable,
        'the read must report that the document was unparseable, not silently substitute defaults',
      ).toBe(true);
    },
  );

  it('still hands back a USABLE payload while reporting the document unreadable', async () => {
    /*
     * The other half of the same guarantee, and the reason `unreadable` is a flag rather than an
     * error. A malformed settings file must not stop the application: it runs on the defaults, and
     * SAYS it is doing so. Reporting without a value would have made every caller handle a case
     * that has one obvious answer.
     */
    const root = freshRoot();
    writeFileSync(join(root, 'settings.json'), '{"version":1,"notifications":{"error":{"mo', 'utf8');

    const result = await readConfigOnce(new FileConfigStore(root));

    expect(result.settingsUnreadable).toBe(true);
    expect(result.payload.settings.notifications.error.mode).toBe(
      DEFAULT_APP_SETTINGS.notifications.error.mode,
    );
    expect(result.payload.keybindings).toBeDefined();
    expect(result.payload.theme).toBeDefined();
  });

  it('DOES NOT report unreadable for a document that is merely absent', async () => {
    // A config root with no settings.json is the first-run case, not a failure. Retrying it would
    // delay every launch on a brand-new install to learn something that was never going to change.
    const result = await readConfigOnce(new FileConfigStore(freshRoot()));
    expect(result.settingsUnreadable).toBe(false);
    expect(result.payload.settings.notifications.error.mode).toBe(
      DEFAULT_APP_SETTINGS.notifications.error.mode,
    );
  });

  it('DOES NOT report unreadable for a parseable document that merely needed correcting', async () => {
    // 031 FR-013a clamps out-of-range values and reports `corrected`. That is a different condition
    // and must not trigger a re-read: the correction is written back, and retrying it would loop.
    const root = freshRoot();
    writeFileSync(
      join(root, 'settings.json'),
      JSON.stringify({ version: 1, notifications: { error: { mode: 'timed', timeoutMs: 999999 } } }),
      'utf8',
    );
    const result = await readConfigOnce(new FileConfigStore(root));
    expect(result.settingsUnreadable).toBe(false);
  });

  it('the ORIGINAL payload shape is unchanged for every existing caller', async () => {
    // `readConfigPayload` is what main.ts and the initial `config.get` still call. Adding the
    // readability signal on a NEW entry point rather than widening this one is what kept the change
    // to the watcher and out of every other reader.
    const root = freshRoot();
    writeFileSync(
      join(root, 'settings.json'),
      JSON.stringify({ version: 1, notifications: { error: { mode: 'never' } } }),
      'utf8',
    );
    const payload = await readConfigPayload(new FileConfigStore(root));
    expect(payload.settings.notifications.error.mode).toBe('never');
    expect(Object.keys(payload).sort()).toEqual(['iconPacks', 'keybindings', 'settings', 'theme']);
  });
});
