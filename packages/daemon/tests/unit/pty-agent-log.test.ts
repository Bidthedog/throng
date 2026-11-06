import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionFileName } from '@throng/core';
import { APPDATA_LOG_DIR_PREFIX, encodeAgentLogDir, openAgentLog } from '../../src/pty-agent-log.js';

/**
 * 066 FR-017 / contract *PTY agent* — the de-elevated agent is launched with NO environment
 * (`CreateProcessWithTokenW`, env NULL), so it cannot inherit `THRONG_LOG_DIR` and used to land in the
 * desktop user's `%TEMP%`. Its log folder now arrives as its second argument: `appdata:<rel>` resolved
 * against the agent's own `APPDATA` (so a different user writes to their own throng folder), or an
 * absolute path used as is. Never `tmpdir()`.
 */

const dirs: string[] = [];
const logs: Array<{ close(): void }> = [];

afterEach(() => {
  for (const log of logs.splice(0)) log.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-agentlog-'));
  dirs.push(dir);
  return dir;
}

const STARTED = new Date(2026, 10, 6, 9, 30, 15);
const PID = 4321;
const FILE = sessionFileName('pty-agent', STARTED, PID);

function open(arg: string | undefined, env: NodeJS.ProcessEnv): ReturnType<typeof openAgentLog> {
  const log = openAgentLog({ arg, env, pid: PID, startedAt: STARTED });
  if (log) logs.push(log);
  return log;
}

describe('openAgentLog', () => {
  it('resolves an appdata: argument against the agent’s own APPDATA', () => {
    const appData = scratch();
    const log = open(`${APPDATA_LOG_DIR_PREFIX}${join('throng', 'logs')}`, { APPDATA: appData });
    expect(log?.path).toBe(join(appData, 'throng', 'logs', FILE));
    log?.info('agent start');
    expect(readFileSync(log?.path ?? '', 'utf8')).toContain('agent start');
  });

  it('uses an absolute argument as is', () => {
    const dir = scratch();
    expect(open(dir, { APPDATA: scratch(), THRONG_LOG_DIR: scratch() })?.path).toBe(join(dir, FILE));
  });

  it('falls back to THRONG_LOG_DIR with no argument', () => {
    const dir = scratch();
    expect(open(undefined, { THRONG_LOG_DIR: dir })?.path).toBe(join(dir, FILE));
  });

  it('never falls back to the temp folder', () => {
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith('pty-agent-'));
    expect(open(undefined, {})).toBeNull();
    // An appdata: argument with no APPDATA to resolve it against cannot be honoured either.
    expect(open(`${APPDATA_LOG_DIR_PREFIX}throng`, {})).toBeNull();
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith('pty-agent-'))).toEqual(before);
  });

  it('records under the pty-agent component at the configured level', () => {
    const dir = scratch();
    const log = open(dir, { THRONG_LOG_LEVEL: 'warn' });
    log?.info('below the threshold');
    log?.warn('at the threshold');
    const text = readFileSync(log?.path ?? '', 'utf8');
    expect(text).not.toContain('below the threshold');
    expect(text).toContain('at the threshold');
    expect(text).toContain('pty-agent');
  });

  it('rolls over at the configured size', () => {
    const dir = scratch();
    const log = open(dir, { THRONG_LOG_MAX_KB: '1' });
    for (let i = 0; i < 40; i += 1) log?.info(`line ${i} ${'x'.repeat(60)}`);
    expect(existsSync(join(dir, FILE.replace(/\.log$/, '.1.log')))).toBe(true);
  });
});

describe('encodeAgentLogDir', () => {
  it('encodes a folder under APPDATA as appdata:<relative path>', () => {
    const appData = scratch();
    expect(encodeAgentLogDir(join(appData, 'throng', 'logs'), appData)).toBe(
      `${APPDATA_LOG_DIR_PREFIX}${join('throng', 'logs')}`,
    );
  });

  it('passes any other folder through as an absolute path', () => {
    const dir = scratch();
    expect(encodeAgentLogDir(dir, join(dir, 'elsewhere'))).toBe(dir);
    expect(encodeAgentLogDir(dir, undefined)).toBe(dir);
  });

  it('round-trips through openAgentLog', () => {
    const appData = scratch();
    const arg = encodeAgentLogDir(join(appData, 'throng', 'logs'), appData);
    expect(open(arg, { APPDATA: appData })?.path).toBe(join(appData, 'throng', 'logs', FILE));
  });
});
