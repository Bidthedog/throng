import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { pickFolder } from '../../src/main/pick-folder.js';

/**
 * The `throng:pickFolder` handler opens the OS dialog at the right folder (011 US3, FR-040/041/043).
 *
 * ══ WHAT THIS REPLACED, AND WHY IT IS THE SAME PROOF ══
 *
 * `new-project-folder.e2e.ts` made these four assertions by launching Electron, monkey-patching
 * `dialog.showOpenDialog` from inside the running app to capture its `defaultPath`, clicking
 * "New project", and polling. Four launches, ~2s each, plus the app's whole startup path — to
 * observe one string handed to one function.
 *
 * The two DECISIONS underneath were already covered and still are:
 *   - which candidates, in what order → `core/tests/unit/starting-folder.test.ts`
 *   - which candidate survives an existence check → `ui/tests/unit/pick-folder.test.ts:21,32`
 *
 * 035's census recorded these four as duplicates of the FIRST of those. Reading both sides showed
 * that was not quite right: `resolveStartingFolder` is pure and returns a candidate LIST, and its
 * own documentation says existence "is verified in UI-main". Two of the four E2E tests turn on
 * exactly that existence step, which the ordering test cannot make. The second unit test does make
 * it — so the verdict survived, but only once the right covering test was named. A citation is part
 * of a claim.
 *
 * What genuinely had no home below E2E was the WIRING: that the requested candidates reach the
 * resolver, and that the resolver's answer is what the dialog is actually opened at. A handler that
 * resolved correctly and then opened at the wrong path would satisfy every unit test above. That is
 * what this file asserts, against a REAL temp directory — no window, no app, no Electron.
 */
const roots: string[] = [];
const makeDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'throng-pick-'));
  roots.push(d);
  return d;
};

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const HOME = 'C:/Users/nobody';
const GONE = 'D:/throng-does-not-exist-xyz-123';

/** The real filesystem — this is a contract test, so existence is genuinely checked. */
const realExists = (p: string): boolean => existsSync(p) && statSync(p).isDirectory();

/** A dialog stub that records what it was opened at and returns a chosen path. */
function dialogSpy(pick: string | null) {
  const seen: string[] = [];
  return {
    seen,
    showOpenDialog: async (options: { properties: readonly string[]; defaultPath: string }) => {
      seen.push(options.defaultPath);
      return pick === null
        ? { canceled: true, filePaths: [] }
        : { canceled: false, filePaths: [pick] };
    },
  };
}

describe('throng:pickFolder — the resolved candidate is what the dialog opens at', () => {
  it('opens at the last-viewed folder when it exists', async () => {
    const last = makeDir();
    const dlg = dialogSpy(last);
    const chosen = await pickFolder([last, HOME], {
      home: HOME,
      existsAsDir: realExists,
      showOpenDialog: dlg.showOpenDialog,
    });
    expect(dlg.seen).toEqual([last]);
    expect(chosen).toBe(last);
  });

  it('cascades past an unresolvable override to the last-viewed folder', async () => {
    // The case `starting-folder.test.ts` provably cannot make: it returns [GONE, last, HOME] and
    // says nothing about which one survives contact with the filesystem.
    const last = makeDir();
    const dlg = dialogSpy(last);
    await pickFolder([GONE, last, HOME], {
      home: HOME,
      existsAsDir: realExists,
      showOpenDialog: dlg.showOpenDialog,
    });
    expect(dlg.seen).toEqual([last]);
  });

  it('falls back to home when no candidate resolves', async () => {
    const dlg = dialogSpy(null);
    await pickFolder([GONE, 'D:/also-gone-abc'], {
      home: HOME,
      existsAsDir: realExists,
      showOpenDialog: dlg.showOpenDialog,
    });
    expect(dlg.seen).toEqual([HOME]);
  });

  it('opens at home when the profile setting asks for it', async () => {
    const dlg = dialogSpy(null);
    await pickFolder([HOME], { home: HOME, existsAsDir: () => true, showOpenDialog: dlg.showOpenDialog });
    expect(dlg.seen).toEqual([HOME]);
  });

  it('returns null when the dialog is cancelled, rather than the default path', async () => {
    // Not covered by the E2E tests this replaces, and worth having: a cancelled picker must not
    // silently behave as though the user chose the folder it happened to be showing.
    const dir = makeDir();
    const dlg = dialogSpy(null);
    const chosen = await pickFolder([dir], {
      home: HOME,
      existsAsDir: realExists,
      showOpenDialog: dlg.showOpenDialog,
    });
    expect(chosen).toBeNull();
  });

  it('returns the chosen path even when it is not the folder the dialog opened at', async () => {
    // The user navigates away from the default before choosing — the handler must return what they
    // picked, not what it suggested.
    const start = makeDir();
    const elsewhere = makeDir();
    const dlg = dialogSpy(elsewhere);
    const chosen = await pickFolder([start], {
      home: HOME,
      existsAsDir: realExists,
      showOpenDialog: dlg.showOpenDialog,
    });
    expect(dlg.seen).toEqual([start]);
    expect(chosen).toBe(elsewhere);
  });
});
