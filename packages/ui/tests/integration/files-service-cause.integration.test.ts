import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import type { Holder, IFileSystem } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { ElectronShellIntegration } from '../../src/main/electron-shell-integration.js';
import { FilesService } from '../../src/main/files-service.js';

/**
 * 029 FR-011 / FR-011b / FR-018 — the `files-service` seam, against a REAL filesystem.
 *
 * ══ WHY THIS LAYER, WHEN `classifyFailure` IS ALREADY UNIT-TESTED ══
 *
 * The unit tests prove the rule; they cannot prove that the errors this service actually catches
 * reach it. Two things only a real filesystem settles:
 *
 *   • which errno Windows returns for a held folder. #196 quotes `EPERM`; the replication measured
 *     `EBUSY`. Both are real, they depend on how the handle was opened, and a fix that classified
 *     only the quoted one would miss the commoner case.
 *   • that an UNMATCHED failure comes through byte-identical (FR-011b). That is the guarantee this
 *     whole feature rests on — a classifier that declines to guess cannot make anything worse — and
 *     it is a property of this seam, not of the pure function.
 *
 * ENOTEMPTY and EACCES are driven here for a specific reason: neither was replicated by a bug, which
 * makes them the two kinds most likely to ship never having been executed once.
 */

const holdFolder = (folder: string): ChildProcess =>
  spawn(process.execPath, ['-e', 'setInterval(()=>{},1e9)'], {
    cwd: folder,
    windowsHide: true,
    stdio: 'ignore',
  });

/**
  * Wait until the OS really refuses to rename `dir` — a spawn is not a held handle yet.
  *
  * The delay comes BEFORE the first probe, which is not tidiness. Probing immediately renames the
  * directory out from under a child that has not finished starting, so it launches with no working
  * directory, holds nothing, and every subsequent probe succeeds — the loop then spends its whole
  * budget proving a hold that its own first iteration prevented. Measured: 100 probes, 10.8s, no hold.
  */
async function untilHeld(dir: string): Promise<boolean> {
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      renameSync(dir, `${dir}-probe`);
      renameSync(`${dir}-probe`, dir);
    } catch {
      return true;
    }
  }
  return false;
}

