import { describe, it, expect } from 'vitest';
import {
  causeMessage,
  causeKey,
  startFailurePreservesPanelType,
  isTransportFailure,
  type FailureCause,
} from '@throng/core';

/**
 * 029 FR-019e / FR-013 / FR-013a / FR-013b / FR-003 — the cause owns the wording.
 *
 * Exact strings are asserted, not patterns. The point of FR-019e is that the SAME fault produces the
 * SAME words however it was reported, so a test that accepts a family of phrasings would not be
 * testing the requirement.
 */

const raw = "EBUSY: resource busy or locked, rename 'C:\\p\\Held' -> 'C:\\p\\Renamed'";

function cause(over: Partial<FailureCause> = {}): FailureCause {
  return { kind: 'held', subject: 'Held', raw, ...over };
}

describe('causeMessage — one sentence per kind', () => {
  it('held, third party', () => {
    expect(causeMessage(cause())).toBe('"Held" is open in another program.');
  });

  it('path-missing', () => {
    expect(causeMessage(cause({ kind: 'path-missing', subject: 'my-project' }))).toBe(
      '"my-project" could not be found. It may have been moved, renamed or deleted.',
    );
  });

  it('permission-denied', () => {
    expect(causeMessage(cause({ kind: 'permission-denied', subject: 'notes.txt' }))).toBe(
      'You do not have permission to change "notes.txt".',
    );
  });

  it('not-empty', () => {
    expect(causeMessage(cause({ kind: 'not-empty', subject: 'Docs' }))).toBe('"Docs" still contains items.');
  });

  it('daemon-stopped points at the status bar, where the action lives (FR-009a)', () => {
    expect(causeMessage(cause({ kind: 'daemon-stopped', subject: 'throng' }))).toBe(
      "throng's daemon has stopped. Restart it from the status bar to continue.",
    );
  });
});

describe('causeMessage — the subject appears in PROSE, not only inside a path (FR-017)', () => {
  /*
   * This is the assertion that caught a false pass in the replication specs: the suite's temp paths
   * contain both `throng` and the folder name, so matching the notice text was satisfied by the raw
   * errno's PATH rather than by any sentence. Stripping paths is how the requirement is really read.
   */
  it('names the subject with no path present at all', () => {
    const text = causeMessage(cause({ kind: 'path-missing', subject: 'ProjectBravo' }));
    expect(text).toContain('ProjectBravo');
    expect(text).not.toMatch(/[A-Za-z]:\\/);
  });

  it('never carries the raw errno', () => {
    for (const kind of ['held', 'path-missing', 'permission-denied', 'not-empty'] as const) {
      expect(causeMessage(cause({ kind }))).not.toMatch(/EBUSY|EPERM|ENOENT|EACCES|ENOTEMPTY/);
    }
  });
});

describe('causeMessage — throng as the holder (FR-013)', () => {
  it('names throng and the responsible panel', () => {
    expect(causeMessage(cause({ subject: 'Inner', holder: { isThrong: true, panelTitle: 'Build' } }))).toBe(
      '"Inner" is open in throng — the terminal "Build".',
    );
  });

  it('names the sub-workspace when the panel is in another window (FR-013a)', () => {
    expect(
      causeMessage(
        cause({ subject: 'Inner', holder: { isThrong: true, panelTitle: 'Build', windowTitle: 'Deploy' } }),
      ),
    ).toBe('"Inner" is open in throng — the terminal "Build", in the sub-workspace "Deploy".');
  });

  it('says so explicitly when the panel cannot be resolved (FR-013b)', () => {
    expect(causeMessage(cause({ subject: 'Inner', holder: { isThrong: true } }))).toBe(
      '"Inner" is open in throng — throng could not identify which panel.',
    );
  });

  it('names a third-party process when one is identified (FR-012)', () => {
    expect(
      causeMessage(cause({ holder: { isThrong: false, processName: 'explorer.exe', pid: 1234 } })),
    ).toBe('"Held" is open in another program — explorer.exe (pid 1234).');
  });
});

