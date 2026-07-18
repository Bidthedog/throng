import { spawn } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Launches a process **de-elevated** (at the interactive user's medium integrity)
 * from an elevated daemon — used to start the medium PTY agent (FR-025c). Unlike the
 * failed relauncher shim, this launch needs NO console: the agent talks to the daemon
 * over a named pipe, so `CreateProcessWithTokenW` with the shell (explorer) token +
 * `CREATE_NO_WINDOW` is exactly the right, well-trodden RunAs-style mechanism (the
 * shim only failed because a ConPTY can't cross the token boundary — a background
 * process has no such requirement). Fire-and-forget: the shim launches and exits; the
 * agent connects back on its own.
 */
export class WindowsDeElevatedLauncher {
  isAvailable(): boolean {
    return process.platform === 'win32';
  }

  /**
   * Start `file args...` at medium integrity (no window, detached from our console).
   *
   * Fire-and-forget in **lifetime** — it returns immediately and never waits on the shim —
   * but no longer in **failure**: the shim's stderr is captured and handed to `report` on a
   * non-zero exit (019 FR-015). The shim throws precise, actionable messages
   * (`CreateProcessWithTokenW failed: <win32 error>`); before this they went to `/dev/null`,
   * so a failed de-elevated launch was indistinguishable from a slow one and the panel hung
   * forever with no prompt and no error (#94).
   */
  launch(file: string, args: string[], report?: (reason: string) => void): void {
    const powershell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    // Hand the de-elevated process a REAL working directory rather than NULL. A NULL
    // lpCurrentDirectory to CreateProcessWithTokenW leaves the child's cwd undefined,
    // which can break module/asset resolution for the launched node/agent.
    //
    // It MUST be a directory the child's token can actually read. We are the ELEVATED
    // daemon, so OUR `USERPROFILE` is the ADMIN account's profile (e.g. C:\Users\Admin) —
    // but the child runs under the INTERACTIVE user's borrowed shell token, which under
    // split-token / different-admin-account elevation cannot access that admin profile.
    // Passing it would make CreateProcessWithTokenW FAIL on an inaccessible cwd where NULL
    // previously succeeded. The Windows directory is readable by ANY token at any integrity
    // level, so it is the universal-access, always-valid choice; the agent's own script path
    // and pipe name are absolute, so cwd never affects its module resolution.
    const cwd = process.env.SystemRoot ?? 'C:\\Windows';
    const script = buildLaunchScript(file, args, cwd);
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      // stdout stays ignored — the agent's own output belongs on the pipe, not here.
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    // Unref'd like the child: the reason is observed if it arrives, but a shim that
    // outlives us must never hold the daemon's event loop open. (A piped stderr is a
    // net.Socket at runtime; the published type is the narrower Readable.)
    (child.stderr as unknown as { unref?(): void } | null)?.unref?.();
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error: Error) => report?.(error.message));
    child.on('exit', (code) => {
      if (code !== 0) report?.(stderr.trim() || `exit ${code}`);
    });
    child.unref();
  }
}

function psLit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildLaunchScript(file: string, args: string[], cwd: string): string {
  const fileLit = psLit(file);
  const argsLit = args.length > 0 ? `@(${args.map(psLit).join(',')})` : '@()';
  const cwdLit = psLit(cwd);
  return `
$ErrorActionPreference = 'Stop'
$targetFile = ${fileLit}
$targetArgs = ${argsLit}
$targetCwd = ${cwdLit}
Add-Type -Namespace Throng -Name DeElevLaunch -MemberDefinition @'
[DllImport("user32.dll")] static extern IntPtr GetShellWindow();
[DllImport("user32.dll", SetLastError=true)] static extern int GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
[DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr proc, uint access, out IntPtr token);
[DllImport("advapi32.dll", SetLastError=true)] static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attrs, int impLevel, int tokType, out IntPtr dupToken);
[DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr h);
[DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
static extern bool CreateProcessWithTokenW(IntPtr token, uint logonFlags, string appName, string cmdLine, uint creationFlags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
[StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; }
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct STARTUPINFO { public int cb; public string res0; public string desktop; public string title; public int x; public int y; public int xs; public int ys; public int xc; public int yc; public int fill; public int flags; public short showWin; public short res2; public IntPtr res3; public IntPtr stdIn; public IntPtr stdOut; public IntPtr stdErr; }
public static void Run(string appName, string cmdLine, string cwd) {
  IntPtr shell = GetShellWindow();
  if (shell == IntPtr.Zero) throw new Exception("no shell window");
  uint pid; GetWindowThreadProcessId(shell, out pid);
  IntPtr proc = OpenProcess(0x0400, false, pid);
  if (proc == IntPtr.Zero) throw new Exception("OpenProcess failed: " + Marshal.GetLastWin32Error());
  IntPtr token, dup;
  if (!OpenProcessToken(proc, 0x0002, out token)) throw new Exception("OpenProcessToken failed: " + Marshal.GetLastWin32Error());
  if (!DuplicateTokenEx(token, 0xF01FF, IntPtr.Zero, 2, 1, out dup)) throw new Exception("DuplicateTokenEx failed: " + Marshal.GetLastWin32Error());
  STARTUPINFO si = new STARTUPINFO(); si.cb = Marshal.SizeOf(si);
  PROCESS_INFORMATION pi;
  // logonFlags=WITH_PROFILE(1); creationFlags=CREATE_NO_WINDOW(0x08000000)|CREATE_UNICODE_ENVIRONMENT(0x400).
  // cwd is a real directory (the Windows dir — readable by the borrowed medium token at any
  // integrity level) rather than NULL, so the launched agent has a defined working directory
  // for module/asset resolution without depending on a profile the child's token can't reach.
  if (!CreateProcessWithTokenW(dup, 1, appName, cmdLine, 0x08000400, IntPtr.Zero, cwd, ref si, out pi))
    throw new Exception("CreateProcessWithTokenW failed: " + Marshal.GetLastWin32Error());
  CloseHandle(pi.hThread); CloseHandle(pi.hProcess); CloseHandle(dup); CloseHandle(token); CloseHandle(proc);
}
'@
function Quote([string]$s) { if ($s -match '[\\s"]') { '"' + ($s -replace '"','\\"') + '"' } else { $s } }
$cmdLine = (@($targetFile) + $targetArgs | ForEach-Object { Quote $_ }) -join ' '
[Throng.DeElevLaunch]::Run($targetFile, $cmdLine, $targetCwd)
`.trim();
}
