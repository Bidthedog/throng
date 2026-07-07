import { describe, expect, it } from 'vitest';
import { findOrphans, isThrongOwned, type ProcInfo } from '../../src/reap-orphans.js';

const proc = (over: Partial<ProcInfo> & Pick<ProcInfo, 'pid'>): ProcInfo => ({
  ppid: 1,
  name: 'node.exe',
  createdMs: 1000,
  commandLine: '',
  ...over,
});

describe('isThrongOwned', () => {
  it('matches a --headless conhost, a pty-agent, and a directory-lock holder', () => {
    expect(isThrongOwned(proc({ pid: 2, name: 'conhost.exe', commandLine: 'conhost.exe --headless --width 80' }))).toBe(true);
    expect(isThrongOwned(proc({ pid: 3, commandLine: 'node .../daemon/dist/pty-agent-entry.js \\\\.\\pipe\\x' }))).toBe(true);
    expect(isThrongOwned(proc({ pid: 4, commandLine: 'node -e "process.chdir(process.env.THRONG_LOCK_DIR)..."' }))).toBe(true);
  });

  it('ignores a plain conhost and unrelated processes', () => {
    expect(isThrongOwned(proc({ pid: 5, name: 'conhost.exe', commandLine: 'conhost.exe 0x4' }))).toBe(false);
    expect(isThrongOwned(proc({ pid: 6, commandLine: 'node some-other-script.js' }))).toBe(false);
    expect(isThrongOwned(proc({ pid: 7, name: 'chrome.exe', commandLine: 'chrome --headless' }))).toBe(false);
  });
});

describe('findOrphans', () => {
  const agent = (pid: number, ppid: number, createdMs: number): ProcInfo =>
    proc({ pid, ppid, createdMs, commandLine: 'node pty-agent-entry.js' });

  it('keeps an agent whose live parent started before it', () => {
    const daemon = proc({ pid: 100, ppid: 1, createdMs: 500, commandLine: 'node daemon/dist/main.js' });
    const a = agent(200, 100, 600);
    expect(findOrphans([daemon, a], 999)).toEqual([]);
  });

  it('reaps an agent whose parent is gone', () => {
    const a = agent(200, 100 /* no such pid */, 600);
    expect(findOrphans([a], 999)).toEqual([200]);
  });

  it('reaps an agent whose parent pid was REUSED (impostor started after the child)', () => {
    const impostor = proc({ pid: 100, ppid: 1, createdMs: 900, commandLine: 'node unrelated.js' }); // reused pid 100, newer
    const a = agent(200, 100, 600); // child older than its "parent" → real parent dead
    expect(findOrphans([impostor, a], 999)).toEqual([200]);
  });

  it('never reaps itself and ignores non-throng processes', () => {
    const self = proc({ pid: 42, ppid: 100, commandLine: 'node pty-agent-entry.js' }); // matches, but is selfPid
    const other = proc({ pid: 7, ppid: 100, name: 'explorer.exe', commandLine: 'explorer' });
    expect(findOrphans([self, other], 42)).toEqual([]);
  });

  it('reaps multiple orphans in one pass', () => {
    const c = proc({ pid: 300, ppid: 999, createdMs: 700, name: 'conhost.exe', commandLine: 'conhost --headless' });
    const a = agent(200, 998, 600);
    expect(findOrphans([a, c], 1).sort()).toEqual([200, 300]);
  });
});
