import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';
import ts from 'typescript';

// @ts-expect-error — plain-JS packaging script, imported for its command decision.
import { main } from '../../../../packaging/in-use.mjs';

/**
 * 058 research D9 / T017 — the in-use helper both installers run before replacing or removing a copy.
 *
 * Layer: unit for the command decision (`main` against an injected process list: the OS query is the
 * only thing replaced). One test goes a layer up on purpose: the C1 proof that the STAGED pair —
 * the helper plus the classifier, copied into an empty directory with no node_modules — runs under
 * plain `node` and prints a verdict. That is how it runs from a pre-058 install root and from the
 * setup's $PLUGINSDIR, where `@throng/core` cannot be resolved, so no cheaper layer can show it.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const ROOT = 'C:\\Program Files\\throng';
const ME = 'S-1-5-21-1-1-1-1001';
const ALICE = 'S-1-5-21-1-1-1-1002';

const proc = (pid: number, path: string, sid: string, name: string) => ({
  pid,
  executablePath: path,
  ownerSid: sid,
  ownerName: name,
});

/** What the built `install-in-use.js` is: the module compiled on its own, with no imports. */
function classifierSource(): string {
  const source = readFileSync(join(repoRoot, 'packages', 'core', 'src', 'config', 'install-in-use.ts'), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}

/** The classifier exactly as it is staged, loaded the way the helper loads it. */
const { classifyInstallUse } = (await import(
  'data:text/javascript;base64,' + Buffer.from(classifierSource()).toString('base64')
)) as { classifyInstallUse: unknown };

const deps = (processes: unknown[], selfPid = 999) => ({
  listProcesses: async () => ({ performingSid: ME, processes }),
  classify: classifyInstallUse,
  selfPid,
});

describe('the in-use helper: main()', () => {
  it('prints the JSON verdict and exits 0', async () => {
    const r = await main(
      [ROOT],
      deps([proc(20, `${ROOT}\\throng.exe`, ALICE, 'PC\\alice'), proc(10, `${ROOT}\\throng.exe`, ME, 'PC\\me')]),
    );
    expect(r.code).toBe(0);
    const verdict = JSON.parse(r.stdout);
    expect(verdict.decision).toBe('others');
    expect(verdict.own).toEqual([10]);
    expect(verdict.others).toEqual([{ account: 'PC\\alice', pids: [20] }]);
    expect(verdict.message).toContain('PC\\alice');
  });

  it('never counts itself: the helper runs from the install root with the install root\'s own node.exe', async () => {
    const r = await main([ROOT], deps([proc(999, `${ROOT}\\resources\\runtime\\node.exe`, ME, 'PC\\me')], 999));
    expect(JSON.parse(r.stdout).decision).toBe('free');
  });

  it('judges only the install root it is given (FR-017)', async () => {
    const r = await main(
      [ROOT],
      deps([proc(20, 'C:\\Users\\alice\\AppData\\Local\\Programs\\throng\\throng.exe', ALICE, 'PC\\alice')]),
    );
    expect(JSON.parse(r.stdout).decision).toBe('free');
  });

  it.each([
    ['free', [], 'free|'],
    ['own-only', [proc(10, `${ROOT}\\throng.exe`, ME, 'PC\\me')], 'own-only|'],
  ])('--nsis prints one "<decision>|<message>" line for %s', async (_name, processes, expected) => {
    const r = await main(['--nsis', ROOT], deps(processes));
    expect(r.stdout.trim()).toBe(expected);
  });

  it('--nsis carries the refusal text after the decision for others', async () => {
    const r = await main(['--nsis', ROOT], deps([proc(20, `${ROOT}\\throng.exe`, ALICE, 'PC\\alice')]));
    const line = r.stdout.trim();
    expect(line.split('\n')).toHaveLength(1);
    expect(line.startsWith('others|')).toBe(true);
    expect(line.slice('others|'.length)).toBe(
      'throng is in use by other people signed in to this computer: PC\\alice. ' +
        'Nothing has been changed. Ask them to close throng, then try again.',
    );
  });

  it('refuses to guess an install root', async () => {
    const r = await main([], deps([]));
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/install root/i);
  });

  it('fails loudly, not "free", when the process list cannot be read', async () => {
    const r = await main([ROOT], {
      listProcesses: async () => {
        throw new Error('powershell blocked');
      },
      classify: classifyInstallUse,
      selfPid: 1,
    });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('powershell blocked');
  });
});

describe('the staged pair (C1)', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('runs under plain node from an empty directory and prints a verdict', { timeout: 60_000 }, () => {
    const source = classifierSource();
    // The classifier ships on its own: nothing for it to import.
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);

    const dir = mkdtempSync(join(tmpdir(), 'throng-in-use-'));
    dirs.push(dir);
    copyFileSync(join(repoRoot, 'packaging', 'in-use.mjs'), join(dir, 'in-use.mjs'));
    writeFileSync(join(dir, 'in-use-classify.js'), source);

    // A root nothing runs from: the real query runs, and the answer is "free".
    const nowhere = join(dir, 'no-such-install');
    const out = execFileSync(process.execPath, [join(dir, 'in-use.mjs'), '--nsis', nowhere], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('free|');
  });

  it('still answers when it is started through a different spelling of its own path (a junction, an 8.3 short name)', { timeout: 60_000 }, () => {
    // The setup runs the helper from $PLUGINSDIR, under the user's temp folder — on a runner a short
    // name (C:\Users\RUNNER~1\…). Node resolves the module's real path, so a plain comparison of
    // import.meta.url with argv[1] was false, the script's entry point never ran, and the helper
    // printed NOTHING and exited 0: "no decision", which the setup read as free. A junction is the
    // same difference, and creatable without privileges.
    const dir = mkdtempSync(join(tmpdir(), 'throng-in-use-'));
    dirs.push(dir);
    copyFileSync(join(repoRoot, 'packaging', 'in-use.mjs'), join(dir, 'in-use.mjs'));
    writeFileSync(join(dir, 'in-use-classify.js'), classifierSource());
    const link = `${dir}-link`;
    symlinkSync(dir, link, 'junction');
    dirs.push(link);

    const out = execFileSync(process.execPath, [join(link, 'in-use.mjs'), '--nsis', join(dir, 'no-such-install')], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('free|');
  });

  it('the setup\'s entry point (in-use-cli.mjs) answers through a junction too, with nothing to detect', { timeout: 60_000 }, () => {
    // The setup's own run of in-use.mjs from $PLUGINSDIR printed nothing on a runner (hand test MT-05:
    // "exit=0 output=" in the setup's log, while the same helper from the install root named the other
    // account). This file is a plain entry point beside the helper, so there is no path comparison to get wrong.
    const dir = mkdtempSync(join(tmpdir(), 'throng-in-use-'));
    dirs.push(dir);
    for (const f of ['in-use.mjs', 'in-use-cli.mjs']) copyFileSync(join(repoRoot, 'packaging', f), join(dir, f));
    writeFileSync(join(dir, 'in-use-classify.js'), classifierSource());
    const link = `${dir}-cli-link`;
    symlinkSync(dir, link, 'junction');
    dirs.push(link);

    const out = execFileSync(process.execPath, [join(link, 'in-use-cli.mjs'), '--nsis', join(dir, 'no-such-install')], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('free|');
    // and it never prints nothing: a missing root is an error with a message and a non-zero exit
    expect(() => execFileSync(process.execPath, [join(link, 'in-use-cli.mjs')], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })).toThrow(/install root is required/);
  });
});
