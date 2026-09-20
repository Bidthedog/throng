import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runShellIntegrationContract, type ShellIntegrationHarness } from '@throng/core/testing';
import {
  ElectronShellIntegration,
  type ElectronShellLike,
} from '../../src/main/electron-shell-integration.js';

/**
 * 045 SI1–SI3 (`contracts/platform-ports.md` §3) — `openWithDefaultProgram`, against REAL locations.
 *
 * The shared suite's three disk-dependent cases are opt-in: a harness earns them by supplying
 * `fixtures`, and one that supplies none skips them. That is why this file exists rather than the
 * cases simply being added to `tests/integration/electron-shell-integration.test.ts`, whose harness
 * is a pure fake with no disk behind it — "rejects for a path that does not exist" cannot be
 * asserted against a subject that never looks, and a skipped case is not a passing one.
 *
 * So the tree below is real, and the only thing still faked is the Electron `shell` itself, which is
 * the one part a test process genuinely cannot have. Everything the requirement is about — the stat,
 * the two refusals, and the text of the rejection — runs for real.
 */

const roots: string[] = [];

function fixtureTree(): { existingFile: string; existingFolder: string; missing: string } {
  const root = mkdtempSync(join(tmpdir(), 'throng-shell-si-'));
  roots.push(root);
  const existingFolder = join(root, 'a folder');
  mkdirSync(existingFolder, { recursive: true });
  const existingFile = join(root, 'notes.txt');
  writeFileSync(existingFile, 'fixture\n', 'utf8');
  return { existingFile, existingFolder, missing: join(root, 'gone.txt') };
}

afterAll(() => {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* a temp tree left behind is not worth failing a passing assertion over */
    }
  }
});

type Call = { op: 'reveal' | 'open'; path: string } | { op: 'openExternal'; url: string };

function makeHarness(): ShellIntegrationHarness {
  let calls: Call[] = [];
  const fakeShell: ElectronShellLike = {
    showItemInFolder: (p) => calls.push({ op: 'reveal', path: p }),
    openPath: async (p) => {
      calls.push({ op: 'open', path: p });
      return '';
    },
    openExternal: async (url) => {
      calls.push({ op: 'openExternal', url });
    },
  };
  return {
    // The real `statKind` — no injection. The refusals ARE the requirement, so faking what they
    // are decided from would leave the two cases asserting the harness rather than the subject.
    shell: new ElectronShellIntegration(fakeShell),
    calls: () => calls,
    reset: () => {
      calls = [];
    },
    fixtures: fixtureTree(),
    // 045 T259: an Electron `shell` that refuses everything, in the words an OS would use.
    failing: () => new ElectronShellIntegration(refusingShell()),
  };
}

/** An Electron `shell` whose every call fails — `openPath`'s error string, a throwing reveal. */
function refusingShell(): ElectronShellLike {
  return {
    showItemInFolder: () => {
      throw new Error('Access is denied.');
    },
    openPath: async () => 'No application is associated with this file',
    openExternal: async () => {},
  };
}

runShellIntegrationContract('ElectronShellIntegration (045 T052, SI1–SI3)', makeHarness);

/**
 * Two things the shared suite deliberately cannot say, because they are about THIS implementation
 * rather than about any `IShellIntegration`.
 */
describe('ElectronShellIntegration — what openWithDefaultProgram does once it accepts (FR-036)', () => {
  it('opens the file through the OS default handler, and reveals nothing', async () => {
    const h = makeHarness();
    h.reset();
    await h.shell.openWithDefaultProgram(h.fixtures!.existingFile);
    expect(h.calls()).toEqual([{ op: 'open', path: h.fixtures!.existingFile }]);
  });

  // *Round four (T259, platform-ports.md §7.2):* the three cases below asserted REJECTIONS and read
  // their text from the error. The refusal is now a resolved `{ ok: false, osReason }`; each case
  // asserts the same claim on that value.
  it('a refusal reaches the OS not at all — the stat happens FIRST', async () => {
    // The order matters: `shell.openPath` on a folder opens the file manager, which is the
    // neighbouring item's job (FR-030). Doing it and then complaining would be worse than either.
    const h = makeHarness();
    h.reset();
    await expect(h.shell.openWithDefaultProgram(h.fixtures!.existingFolder)).resolves.toMatchObject({ ok: false });
    await expect(h.shell.openWithDefaultProgram(h.fixtures!.missing)).resolves.toMatchObject({ ok: false });
    expect(h.calls()).toEqual([]);
  });

  it('SI3: each refusal names the path AND says which of the two it was', async () => {
    const h = makeHarness();
    const reasonOf = async (path: string): Promise<string> => {
      const result = await h.shell.openWithDefaultProgram(path);
      return result.ok ? '' : result.osReason;
    };
    const gone = await reasonOf(h.fixtures!.missing);
    const folder = await reasonOf(h.fixtures!.existingFolder);
    expect(gone).toContain(h.fixtures!.missing);
    expect(gone).toMatch(/exist/i);
    expect(folder).toContain(h.fixtures!.existingFolder);
    expect(folder).toMatch(/folder/i);
    // One notice has to name the file and the reason (030), so the two must not read alike.
    expect(gone).not.toBe(folder);
  });

  it('reports the OS’s own failure text when the handler refuses the file (FR-036)', async () => {
    let calls = 0;
    const failing: ElectronShellLike = {
      showItemInFolder: () => {},
      openPath: async () => {
        calls += 1;
        return 'No application is associated with this file';
      },
      openExternal: async () => {},
    };
    const fixtures = fixtureTree();
    const subject = new ElectronShellIntegration(failing);
    const result = await subject.openWithDefaultProgram(fixtures.existingFile);
    expect(calls).toBe(1);
    expect(result).toEqual({ ok: false, osReason: expect.stringContaining('No application is associated with this file') });
    expect(result.ok ? '' : result.osReason).toContain(fixtures.existingFile);
  });

  it('reports the OS’s own words when a reveal fails (T259)', async () => {
    const subject = new ElectronShellIntegration(refusingShell());
    await expect(subject.revealInFileManager('C:\\x\\y.txt')).resolves.toEqual({
      ok: false,
      osReason: expect.stringContaining('Access is denied.'),
    });
  });
});
