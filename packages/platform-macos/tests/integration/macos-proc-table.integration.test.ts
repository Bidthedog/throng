/**
 * Layer: integration — the struct layouts and the koffi binding are only right if the real kernel agrees: a wrong
 * offset reads garbage that no fake can show (070 research R2). `ps` on the runner is the independent witness.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skipUnlessMacos } from '@throng/core/testing';
import { PROC_BSDINFO, PROC_PIDTASKINFO, PROC_PIDTBSDINFO, PROC_PIDVNODEPATHINFO, PROC_TASKINFO, PROC_VNODEPATHINFO, libSystem } from '../../src/libsystem.js';
import {
  readMacosArgv,
  readMacosCwd,
  readMacosExecutablePath,
  readMacosMetrics,
  readMacosProcRow,
  readMacosProcTable,
} from '../../src/macos-proc-table.js';

const ps = (pid: number, field: string): string => execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' }).trim();

describe.skipIf(skipUnlessMacos('libproc and sysctl(KERN_PROCARGS2) exist only on macOS'))('the macOS process table on a real Mac', () => {
  let dir = '';
  let parent: ChildProcess;
  let childPid = 0;

  beforeAll(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'throng-proc-')));
    // A shell that starts a sleep, so the tree has a known parent and child.
    parent = spawn('/bin/sh', ['-c', 'sleep 60 & echo $!; wait'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
    childPid = await new Promise<number>((resolve) => parent.stdout!.once('data', (d: Buffer) => resolve(Number(String(d).trim()))));
    // `$!` names the forked shell before it has become `sleep`: wait for the exec, or the facts read are the shell's
    // (`bash`, once on a hosted Mac, 070). Bounded, so a child that never execs fails here, saying so.
    const until = Date.now() + 5000;
    while (ps(childPid, 'comm').split('/').pop() !== 'sleep') {
      if (Date.now() > until) throw new Error(`${childPid} never became sleep`);
      await new Promise((r) => setTimeout(r, 20)); // sleep-justified: a poll of the process table, bounded above
    }
  });

  afterAll(() => {
    try {
      process.kill(childPid, 'SIGKILL');
    } catch {
      // Already gone.
    }
    parent.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  });

  it('gets the size it declares back from every proc_pidinfo flavour it reads', () => {
    const lib = libSystem()!;
    expect(lib).not.toBeNull();
    const pid = parent.pid!;
    expect(lib.procPidInfo(pid, PROC_PIDTBSDINFO, 0, Buffer.alloc(PROC_BSDINFO.size))).toBe(PROC_BSDINFO.size);
    expect(lib.procPidInfo(pid, PROC_PIDTASKINFO, 0, Buffer.alloc(PROC_TASKINFO.size))).toBe(PROC_TASKINFO.size);
    expect(lib.procPidInfo(pid, PROC_PIDVNODEPATHINFO, 0, Buffer.alloc(PROC_VNODEPATHINFO.size))).toBe(PROC_VNODEPATHINFO.size);
  });

  it('agrees with ps on ppid, uid and name', () => {
    const row = readMacosProcRow(childPid)!;
    expect(row.ppid).toBe(Number(ps(childPid, 'ppid')));
    expect(row.ppid).toBe(parent.pid);
    expect(row.uid).toBe(Number(ps(childPid, 'uid')));
    expect(row.comm).toBe('sleep');
  });

  it('agrees with ps on the start time, to the second', () => {
    const row = readMacosProcRow(childPid)!;
    const psStart = Date.parse(ps(childPid, 'lstart'));
    expect(Math.abs(row.startedAt - psStart)).toBeLessThan(1000);
    expect(readMacosProcRow(childPid)!.startedAt).toBe(row.startedAt);
  });

  it('reads argv, the executable and the cwd', () => {
    expect(readMacosArgv(childPid)).toEqual(['sleep', '60']);
    expect(readMacosExecutablePath(childPid)).toBe('/bin/sleep');
    expect(readMacosCwd(childPid)).toBe(dir);
  });

  it('lists both in the whole table, and figures for the parent', async () => {
    const pids = (await readMacosProcTable()).map((r) => r.pid);
    expect(pids).toEqual(expect.arrayContaining([parent.pid, childPid, process.pid]));
    const metrics = readMacosMetrics(process.pid)!;
    expect(metrics.cpuMs).toBeGreaterThan(0);
    expect(metrics.privateBytes).toBeGreaterThan(0);
    expect(metrics.residentBytes).toBeGreaterThan(0);
  });

  it('is absent for a pid that has gone', () => {
    const gone = spawn('/usr/bin/true');
    return new Promise<void>((resolve) => {
      gone.once('exit', () => {
        setTimeout(() => {
          expect(readMacosProcRow(gone.pid!)).toBeNull();
          resolve();
        }, 50);
      });
    });
  });
});
