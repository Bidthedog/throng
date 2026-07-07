import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { DetectedShell, IShellDetection, ShellProbe, ShellResolver } from '@throng/core';
import { resolveShellFile } from '@throng/core';

/**
 * Windows concrete `IShellDetection` (005 Phase B; batch-2 FR-024). Resolves each
 * built-in flavour — Windows PowerShell 5.1, PowerShell 7, CMD, Git Bash — through
 * the pure ordered resolver (`resolveShellFile`): **well-known path → PATH →
 * registry**, returning only those that resolve to an existing executable (SC-003,
 * no false positives). This is why a Git install in a non-default/portable location
 * (on PATH or recorded in the Git-for-Windows registry key) is still detected — the
 * defect the old hardcoded-path-only probe caused. Presence-only (never spawns a
 * shell); result cached after the first run. Verified by the shared contract suite.
 */
export class WindowsShellDetection implements IShellDetection {
  private cache: DetectedShell[] | null = null;
  private readonly resolver: ShellResolver;

  constructor(resolver: ShellResolver = defaultResolver) {
    this.resolver = resolver;
  }

  async detectInstalledShells(): Promise<DetectedShell[]> {
    if (this.cache) return this.cache;
    const detected: DetectedShell[] = [];
    for (const candidate of this.candidates()) {
      const file = resolveShellFile(candidate.probes, this.resolver);
      if (file) {
        detected.push({ id: candidate.id, label: candidate.label, file, defaultArgs: candidate.defaultArgs });
      }
    }
    this.cache = detected;
    return detected;
  }

  private candidates(): Array<{ id: string; label: string; defaultArgs: string[]; probes: ShellProbe[] }> {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    const comSpec = process.env.ComSpec;

    return [
      {
        id: 'windows-powershell',
        label: 'Windows PowerShell',
        defaultArgs: [],
        probes: [
          { kind: 'path', value: path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') },
          { kind: 'onPath', exe: 'powershell.exe' },
        ],
      },
      {
        id: 'pwsh',
        label: 'PowerShell 7',
        defaultArgs: [],
        probes: [
          { kind: 'path', value: path.join(programFiles, 'PowerShell', '7', 'pwsh.exe') },
          { kind: 'onPath', exe: 'pwsh.exe' },
        ],
      },
      {
        id: 'cmd',
        label: 'Command Prompt',
        defaultArgs: [],
        probes: [
          ...(comSpec ? [{ kind: 'path', value: comSpec } as ShellProbe] : []),
          { kind: 'path', value: path.join(systemRoot, 'System32', 'cmd.exe') },
          { kind: 'onPath', exe: 'cmd.exe' },
        ],
      },
      {
        id: 'git-bash',
        label: 'Git Bash',
        defaultArgs: [],
        probes: [
          { kind: 'path', value: path.join(programFiles, 'Git', 'bin', 'bash.exe') },
          ...(programFilesX86
            ? [{ kind: 'path', value: path.join(programFilesX86, 'Git', 'bin', 'bash.exe') } as ShellProbe]
            : []),
          // Derive Git Bash from git.exe on PATH — finds portable/non-default installs
          // (e.g. E:\tools\Git) that aren't in Program Files or the registry. MUST come
          // before the generic PATH probe, which would otherwise grab WSL's
          // System32\bash.exe and mislabel it "Git Bash".
          ...this.gitBashFromGitExe(),
          // Git for Windows records its install root here; bash.exe lives under bin\.
          { kind: 'registry', key: 'HKLM\\SOFTWARE\\GitForWindows', append: 'bin\\bash.exe' },
          { kind: 'registry', key: 'HKCU\\SOFTWARE\\GitForWindows', append: 'bin\\bash.exe' },
          { kind: 'registry', key: 'HKLM\\SOFTWARE\\WOW6432Node\\GitForWindows', append: 'bin\\bash.exe' },
          // Last resort: a bash.exe on PATH. Reached only when no real Git tree was
          // found above (so on a Git install it never mislabels WSL's System32\bash.exe).
          { kind: 'onPath', exe: 'bash.exe' },
        ],
      },
    ];
  }

  /**
   * Candidate Git Bash paths derived from `git.exe` on PATH: git.exe lives under a
   * Git install's `cmd\`, `mingw64\bin\` or `bin\`, and the Git Bash launcher is at
   * `<root>\bin\bash.exe`, so we walk up from git.exe's directory and probe each
   * ancestor's `bin\bash.exe`. This is what makes a portable Git (no registry key,
   * outside Program Files) resolve — and, being a real Git tree, it is NOT WSL's
   * `System32\bash.exe`.
   */
  private gitBashFromGitExe(): ShellProbe[] {
    const gitExe = this.resolver.onPath('git.exe');
    if (!gitExe) return [];
    const probes: ShellProbe[] = [];
    const seen = new Set<string>();
    let dir = path.dirname(gitExe);
    for (let i = 0; i < 4; i += 1) {
      const candidate = path.join(dir, 'bin', 'bash.exe');
      if (!seen.has(candidate)) {
        seen.add(candidate);
        probes.push({ kind: 'path', value: candidate });
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return probes;
  }
}

/** The real Windows resolver: fs existence, PATH lookup, `reg query`, and path.join. */
const defaultResolver: ShellResolver = {
  exists: (absPath) => existsSync(absPath),
  onPath: (exe) => {
    const dirs = (process.env.PATH ?? '').split(path.delimiter).filter((d) => d.length > 0);
    for (const dir of dirs) {
      const candidate = path.join(dir, exe);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  },
  readRegistry: (key) => readRegistryInstallPath(key),
  join: (dir, sub) => path.join(dir, sub),
};

/**
 * Read the `InstallPath` (default) value of a registry key via `reg query`. Returns
 * the directory string, or null if the key/value is absent or the query fails.
 * Presence-only and side-effect-free; failures are swallowed (a missing key is the
 * normal "not installed via this key" case, not an error).
 */
function readRegistryInstallPath(key: string): string | null {
  for (const valueName of ['InstallPath', 'InstallLocation']) {
    try {
      const out = execFileSync('reg', ['query', key, '/v', valueName], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      // A matching line looks like: "    InstallPath    REG_SZ    C:\Program Files\Git"
      const match = out.split(/\r?\n/).find((line) => line.includes(valueName));
      if (match) {
        const parts = match.trim().split(/\s{2,}|\t+/);
        const value = parts[parts.length - 1]?.trim();
        if (value && value !== valueName) return value;
      }
    } catch {
      /* key/value absent or reg unavailable → try the next value name */
    }
  }
  return null;
}