describe('causeKey — the "already told them" key (FR-019)', () => {
  it('is equal for the same kind and subject, however differently they were reported', () => {
    const fromTree = cause({ kind: 'path-missing', subject: 'Bravo', raw: "ENOENT: … realpath 'C:\\x'" });
    const fromTerminal = cause({ kind: 'path-missing', subject: 'Bravo', raw: 'Cannot lock "C:\\x"' });
    expect(causeKey(fromTree)).toBe(causeKey(fromTerminal));
  });

  it('differs for a different subject — two missing folders are two problems', () => {
    expect(causeKey(cause({ kind: 'path-missing', subject: 'A' }))).not.toBe(
      causeKey(cause({ kind: 'path-missing', subject: 'B' })),
    );
  });

  it('differs for a different kind on the same subject', () => {
    expect(causeKey(cause({ kind: 'held', subject: 'X' }))).not.toBe(
      causeKey(cause({ kind: 'permission-denied', subject: 'X' })),
    );
  });

  it('is NOT derived from the message text', () => {
    // The two measured #181 failures produce different messages for one cause. A text key would
    // collapse neither, which is the bug FR-019b names.
    const a = cause({ kind: 'path-missing', subject: 'Bravo', raw: 'one' });
    const b = cause({ kind: 'path-missing', subject: 'Bravo', raw: 'completely different' });
    expect(causeKey(a)).toBe(causeKey(b));
  });
});

describe('startFailurePreservesPanelType — the FR-003 split', () => {
  it('preserves the panel type for a missing folder — the #204 case', () => {
    expect(startFailurePreservesPanelType(cause({ kind: 'path-missing' }))).toBe(true);
  });

  it('preserves it for a held or permission-denied root — equally transient', () => {
    expect(startFailurePreservesPanelType(cause({ kind: 'held' }))).toBe(true);
    expect(startFailurePreservesPanelType(cause({ kind: 'permission-denied' }))).toBe(true);
  });

  it('does NOT preserve it for an unclassified failure — today\'s behaviour, unchanged', () => {
    // A missing FLAVOUR arrives unclassified, and `terminal-persistence.e2e.ts:81` deliberately
    // asserts it reverts. FR-003's second arm depends on exactly this returning false.
    expect(startFailurePreservesPanelType(null)).toBe(false);
  });
});

/**
 * FR-016 / FR-017 / SC-003 — the sweep, as a guard rather than as an afternoon's reading.
 *
 * The plan asked for a pass over the covered paths confirming that no user-facing notice carries a
 * raw error code or an internal string, and that each names its subject in prose. A sweep establishes
 * that on the day it is done and says nothing about the day after.
 *
 * Every classified message in the application comes from `causeMessage`, so asserting it over the
 * WHOLE closed set is the same claim, permanently. `Record<FailureKind, ...>` is what makes it
 * exhaustive: adding a sixth kind fails to compile until it is listed here, which is exactly when
 * someone should be made to think about its wording.
 */
