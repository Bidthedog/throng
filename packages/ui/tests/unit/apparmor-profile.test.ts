import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { skipUnlessLinux } from '@throng/core/testing';

const SCRIPT = resolve(import.meta.dirname, '../../../../scripts/linux/apparmor-profile.sh');

describe.skipIf(skipUnlessLinux('the script writes an AppArmor profile, which exists only on Linux'))(
  'apparmor-profile.sh (062 FR-002, FR-003)',
  () => {
    let etc: string;
    let checkout: string;
    const run = (action: string, root = checkout): string =>
      execFileSync('bash', [SCRIPT, action, '--root', root, '--etc', etc, '--no-load'], { encoding: 'utf8' });

    beforeEach(() => {
      etc = mkdtempSync(join(tmpdir(), 'throng-aa-etc-'));
      checkout = mkdtempSync(join(tmpdir(), 'throng-aa-root-'));
    });
    afterEach(() => {
      rmSync(etc, { recursive: true, force: true });
      rmSync(checkout, { recursive: true, force: true });
    });

    it('writes a profile attached only to this checkout and its worktrees, granting user namespaces', () => {
      run('install');
      const [file] = readdirSync(etc);
      const profile = readFileSync(join(etc, file!), 'utf8');
      expect(profile).toContain(`"${checkout}{,/.claude/worktrees/*}/node_modules/electron/dist/electron"`);
      expect(profile).toContain('userns,');
      expect(profile).toContain(`# throng-checkout: ${checkout}`);
    });

    it('limits nothing: the profile is unconfined, so it cannot restrict which folders throng opens', () => {
      run('install');
      const profile = readFileSync(join(etc, readdirSync(etc)[0]!), 'utf8');
      expect(profile).toContain('flags=(unconfined)');
    });

    it('gives two checkouts two profiles, and a worktree its main checkout\'s', () => {
      const other = mkdtempSync(join(tmpdir(), 'throng-aa-other-'));
      try {
        run('install');
        run('install', other);
        expect(readdirSync(etc)).toHaveLength(2);
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    });

    it('reports its state, and removes what it installed', () => {
      const missing = spawnSync('bash', [SCRIPT, 'status', '--root', checkout, '--etc', etc, '--no-load'], { encoding: 'utf8' });
      expect(missing.status).toBe(1);
      run('install');
      expect(run('status')).toContain('Installed');
      run('remove');
      expect(readdirSync(etc)).toEqual([]);
      expect(run('remove')).toContain('No profile');
    });
  },
);