describe('FilesService failure classification (029 FR-011)', () => {
  let root: string;
  let svc: FilesService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'throng-cause-'));
    svc = new FilesService(
      new NodeFileSystem((p) => rm(p, { recursive: true, force: true })),
      new ElectronShellIntegration({ showItemInFolder: () => {}, openPath: async () => '' }),
    );
    svc.setRoot(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('turns a held folder into a `held` cause, keeping the errno for Copy', async () => {
    const held = join(root, 'Held');
    await mkdir(held);
    const holder = holdFolder(held);
    try {
      expect(await untilHeld(held), 'the holder never actually locked the folder').toBe(true);

      const res = await svc.rename('Held', 'Renamed');

      expect('error' in res && res.cause?.kind).toBe('held');
      // The SUBJECT is the folder's name, in prose — never the path it was extracted from (FR-017).
      expect('error' in res && res.cause?.subject).toBe('Held');
      expect('error' in res && res.error).not.toMatch(/EBUSY|EPERM/);
      /*
       * FR-018 — demoted, not discarded. The classification is the point of this feature and the raw
       * text is what a bug report needs; a fix that produced a readable sentence by destroying the
       * evidence would trade one failure of communication for another.
       *
       * Both errnos accepted deliberately: Windows picks between them by how the handle was opened.
       */
      expect('error' in res && res.cause?.raw).toMatch(/EBUSY|EPERM/);
    } finally {
      holder.kill();
      await rm(`${held}-probe`, { recursive: true, force: true }).catch(() => {});
    }
  }, 30_000);

  it('passes an UNMATCHED failure through byte-identical (FR-011b)', async () => {
    // A collision is refused by the service's own rules, never by an errno, so it matches none of
    // the five kinds. This is the no-regression guarantee stated as a test: everything the
    // classifier does not recognise reads exactly as it did before 029.
    await writeFile(join(root, 'a.txt'), 'x');
    await writeFile(join(root, 'b.txt'), 'x');

    const res = await svc.rename('a.txt', 'b.txt');

    expect(res).toEqual({ error: 'A file or folder with this name already exists.' });
    expect('cause' in res).toBe(false);
  });

  it('names the PROJECT FOLDER when the root itself has gone (029 FR-015)', async () => {
    /*
     * #181's measured source. `within()` calls `realpath` on the root before every operation, so a
     * project whose folder was renamed away outside throng fails there — with `ENOENT: no such file
     * or directory, realpath 'C:\\…'`, which names a path and no project and reads as a missing FILE.
     *
     * Driven through `list('')`, because entering a project reads its root first and this is the
     * failure the user actually meets.
     */
    const gone = await mkdtemp(join(tmpdir(), 'throng-gone-'));
    const svc2 = new FilesService(
      new NodeFileSystem((p) => rm(p, { recursive: true, force: true })),
      new ElectronShellIntegration({ showItemInFolder: () => {}, openPath: async () => '' }),
    );
    svc2.setRoot(gone);
    await rm(gone, { recursive: true, force: true });

    const res = await svc2.list('');

    expect('error' in res && res.cause?.kind).toBe('path-missing');
    expect('error' in res && res.error).not.toContain('ENOENT');
    expect('error' in res && res.error).not.toContain('realpath');
    // The subject is the folder's NAME, in prose — FR-017. A sentence containing a path is not a
    // sentence that names the thing.
    expect('error' in res && res.error).toContain(basename(gone));
  });

  it('classifies a missing path rather than reporting ENOENT at the user', async () => {
    const res = await svc.rename('nope.txt', 'other.txt');

    expect('error' in res && res.cause?.kind).toBe('path-missing');
    expect('error' in res && res.error).not.toContain('ENOENT');
    expect('error' in res && res.error).toContain('nope.txt');
  });

  /**
   * A service whose `rename` fails with a chosen errno, and whose everything-else is real.
   *
   * Some kinds cannot be produced on demand: a genuine EACCES needs a second user account, and
   * ENOTEMPTY is refused by the service's own friendlier exists-check long before the OS is asked.
   * Driving them through the real seam with a real error object is the honest middle — it exercises
   * the classification and the wording, and is explicit that the OS is not what produced the errno.
   *
   * Delegating rather than spreading: `NodeFileSystem` is a class, so a spread copies its own
   * properties and drops every prototype method — the service would then die on `realpath` long
   * before the rename, and the test would pass or fail for reasons of its own.
   */
  function serviceThrowing(error: unknown): FilesService {
    const real = new NodeFileSystem((path) => rm(path, { recursive: true, force: true }));
    const fs: IFileSystem = {
      list: (d) => real.list(d),
      mkdir: (path) => real.mkdir(path),
      stat: (path) => real.stat(path),
      realpath: (path) => real.realpath(path),
      exists: (path) => real.exists(path),
      rename: () => Promise.reject(error),
      move: (src, dest) => real.move(src, dest),
      copy: (src, dest, newName) => real.copy(src, dest, newName),
      delete: (path) => real.delete(path),
      trash: (path) => real.trash(path),
      restoreFromTrash: (path, at) => real.restoreFromTrash(path, at),
      readBytes: (path) => real.readBytes(path),
      writeBytes: (path, bytes) => real.writeBytes(path, bytes),
    };
    const service = new FilesService(
      fs,
      new ElectronShellIntegration({ showItemInFolder: () => {}, openPath: async () => '' }),
    );
    service.setRoot(root);
    return service;
  }

  const errno = (code: string, message: string): Error =>
    Object.assign(new Error(message), { code });

  it('resolves an ambiguous EPERM by the OPERATION, not by the code', async () => {
    // The heart of #196: Windows returns EPERM for a held handle AND for an ACL refusal, and the
    // errno cannot separate them. A rename is a lock-class operation, so `held` is the reading.
    await mkdir(join(root, 'Locked'), { recursive: true });
    const svc2 = serviceThrowing(errno('EPERM', "EPERM: operation not permitted, rename 'Locked'"));

    const res = await svc2.rename('Locked', 'Unlocked');

    // `held`, not `permission-denied`. Getting this backwards is #196's exact harm: "operation not
    // permitted" reads as a permissions problem and sends the user to inspect an ACL for a lock.
    expect('error' in res && res.cause?.kind).toBe('held');
    expect('error' in res && res.error).toMatch(/open in/i);
  });

  it('classifies EACCES as permission-denied — unreplicated, so most at risk of never running', async () => {
    await mkdir(join(root, 'Guarded'), { recursive: true });
    const svc2 = serviceThrowing(errno('EACCES', "EACCES: permission denied, rename 'Guarded'"));

    const res = await svc2.rename('Guarded', 'Open');

    // Unlike EPERM this one is NOT ambiguous, so the operation must not override it — a lock-class
    // operation failing with EACCES is still a permissions problem.
    expect('error' in res && res.cause?.kind).toBe('permission-denied');
    expect('error' in res && res.error).toBe('You do not have permission to change "Guarded".');
    expect('error' in res && res.cause?.raw).toContain('EACCES');
  });

  it('passes an UNRECOGNISED ERRNO through untouched — the classifier declines, it does not guess', async () => {
    /*
     * The other FR-011b test uses a name collision, which returns from `renameInBracket`'s early
     * VALIDATION and never reaches `failure()` at all. It proves the early-return path is untouched,
     * which is worth knowing and is not this.
     *
     * This one puts a real errno the closed set does not contain through the ACTUAL classifier. That
     * is the guarantee the whole feature rests on — a classifier that declines to guess cannot make
     * anything worse — and nothing exercised it at this seam.
     */
    await mkdir(join(root, 'Full2'), { recursive: true });
    const raw = "ENOSPC: no space left on device, rename 'Full2'";
    const svc2 = serviceThrowing(errno('ENOSPC', raw));

    const res = await svc2.rename('Full2', 'Elsewhere');

    expect(res).toEqual({ error: raw }); // byte-identical, and no cause attached
  });

  it('classifies ENOTEMPTY as not-empty — the other kind no bug replicated', async () => {
    await mkdir(join(root, 'Full'), { recursive: true });
    const svc2 = serviceThrowing(errno('ENOTEMPTY', "ENOTEMPTY: directory not empty, rename 'Full'"));

    const res = await svc2.rename('Full', 'Empty');

    expect('error' in res && res.cause?.kind).toBe('not-empty');
    expect('error' in res && res.error).toBe('"Full" still contains items.');
    expect('error' in res && res.error).not.toMatch(/ENOTEMPTY/);
  });

  it('asks who is holding it, and says so when the answer is throng', async () => {
    const seen: string[] = [];
    const holder: Holder = { isThrong: true, panelTitle: 'Build' };
    const svc2 = serviceThrowing(errno('EBUSY', "EBUSY: resource busy or locked, rename 'Held'"));
    svc2.setHolderResolver(async (abs) => {
      seen.push(abs);
      return holder;
    });
    await mkdir(join(root, 'Held3'), { recursive: true });

    const res = await svc2.rename('Held3', 'Renamed3');

    // The lookup runs on the ABSOLUTE path — the resolver compares it against shell cwds, which are
    // absolute, and a root-relative path would silently match nothing.
    expect(seen[0]).toBe(join(root, 'Held3'));
    expect('error' in res && res.cause?.holder).toEqual(holder);
    expect('error' in res && res.error).toBe('"Held" is open in throng — the terminal "Build".');
  });

  it('does NOT ask when the failure could not name a holder anyway', async () => {
    /*
     * The lookup is a `terminal.list { refreshCwd }` round trip plus a PEB read per running terminal,
     * and it happens inside the `catch` — which also delays the `finally` that closes the move
     * bracket, leaving every open document `movePending` for longer than the operation took.
     *
     * Only `held` renders a holder; every other kind's sentence has nowhere to put one. So paying
     * for an answer on an ENOENT bought a value that was computed, carried, and never read.
     */
    const seen: string[] = [];
    svc.setHolderResolver(async (abs) => {
      seen.push(abs);
      return { isThrong: true };
    });

    const res = await svc.rename('nope.txt', 'other.txt');

    expect('error' in res && res.cause?.kind).toBe('path-missing');
    expect(seen, 'a missing file cannot be held by anyone').toEqual([]);
  });

  /**
   * FR-018's OTHER half — the raw text reaches the diagnostics log, not just the Copy payload.
   *
   * The requirement names both deliberately, and they serve different moments: Copy serves the user
   * writing a bug report while the notice is still on screen; the log serves everyone afterwards,
   * which is the state a support conversation actually begins in. Shipping only Copy satisfied the
   * easy half and left a stated MUST unbuilt — caught by review after the feature was called done.
   */
  it('writes the raw error to the diagnostics log when a cause replaces it (FR-018)', async () => {
    const logged: string[] = [];
    const svc2 = serviceThrowing(errno('EBUSY', "EBUSY: resource busy or locked, rename 'Held'"));
    svc2.setDiagnosticLog((m) => logged.push(m));
    await mkdir(join(root, 'Held5'), { recursive: true });

    const res = await svc2.rename('Held5', 'Renamed5');

    // The user reads the classified sentence…
    expect('error' in res && res.error).toBe('"Held" is open in another program.');
    // …and the errno it replaced is on disk, where dismissing the notice cannot reach it.
    expect(logged.join('\n')).toContain('EBUSY: resource busy or locked');
  });

  it('does NOT log a failure it reported verbatim', async () => {
    /*
     * An unclassified failure is shown to the user exactly as it came (FR-011b), so nothing was
     * demoted and there is nothing to preserve. Logging it anyway would fill the diagnostics file
     * with lines identical to what the notice already said — noise that makes the real entries
     * harder to find, which is the opposite of what FR-018 is for.
     */
    const logged: string[] = [];
    const svc2 = serviceThrowing(errno('ENOSPC', 'ENOSPC: no space left on device'));
    svc2.setDiagnosticLog((m) => logged.push(m));
    await mkdir(join(root, 'Full3'), { recursive: true });

    await svc2.rename('Full3', 'Elsewhere3');

    expect(logged).toEqual([]);
  });

  it('survives having no log attached at all', async () => {
    // The seam is optional, and a service without one must still classify rather than throwing on a
    // failure path — the one place a second error is least affordable.
    const svc2 = serviceThrowing(errno('EBUSY', "EBUSY: resource busy or locked, rename 'Held'"));
    await mkdir(join(root, 'Held6'), { recursive: true });

    const res = await svc2.rename('Held6', 'Renamed6');

    expect('error' in res && res.cause?.kind).toBe('held');
  });

  it('degrades to "not identified" when the holder lookup throws', async () => {
    const svc2 = serviceThrowing(errno('EBUSY', "EBUSY: resource busy or locked, rename 'Held'"));
    svc2.setHolderResolver(async () => {
      throw new Error('the process went between the failure and the lookup');
    });
    await mkdir(join(root, 'Held4'), { recursive: true });

    const res = await svc2.rename('Held4', 'Renamed4');

    // Identifying a holder is inherently racy. A lookup that fails must be a stated outcome
    // (FR-012), never a second error stacked on top of the user's first.
    expect('error' in res && res.cause?.kind).toBe('held');
    expect('error' in res && res.cause?.holder).toBeUndefined();
    expect('error' in res && res.error).toBe('"Held" is open in another program.');
  });
});