describe('every cause speaks plainly (FR-016 / FR-017 / SC-003)', () => {
  /** The subject each kind is asked about — `daemon-stopped` is about throng itself. */
  const SUBJECTS: Record<FailureCause['kind'], string> = {
    held: 'Held',
    'path-missing': 'ProjectBravo',
    'permission-denied': 'Guarded',
    'not-empty': 'Full',
    'daemon-stopped': 'throng',
  };

  const KINDS = Object.keys(SUBJECTS) as Array<FailureCause['kind']>;

  it('covers the whole closed set — a new kind cannot slip past this file', () => {
    // Guards the guard: if `SUBJECTS` were emptied or the cast went wrong, every loop below would
    // pass by iterating over nothing.
    expect(KINDS.length).toBe(5);
  });

  for (const kind of KINDS) {
    describe(kind, () => {
      const text = causeMessage(cause({ kind, subject: SUBJECTS[kind] }));

      it('names its subject in prose', () => {
        expect(text).toContain(SUBJECTS[kind]);
      });

      it('carries no errno', () => {
        expect(text).not.toMatch(/\bE[A-Z]{3,}\b/);
      });

      it('carries no path', () => {
        // FR-017: a sentence that merely CONTAINS a path is not a sentence that names the thing.
        expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
      });

      it('carries no internal vocabulary', () => {
        // The strings measured reaching users on these paths: the directory lock's own throw, the
        // RPC envelope, and the catch-all prefix a thrown Error picks up on the way out.
        expect(text).not.toMatch(/Internal error|Cannot lock|jsonrpc|rpc error|realpath|\bnull\b|undefined/i);
      });

      it('is a sentence — terminated, and opening with a capital or the product name', () => {
        /*
         * Not pedantry: these are shown next to each other in a stack, and one fragment among five
         * sentences reads as a bug even when the words are right.
         *
         * The lowercase opening is allowed for exactly one word. `throng` is written lowercase
         * everywhere in this product, so "throng's daemon has stopped." is correct and capitalising
         * it to satisfy a rule about capitals would be the actual error.
         */
        expect(text.trim()).toMatch(/[.!?]$/);
        expect(text.trim()).toMatch(/^([A-Z"]|throng\b)/);
      });
    });
  }
});

/**
 * 029 FR-001 / C1 — a daemon that cannot be reached is a TRANSIENT failure, not a configuration one.
 *
 * ══ THE BUG THIS PINS ══
 *
 * Found by independent review, and it is #204 wearing a different trigger. `DaemonClient` rejects a
 * lost connection with the errno as the entire message, carrying no cause — so the attach failure
 * arrived unclassified, `startFailurePreservesPanelType(null)` said "revert", and every terminal
 * panel had its type stripped and PERSISTED. Start throng while its daemon is down and every
 * configured terminal becomes an empty Panel Type form, permanently.
 *
 * Worse, the Retry control this feature ADDED was destructive in that state: clicking it while the
 * daemon was down took the configuration the control existed to protect.
 *
 * FR-001 is explicit — "fails to START **or ATTACH**" — and SC-001 says no configured terminal is
 * ever lost to a start failure, in 100% of cases.
 */
describe('a stopped daemon never costs a panel its configuration (FR-001)', () => {
  it('preserves the panel type', () => {
    // The definitional transient-environmental failure: the daemon comes back, and the panel must
    // still be a terminal when it does.
    expect(startFailurePreservesPanelType(cause({ kind: 'daemon-stopped', subject: 'throng' }))).toBe(true);
  });

  it('still reverts for a configuration that can no longer be satisfied', () => {
    // The other arm of FR-003, asserted alongside so the fix cannot quietly become "never revert".
    // A missing flavour is a choice the user must remake; `terminal-persistence.e2e.ts` asserts it.
    expect(startFailurePreservesPanelType(null)).toBe(false);
  });
});

describe('isTransportFailure — the daemon is unreachable, not the file missing', () => {
  it.each([
    ['ENOENT', 'a bare errno, which is what a dead pipe produces'],
    ['  ENOENT  ', 'padded'],
    ['daemon-unreachable', "the client's own word for it"],
    ['invalid-response', 'a truncated or garbled reply'],
    ["ENOENT: no such file or directory, open '\\\\.\\pipe\\throng.daemon'", 'a named pipe in the text'],
  ])('recognises %j — %s', (raw) => {
    expect(isTransportFailure(raw)).toBe(true);
  });

  it.each([
    ['A file or folder with this name already exists.', 'a spoken sentence from files-service'],
    ['The project root cannot be renamed.', 'a validation refusal'],
    ["EBUSY: resource busy or locked, rename 'C:\\p\\Held'", 'a REAL errno about a real file'],
    ['"Held" is open in another program.', 'an already-classified message'],
    ['', 'nothing at all'],
  ])('leaves %j alone — %s', (raw) => {
    /*
     * This half is the point. Deciding by the daemon's STATE instead would relabel every one of
     * these as "throng's daemon has stopped" whenever the daemon happened to be down — including the
     * `FilesService` messages, which need no daemon at all. That breaks FR-011b's requirement that
     * an unmatched failure keeps today's behaviour exactly.
     */
    expect(isTransportFailure(raw)).toBe(false);
  });
});
