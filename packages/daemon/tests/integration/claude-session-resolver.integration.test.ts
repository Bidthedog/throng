import { skipUnlessLinux } from '@throng/core/testing';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClaudeSessionProcess, IProcessIdentity } from '@throng/core';
import { ClaudeSessionResolver } from '../../src/claude-session-resolver.js';

/**
 * 068 FR-043, FR-044, FR-046, FR-049 — the resolver reads Claude Code's own session record for a
 * running process.
 *
 * Layer: integration — the claim is about a real process: its argv and start time come from the
 * operating system and must agree with a record file on disk, which no fake can stand in for. The
 * Windows argv path (command line split) is one case on a fake identity, since it needs no OS.
 */

const SESSION = '11111111-2222-3333-4444-555555555555';
const NEXT_SESSION = '99999999-2222-3333-4444-555555555555';

let configDir: string;
let child: ChildProcess;
const opened: string[] = [];

/** The kernel's own start marker for a pid (field 22 of /proc/<pid>/stat), read independently. */
function procStartOf(pid: number): string {
  const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
  return text.slice(text.lastIndexOf(')') + 2).split(' ')[19] as string;
}

function writeRecord(pid: number, body: unknown): void {
  mkdirSync(join(configDir, 'sessions'), { recursive: true });
  writeFileSync(join(configDir, 'sessions', `${pid}.json`), typeof body === 'string' ? body : JSON.stringify(body));
}

function claudeProc(pid: number, startedAt = 1): ClaudeSessionProcess {
  return { pid, startedAt, commandLine: 'claude --model opus' };
}

const trackingRead = async (path: string): Promise<string> => {
  opened.push(path);
  return readFile(path, 'utf8');
};

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'throng-claude-cfg-'));
  opened.length = 0;
});

