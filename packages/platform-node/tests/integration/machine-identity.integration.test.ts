import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ANON_SALT_FILE,
  LEGACY_ANON_SALT_FILE,
  createProcessAnonymiser,
  readOrCreateSalt,
} from '@throng/platform-node';

/**
 * 068 — the salt file and the machine identity, against a real folder and the real OS.
 *
 * Layer: integration — a salt that survives a restart and a home folder read from the OS are facts
 * about the disk and the machine that no fake can show.
 *
 * The salt lives in the user data folder, NEVER in the logs folder: logs are what a user zips into a
 * bug report, and with the salt an 8-hex token of a short name can be reversed by guessing.
 */
describe('machine identity (068)', () => {
  let userData: string;
  let logs: string;
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'throng-salt-'));
    logs = join(userData, 'logs');
    mkdirSync(logs);
  });
  afterEach(() => rmSync(userData, { recursive: true, force: true }));

  it('creates the salt once, in the user data folder, and reads the same value back', () => {
    const first = readOrCreateSalt(userData, logs);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(userData, ANON_SALT_FILE), 'utf8').trim()).toBe(first);
    expect(readOrCreateSalt(userData, logs)).toBe(first);
    expect(readdirSync(logs)).toEqual([]);
  });

  it('moves a salt an earlier build left in the logs folder, keeping tokens stable, and leaves no copy', () => {
    writeFileSync(join(logs, LEGACY_ANON_SALT_FILE), 'legacy-salt-value\n');
    expect(readOrCreateSalt(userData, logs)).toBe('legacy-salt-value');
    expect(readFileSync(join(userData, ANON_SALT_FILE), 'utf8').trim()).toBe('legacy-salt-value');
    expect(existsSync(join(logs, LEGACY_ANON_SALT_FILE))).toBe(false);
  });

  it('removes a stale logs copy even when the new salt already exists, and keeps the new one', () => {
    const current = readOrCreateSalt(userData, logs);
    writeFileSync(join(logs, LEGACY_ANON_SALT_FILE), 'old');
    expect(readOrCreateSalt(userData, logs)).toBe(current);
    expect(existsSync(join(logs, LEGACY_ANON_SALT_FILE))).toBe(false);
  });

  it('hides the home folder and username of the machine it runs on', () => {
    const { anonymiser } = createProcessAnonymiser({ saltDir: userData, logDir: logs });
    const out = anonymiser.apply(`config in ${join(homedir(), 'x', 'y.json')} for ${userInfo().username}`);
    expect(out).not.toContain(homedir());
    expect(out).not.toContain(userInfo().username);
  });

  it('prefers a salt handed down by the parent, and writes nothing when it has no folder of its own', () => {
    const a = createProcessAnonymiser({ logDir: logs, salt: 'parent' }).anonymiser.apply('by bob@box.lan');
    const b = createProcessAnonymiser({ logDir: logs, salt: 'parent' }).anonymiser.apply('by bob@box.lan');
    expect(a).toBe(b);
    expect(readdirSync(logs)).toEqual([]);
    expect(tmpdir()).toBeTruthy();
  });
});
