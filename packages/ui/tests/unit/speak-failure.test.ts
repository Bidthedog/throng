import { describe, expect, it } from 'vitest';
import { speakFailure } from '../../src/renderer/common/notification.js';

/**
 * `speakFailure` — the renderer's half of 029 / #196 (FR-011b, FR-018, FR-023, FR-027).
 *
 * ══ WHAT THIS IS THE MISSING HALF OF ══
 *
 * The classification is proved twice already, at both ends. `failure-cause.test.ts` proves the
 * errno-to-kind rules and `failure-cause-message.test.ts` proves each kind's sentence — including
 * that no sentence contains an errno, and that the subject appears in PROSE rather than only inside
 * a quoted path. `files-service-cause.integration.test.ts` proves a REALLY held folder (a live child
 * process whose cwd is that folder, the same mechanism `WindowsDirectoryLock` uses) produces the
 * `held` cause with the errno preserved for Copy.
 *
 * What neither end covers is this function, which is the JOIN: the renderer's own classifier for a
 * failure that arrives as a bare message string, and the place that decides the errno goes to
 * `copyDetail` rather than to `message` or `details`. `fileop-lock-cause.e2e.ts` asserted that join
 * by holding a real folder, launching Electron, renaming in the tree, reading the notice's text and
 * then clicking Copy and reading the clipboard back — for a derivation that takes a string and
 * returns an object.
 *
 * The E2E's four assertions are here as four tests, on the same errno strings it measured on master.
 * Its fifth act — that Copy puts `copyDetail` on the clipboard — is `notice-copy.test.ts`'s and
 * `notice-stacking.e2e.ts:62`'s, and the E2E's own comment said so.
 */

/** The two errnos #196 produces, verbatim in shape — see the migrated spec's "MEASURED" note. */
const EBUSY_RENAME =
  "EBUSY: resource busy or locked, rename 'C:\\Temp\\throng-196-root\\Held' -> 'C:\\Temp\\throng-196-root\\Renamed'";
const EPERM_RENAME =
  "EPERM: operation not permitted, rename 'C:\\Temp\\throng-196-root\\Held' -> 'C:\\Temp\\throng-196-root\\Renamed'";

/** The notice's prose with file paths removed — the E2E's own guard, and it earns its place here. */
const prose = (text: string): string => text.replace(/[A-Za-z]:\\[^\s'"|]+/g, '<path>');

describe('a failure held by another program (migrated from fileop-lock-cause.e2e.ts:111)', () => {
  it('names the folder in PROSE, not merely inside the errno path', () => {
    const { message } = speakFailure(EBUSY_RENAME);
    // The reason the E2E stripped paths first: `toContain('Held')` is satisfied by the folder's
    // appearance inside the raw errno, so it passes while the message still says "this item".
    expect(prose(message)).toContain('Held');
  });

  it('says the folder is open in another program', () => {
    const { message } = speakFailure(EBUSY_RENAME);
    expect(message).toMatch(/open in another program|another program|in use by another/i);
  });

  it('keeps the raw errno out of the headline, for BOTH codes', () => {
    // #196 reports EPERM; replicating it against a local temp folder produced EBUSY. Windows picks
    // between them by how the holder opened the handle, so a classifier that handled only the one
    // the issue quoted would miss the commoner case.
    for (const raw of [EBUSY_RENAME, EPERM_RENAME]) {
      const { message } = speakFailure(raw);
      expect(prose(message)).not.toMatch(
        /EBUSY|EPERM|resource busy or locked|operation not permitted/,
      );
    }
  });

  it('demotes the errno to copyDetail rather than discarding it (FR-018)', () => {
    // Dropping it entirely was the first version, and it traded one failure of communication for
    // another: the user could read the notice but no longer report it.
    const { copyDetail } = speakFailure(EBUSY_RENAME);
    expect(copyDetail).toBe(EBUSY_RENAME);
  });

  it('gives the two errnos the SAME causeKey — one cause, one notice', () => {
    // FR-019 is about a user not being told the same thing twice. Two codes for one condition must
    // therefore collapse, or a retry that flips EPERM to EBUSY stacks a second card.
    expect(speakFailure(EBUSY_RENAME).causeKey).toBe(speakFailure(EPERM_RENAME).causeKey);
  });
});

describe('an unmatched failure is passed through byte-identical (FR-011b)', () => {
  it('returns the raw message unchanged and classifies nothing', () => {
    const raw = 'Something went wrong in a way nobody has classified.';
    expect(speakFailure(raw)).toEqual({ message: raw });
  });

  it('does not attach a copyDetail to a message it did not replace', () => {
    // Copy composes heading + message + details + copyDetail, so a copyDetail equal to the message
    // would put the same sentence in the clipboard twice.
    expect(speakFailure('plain failure').copyDetail).toBeUndefined();
  });
});

describe('the heading has already named the subject (FR-023 / FR-027)', () => {
  it('says "It" rather than repeating a name the heading just gave', () => {
    const { message } = speakFailure(EBUSY_RENAME, 'Held');
    expect(message).toBe('It is open in another program.');
  });

  it('QUOTES the name when the heading presented a DIFFERENT one', () => {
    // A rename can fail because the containing FOLDER is held while the heading names the file.
    // Blanking a name the reader was never given would replace an ambiguity with a nothing.
    const { message } = speakFailure(EBUSY_RENAME, 'SomethingElse');
    expect(message).toBe('"Held" is open in another program.');
  });
});