afterEach(() => {
  child?.kill('SIGKILL');
  rmSync(configDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function startChild(): number {
  // argv0 `claude` makes /proc/<pid>/cmdline read as Claude Code's would.
  child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', '--model', 'opus'], {
    argv0: 'claude',
    stdio: 'ignore',
  });
  return child.pid as number;
}

async function linuxResolver(timeoutMs = 2000): Promise<ClaudeSessionResolver> {
  const { LinuxProcessIdentity } = await import('@throng/platform-linux');
  return new ClaudeSessionResolver({
    configDir,
    os: 'linux',
    identity: new LinuxProcessIdentity(),
    readFile: trackingRead,
    timeoutMs,
  });
}

describe.skipIf(skipUnlessLinux('reads real /proc argv and start times'))('ClaudeSessionResolver on a real process', () => {

  it('returns the record session id and the process argv when pid and procStart match', async () => {
    const pid = startChild();
    writeRecord(pid, { pid, sessionId: SESSION, procStart: procStartOf(pid), name: 'ignored' });
    const resolver = await linuxResolver();

    const result = await resolver.resolve(claudeProc(pid), []);

    expect(result).toMatchObject({ sessionId: SESSION });
    expect('argv' in result && result.argv).toEqual(expect.arrayContaining(['--model', 'opus']));
    expect('argv' in result && result.argv[0]).toBe('claude');
  });

  it('is no-record when there is no file, mismatch when procStart disagrees, unreadable when malformed', async () => {
    const pid = startChild();
    const resolver = await linuxResolver();
    expect(await resolver.resolve(claudeProc(pid), [])).toEqual({ none: 'no-record' });

    writeRecord(pid, { pid, sessionId: SESSION, procStart: '1' });
    expect(await resolver.resolve(claudeProc(pid), [])).toEqual({ none: 'mismatch' });

    writeRecord(pid, '{not json');
    expect(await resolver.resolve(claudeProc(pid), [])).toEqual({ none: 'unreadable' });

    writeRecord(pid, { pid, sessionId: 'not a uuid; rm -rf', procStart: procStartOf(pid) });
    expect(await resolver.resolve(claudeProc(pid), [])).toEqual({ none: 'unreadable' });
  });

  it('is not-claude for a process that is not Claude Code, without reading anything', async () => {
    const pid = startChild();
    writeRecord(pid, { pid, sessionId: SESSION, procStart: procStartOf(pid) });
    const resolver = await linuxResolver();

    const result = await resolver.resolve({ pid, startedAt: 1, commandLine: 'codex --full-auto' }, []);

    expect(result).toEqual({ none: 'not-claude' });
    expect(opened).toEqual([]);
  });

  it('never opens a .key file, only sessions/<pid>.json', async () => {
    const pid = startChild();
    writeRecord(pid, { pid, sessionId: SESSION, procStart: procStartOf(pid) });
    writeFileSync(join(configDir, 'sessions', `${pid}.abc123.key`), 'secret');
    const resolver = await linuxResolver();

    await resolver.resolve(claudeProc(pid), []);

    expect(opened).toEqual([join(configDir, 'sessions', `${pid}.json`)]);
  });

  it('picks up a record rewritten under the same pid, while identity is cached by pid and start time', async () => {
    const pid = startChild();
    const start = procStartOf(pid);
    writeRecord(pid, { pid, sessionId: SESSION, procStart: start });
    let identityReads = 0;
    const { LinuxProcessIdentity } = await import('@throng/platform-linux');
    const real = new LinuxProcessIdentity();
    const counting: IProcessIdentity = {
      argv: (p) => (identityReads++, real.argv(p)),
      startMarker: (p) => (identityReads++, real.startMarker(p)),
    };
    const resolver = new ClaudeSessionResolver({ configDir, os: 'linux', identity: counting, timeoutMs: 2000 });

    expect(await resolver.resolve(claudeProc(pid, 5), [])).toMatchObject({ sessionId: SESSION });
    const readsAfterFirst = identityReads;
    writeRecord(pid, { pid, sessionId: NEXT_SESSION, procStart: start });
    expect(await resolver.resolve(claudeProc(pid, 5), [])).toMatchObject({ sessionId: NEXT_SESSION });

    expect(identityReads).toBe(readsAfterFirst);
  });

  it('finds Claude among the descendants when the foreground process is a launcher', async () => {
    const pid = startChild();
    writeRecord(pid, { pid, sessionId: SESSION, procStart: procStartOf(pid) });
    const resolver = await linuxResolver();

    const result = await resolver.resolve({ pid: 1, startedAt: 1, commandLine: 'node launcher.js' }, [claudeProc(pid)]);

    expect(result).toMatchObject({ sessionId: SESSION });
  });
});

describe('ClaudeSessionResolver without a real process', () => {
  it('answers timeout when a read outlasts the bound', async () => {
    const hung: IProcessIdentity = { argv: () => new Promise(() => undefined), startMarker: () => new Promise(() => undefined) };
    const resolver = new ClaudeSessionResolver({ configDir: tmpdir(), os: 'linux', identity: hung, timeoutMs: 50 });

    expect(await resolver.resolve(claudeProc(42), [])).toEqual({ none: 'timeout' });
  });

  it('on Windows splits the command line for argv and compares the record startedAt with the process table start', async () => {
    const identity: IProcessIdentity = { argv: async () => undefined, startMarker: async () => undefined };
    const resolver = new ClaudeSessionResolver({ configDir, os: 'windows', identity, timeoutMs: 2000 });
    writeRecord(7, { pid: 7, sessionId: SESSION, procStart: '5555945', startedAt: 1_700_000_000_500 });

    const result = await resolver.resolve(
      { pid: 7, startedAt: 1_700_000_000_000 + 400, commandLine: '"C:\\Program Files\\claude.exe" --add-dir "C:\\My Dir"' },
      [],
    );

    expect(result).toEqual({
      sessionId: SESSION,
      argv: ['C:\\Program Files\\claude.exe', '--add-dir', 'C:\\My Dir'],
    });
  });

  it('on Windows needs no procStart, only the record startedAt; on Linux procStart is required', async () => {
    const windows = new ClaudeSessionResolver({
      configDir,
      os: 'windows',
      identity: { argv: async () => undefined, startMarker: async () => undefined },
      timeoutMs: 2000,
    });
    writeRecord(8, { pid: 8, sessionId: SESSION, startedAt: 1_700_000_000_000 });
    expect(await windows.resolve({ pid: 8, startedAt: 1_700_000_000_100, commandLine: 'claude' }, [])).toMatchObject({ sessionId: SESSION });

    const linux = new ClaudeSessionResolver({
      configDir,
      os: 'linux',
      identity: { argv: async () => ['claude'], startMarker: async () => '5555' },
      timeoutMs: 2000,
    });
    expect(await linux.resolve({ pid: 8, startedAt: 1_700_000_000_100, commandLine: 'claude' }, [])).toEqual({ none: 'unreadable' });
  });

  it('keeps its identity cache bounded however many processes it sees', async () => {
    const identity: IProcessIdentity = { argv: async () => ['claude'], startMarker: async () => '1' };
    const resolver = new ClaudeSessionResolver({ configDir, os: 'linux', identity, timeoutMs: 2000 });

    for (let pid = 1000; pid < 1600; pid += 1) await resolver.resolve(claudeProc(pid, pid), []);

    expect(resolver.cachedIdentityCount).toBeLessThanOrEqual(256);
  });

  it('on Windows refuses a stale record whose pid was reused by a process that started at another time', async () => {
    const identity: IProcessIdentity = { argv: async () => undefined, startMarker: async () => undefined };
    const resolver = new ClaudeSessionResolver({ configDir, os: 'windows', identity, timeoutMs: 2000 });
    writeRecord(7, { pid: 7, sessionId: SESSION, procStart: '5555945', startedAt: 1_700_000_000_000 });

    const result = await resolver.resolve({ pid: 7, startedAt: 1_700_000_000_000 + 60_000, commandLine: 'claude' }, []);

    expect(result).toEqual({ none: 'mismatch' });
  });
});
