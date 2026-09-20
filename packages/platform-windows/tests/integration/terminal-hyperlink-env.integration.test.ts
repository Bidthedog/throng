import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { hyperlinkAdvertisementEnv, sanitizeSpawnEnv } from '@throng/core';
import { dropInheritedModulePath } from '../../src/spawn-env-windows.js';

/**
 * 045 T119, FR-080 – FR-080d / SC-011 — what a REAL shell throng starts actually sees.
 *
 * ══ WHY A REAL SHELL, AND WHY NOT AN E2E ══
 *
 * The claim is about an environment a process was given, and an environment is fixed at spawn. A
 * string assertion over `launch.env` would pass just as happily against a value that never reached
 * the shell, because the layering that decides it happens two packages away
 * (`node-pty-host.ts:135-138`, over `sanitizeSpawnEnv`). So this composes the environment exactly as
 * that host does, spawns a shell with it, and asks the shell.
 *
 * It is NOT an E2E. The spec's own Assumptions put it here, and rightly: nothing about it needs a
 * window, a renderer, a daemon or a pty — only a process with an environment.
 *
 * ══ WHAT IT CANNOT SETTLE ══
 *
 * Whether a particular program — Claude Code, say — actually emits OSC 8 under `FORCE_HYPERLINK=1`
 * on this Windows build is a property of that program, not of throng. quickstart §6 is where that
 * is answered, by hand.
 */

/** Exactly the composition `node-pty-host.ts` performs before it spawns. */
function spawnEnv(
  baseEnv: NodeJS.ProcessEnv,
  advertise: boolean,
  flavourEnv: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const added = hyperlinkAdvertisementEnv(baseEnv, advertise);
  // `terminal-ipc` merges throng's addition into `launch.env`, never into the base (R11).
  const launchEnv = added ? { ...flavourEnv, ...added } : flavourEnv;
  return { ...dropInheritedModulePath(sanitizeSpawnEnv(baseEnv)), ...launchEnv };
}

/**
 * Ask a real `cmd.exe` what a variable holds, distinguishing "unset" from "set to nothing".
 *
 * `%VAR%` expands to the literal `%VAR%` when the variable does not exist, which is the only form
 * that tells the two apart — and telling them apart is the whole of E5.
 */
function readVar(env: NodeJS.ProcessEnv, name: string): string {
  const out = execFileSync('cmd.exe', ['/d', '/c', `echo %${name}%`], {
    encoding: 'utf8',
    env: env as Record<string, string>,
    timeout: 30_000,
  });
  const value = out.trim();
  return value === `%${name}%` ? '<unset>' : value;
}

/** A base environment with no `FORCE_HYPERLINK` of any spelling, whatever the machine carries. */
function cleanBase(): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(process.env)) {
    if (key.toUpperCase() === 'FORCE_HYPERLINK') continue;
    base[key] = process.env[key];
  }
  return base;
}

describe('FR-080 — a terminal throng starts advertises hyperlink support', () => {
  it('the shell sees FORCE_HYPERLINK=1 with the setting on', () => {
    expect(readVar(spawnEnv(cleanBase(), true), 'FORCE_HYPERLINK')).toBe('1');
  });

  it('and sees nothing throng added with the setting off', () => {
    expect(readVar(spawnEnv(cleanBase(), false), 'FORCE_HYPERLINK')).toBe('<unset>');
  });
});

describe('FR-080a — a value the user set is never overridden, in either direction', () => {
  it('a seeded FORCE_HYPERLINK=0 still reads 0 with the setting on', () => {
    const base = { ...cleanBase(), FORCE_HYPERLINK: '0' };
    expect(readVar(spawnEnv(base, true), 'FORCE_HYPERLINK')).toBe('0');
  });

  it('a seeded FORCE_HYPERLINK=1 is the USER’s 1, and survives the setting being off', () => {
    const base = { ...cleanBase(), FORCE_HYPERLINK: '1' };
    expect(readVar(spawnEnv(base, true), 'FORCE_HYPERLINK')).toBe('1');
    expect(readVar(spawnEnv(base, false), 'FORCE_HYPERLINK')).toBe('1');
  });

  it('a lower-case `force_hyperlink` is the SAME variable — Windows folds env names', () => {
    const base = { ...cleanBase(), force_hyperlink: '0' };
    expect(readVar(spawnEnv(base, true), 'FORCE_HYPERLINK')).toBe('0');
  });

  it('set-but-empty is set: throng does not fill it in', () => {
    const base = { ...cleanBase(), FORCE_HYPERLINK: '' };
    // `cmd` reports an empty variable as unset, so the observable is that throng did not write `1`.
    expect(readVar(spawnEnv(base, true), 'FORCE_HYPERLINK')).not.toBe('1');
  });
});

describe('FR-080d — throng never claims to be another terminal', () => {
  it('no WT_SESSION and no TERM_PROGRAM are added, at either setting', () => {
    const base = cleanBase();
    // Whatever this machine inherited is not something throng SET; the claim is about the delta.
    for (const advertise of [true, false]) {
      const added = spawnEnv(base, advertise);
      for (const name of ['WT_SESSION', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION']) {
        expect(readVar(added, name), `${name} at advertise=${advertise}`).toBe(
          readVar({ ...dropInheritedModulePath(sanitizeSpawnEnv(base)) }, name),
        );
      }
    }
  });

  it('the one key throng may add is FORCE_HYPERLINK, and there is never a second', () => {
    const added = hyperlinkAdvertisementEnv(cleanBase(), true);
    expect(Object.keys(added ?? {})).toEqual(['FORCE_HYPERLINK']);
  });
});
