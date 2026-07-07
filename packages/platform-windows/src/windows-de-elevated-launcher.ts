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

  /** Start `file args...` at medium integrity (no window, detached from our console). */
  launch(file: string, args: string[]): void {
    const powershell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const script = buildLaunchScript(file, args);
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  }
}

function psLit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildLaunchScript(file: string, args: string[]): string {
  const fileLit = psLit(file);
  const argsLit = args.length > 0 ? `@(${args.map(psLit).join(',')})` : '@()';
  return `
$ErrorActionPreference = 'Stop'
$targetFile = ${fileLit}
$targetArgs = ${argsLit}
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
public static void Run(string appName, string cmdLine) {
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
  if (!CreateProcessWithTokenW(dup, 1, appName, cmdLine, 0x08000400, IntPtr.Zero, null, ref si, out pi))
    throw new Exception("CreateProcessWithTokenW failed: " + Marshal.GetLastWin32Error());
  CloseHandle(pi.hThread); CloseHandle(pi.hProcess); CloseHandle(dup); CloseHandle(token); CloseHandle(proc);
}
'@
function Quote([string]$s) { if ($s -match '[\\s"]') { '"' + ($s -replace '"','\\"') + '"' } else { $s } }
$cmdLine = (@($targetFile) + $targetArgs | ForEach-Object { Quote $_ }) -join ' '
[Throng.DeElevLaunch]::Run($targetFile, $cmdLine)
`.trim();
}
