/**
 * 031 T035 (#227, FR-013b / W3) — the daemon reads settings, corrects them, and writes NOTHING.
 *
 * The guard has to run in every process: a `commandPollMs` of 1 hand-typed into settings.json
 * would otherwise have the daemon observing every terminal a thousand times a second while the UI
 * ran on the corrected value, and nothing would say why the machine got hot.
 *
 * Write-back is the opposite — it belongs to exactly ONE process. UI-main owns the file; a daemon
 * that also wrote it would give a single document two concurrent writers across a process
 * boundary, which is precisely how a config file ends up truncated. So the assertion here is in
 * two halves, and the second half is the important one: the value is corrected, and the file is
 * byte-for-byte and timestamp-for-timestamp untouched.
 *
 * Integration rather than unit because it is about a real file on a real disk, read through the
 * daemon's own function rather than a re-implementation of it.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { readCommandPollMs } from '../../src/composition-root.js';

const roots: string[] = [];
function seed(settings: unknown): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'throng-daemon-cfg-'));
  roots.push(root);
  const path = join(root, 'settings.json');
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return { root, path };
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function withPoll(commandPollMs: unknown): Record<string, unknown> {
  const doc = structuredClone(DEFAULT_APP_SETTINGS) as unknown as Record<string, unknown>;
  (doc.terminals as Record<string, unknown>).commandPollMs = commandPollMs;
  return doc;
}

describe('the daemon corrects the poll interval in memory (FR-013b)', () => {
  it('clamps a hand-typed value below the declared minimum', () => {
    const { root } = seed(withPoll(1));
    expect(readCommandPollMs({ THRONG_CONFIG_ROOT: root })).toBe(250);
  });

  it('clamps a hand-typed value above the declared maximum', () => {
    const { root } = seed(withPoll(99_999));
    expect(readCommandPollMs({ THRONG_CONFIG_ROOT: root })).toBe(5000);
  });

  it('reads an in-range value unchanged', () => {
    const { root } = seed(withPoll(2000));
    expect(readCommandPollMs({ THRONG_CONFIG_ROOT: root })).toBe(2000);
  });

  it('falls back to the shipped default when the file is missing or unreadable', () => {
    const { root } = seed('not an object at all');
    expect(readCommandPollMs({ THRONG_CONFIG_ROOT: root })).toBe(
      DEFAULT_APP_SETTINGS.terminals.commandPollMs,
    );
    expect(readCommandPollMs({ THRONG_CONFIG_ROOT: join(root, 'nowhere') })).toBe(
      DEFAULT_APP_SETTINGS.terminals.commandPollMs,
    );
  });
});

describe('…and never writes the file back (W3 — exactly one writer)', () => {
  it('leaves the bytes and the modification time untouched after a correcting read', () => {
    const { root, path } = seed(withPoll(99_999));
    const before = { bytes: readFileSync(path, 'utf8'), mtime: statSync(path).mtimeMs };

    expect(readCommandPollMs({ THRONG_CONFIG_ROOT: root })).toBe(5000);

    expect(readFileSync(path, 'utf8')).toBe(before.bytes);
    expect(statSync(path).mtimeMs).toBe(before.mtime);
    // The out-of-range value is still on disk: correcting it is UI-main's job, not the daemon's.
    expect(JSON.parse(readFileSync(path, 'utf8')).terminals.commandPollMs).toBe(99_999);
  });
});
