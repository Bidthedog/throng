import { execFile, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, parse } from 'node:path';
import process from 'node:process';
import type { IOrphanProcesses, ITrashRestore, IUserDirectories, IVolumeRoots, OrphanCandidate } from '@throng/core';

/** The folders Windows has always used (003 D1, 020). */
export class WindowsUserDirectories implements IUserDirectories {
  configRoot(devMode: boolean): string {
    return join(homedir(), devMode ? '.throng-dev' : '.throng');
  }

  dataDir(devMode: boolean): string {
    const base = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(base, devMode ? 'throng-dev' : 'throng');
  }

  prepare(_dir: string): void {
    // Windows profile folders are already private to their owner.
  }
}

/**
 * The Recycle Bin restore, which is PowerShell (024 US3). Injected because its implementation lives in UI main, beside
 * the script and its history, so this class is only the seam's shape on Windows.
 */
export class WindowsTrashRestore implements ITrashRestore {
  constructor(private readonly restoreItem: (originalPath: string) => Promise<void>) {}

  restore(originalPath: string, _deletedAt: number): Promise<void> {
    return this.restoreItem(originalPath);
  }
}

/** `C:\` or `\\server\share\`, case folded, and network when it is a UNC root (045 FR-121). */
export class WindowsVolumeRoots implements IVolumeRoots {
  rootOf(path: string): string {
    return parse(path).root.toLowerCase();
  }

  isNetwork(root: string): boolean {
    return /^[\\/]{2}/.test(root);
  }
}

/** Every process via CIM, and `taskkill /T` to end one (the daemon's startup sweep since 005). */
export class WindowsOrphanProcesses implements IOrphanProcesses {
  snapshot(): Promise<OrphanCandidate[]> {
    return new Promise((resolve, reject) => {
      const script =
        // Pipe-delimited; command line last (its own '|' stripped) so a 5-field split is safe.
        "Get-CimInstance Win32_Process | ForEach-Object { " +
        "'{0}|{1}|{2}|{3}|{4}' -f $_.ProcessId, $_.ParentProcessId, $_.Name, " +
        '([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds(), ' +
        "(($_.CommandLine -replace '\\|',' ') -replace '[\\r\\n]',' ') }";
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      const timer = setTimeout(() => child.kill(), 15_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => (out += chunk));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(parseCimRows(out));
        else reject(new Error(`process snapshot exited ${code}`));
      });
    });
  }

  kill(pid: number): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, (error) =>
        resolve(!error),
      );
    });
  }
}

function parseCimRows(out: string): OrphanCandidate[] {
  const procs: OrphanCandidate[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length < 4) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    const createdMs = Number(parts[3]);
    if (!Number.isFinite(pid)) continue;
    procs.push({
      pid,
      ppid: Number.isFinite(ppid) ? ppid : -1,
      name: parts[2] ?? '',
      createdMs: Number.isFinite(createdMs) ? createdMs : 0,
      commandLine: parts.slice(4).join('|'),
    });
  }
  return procs;
}
