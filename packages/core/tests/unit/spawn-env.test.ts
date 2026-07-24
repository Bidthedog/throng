import { describe, it, expect } from 'vitest';
import { sanitizeSpawnEnv } from '../../src/terminal/spawn-env.js';

/**
 * Terminal env hygiene. The daemon owns `THRONG_*` variables that name THIS instance —
 * its pipe (`THRONG_PIPE_NAME`), its database (`THRONG_DATABASE_PATH`), its config root —
 * and it spawns every terminal shell inheriting its own `process.env`. Left unfiltered, a
 * shell (and anything it runs, e.g. `npm start`) adopts the parent throng's identity: a
 * dev build launched from inside the packaged app targets the packaged daemon's pipe, hits
 * a build-id mismatch, and RETIRES it — killing the installed app's terminals. A spawned
 * shell must instead start from the same clean slate a bare OS shell would, so every throng
 * (packaged, the single dev run, each E2E instance) stays in its own space.
 */
describe('sanitizeSpawnEnv', () => {
  it('drops every THRONG_* instance variable', () => {
    const clean = sanitizeSpawnEnv({
      THRONG_PIPE_NAME: '\\\\.\\pipe\\throng.x.daemon',
      THRONG_DATABASE_PATH: 'C:\\throng\\throng.db',
      THRONG_CONFIG_ROOT: 'C:\\Users\\x\\.throng',
      THRONG_NO_ORPHAN_REAP: '1',
      PATH: 'C:\\Windows',
    });
    expect(clean).toEqual({ PATH: 'C:\\Windows' });
  });

  it('is case-insensitive (Windows env names fold case)', () => {
    const clean = sanitizeSpawnEnv({ throng_pipe_name: 'x', Throng_Database_Path: 'y', HOME: '/h' });
    expect(clean).toEqual({ HOME: '/h' });
  });

  it('keeps everything else verbatim, including a var that merely contains "throng"', () => {
    const env = {
      USERPROFILE: 'C:\\Users\\x',
      MY_THRONG_SETTING: 'keep me', // not a THRONG_ prefix — user's own var
      PROJECT: 'throng',
    };
    expect(sanitizeSpawnEnv(env)).toEqual(env);
  });

  it('returns a new object and never mutates its input', () => {
    const env = { THRONG_PIPE_NAME: 'x', PATH: '/p' };
    const clean = sanitizeSpawnEnv(env);
    expect(clean).not.toBe(env);
    expect(env.THRONG_PIPE_NAME).toBe('x'); // input untouched
  });

  it('preserves an explicitly-unset (undefined) value without inventing a THRONG_ key', () => {
    const clean = sanitizeSpawnEnv({ FOO: undefined, THRONG_PIPE_NAME: 'x' });
    expect('THRONG_PIPE_NAME' in clean).toBe(false);
    expect('FOO' in clean).toBe(true);
  });
});

/**
 * Regression guard: the leak is only closed if the PTY host actually routes its inherited
 * base env through the sanitiser. Assert the call site by source, the same way the
 * instance-paths ordering guard protects its wiring — a future edit that drops the call
 * reopens the throng-kills-throng footgun with no other test to catch it.
 */
describe('NodePtyHost wires the sanitiser at its spawn site', () => {
  it('builds the shell env from sanitizeSpawnEnv(process.env), not raw process.env', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(
      fileURLToPath(new URL('../../../platform-windows/src/node-pty-host.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toMatch(/sanitizeSpawnEnv\(process\.env\)/);
    expect(source).not.toMatch(/env:\s*\{\s*\.\.\.process\.env\b/);
  });
});
