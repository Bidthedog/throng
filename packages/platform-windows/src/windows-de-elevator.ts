import { join } from 'node:path';
import process from 'node:process';
import type { DeElevateSpec, IDeElevator } from '@throng/core';

/**
 * Windows {@link IDeElevator} (005 Phase G, FR-025c) — the **de-elevated spawn**
 * mechanism for mixed mode. An elevated daemon can't drop a node-pty child's
 * integrity in-process, so `wrap()` rewrites the launch to run through a PowerShell
 * host that executes embedded C#: it grabs the **shell (explorer) token** — a
 * medium-integrity primary token for the interactive user — and
 * `CreateProcessWithTokenW`s the real shell with it, **attached to the inherited
 * ConPTY** (no new console). node-pty spawns that PowerShell host exactly like any
 * shell, so the pty plumbing is unchanged; the interactive shell ends up at medium
 * integrity while the daemon stays elevated.
 *
 * ⚠ Verification: the token/ConPTY interaction can only be exercised on an actually
 * elevated host. Confirm with `npm run test:e2e:admin` (the elevation-gated
 * `terminal-admin-integrity` E2E). If de-elevation fails at runtime the shim writes
 * the error to the terminal and exits non-zero (a surfaced launch failure, FR-019),
 * never a silent fall-through to an elevated shell.
 */
export class WindowsDeElevator implements IDeElevator {
  isAvailable(): boolean {
    // DISABLED pending the agent rework. Verified on an elevated host: the
    // relauncher shim below does NOT attach the CreateProcessWithTokenW child to
    // node-pty's ConPTY (the token swap detaches the console; the shim can't pass
    // the pseudo-console handle node-pty owns internally) → the terminal comes up
    // blank. Returning false makes NodePtyHost fall back to a normal (elevated)
    // spawn — a working terminal, the known pre-mixed-mode limitation — instead of a
    // blank one. The real fix is a medium-integrity node-pty AGENT (it creates its
    // OWN ConPTY at medium integrity); `wrap()` is kept for reference.
    return false;
  }

  wrap(spec: DeElevateSpec): DeElevateSpec {
    const powershell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    // The whole de-elevation script, with the target file + args baked in as
    // PowerShell string literals (single-quote-escaped). Passed via -EncodedCommand
    // so no quoting survives the node-pty → powershell handoff and no temp file is
    // needed.
    const script = buildScript(spec.file, spec.args);
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return {
      file: powershell,
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    };
  }
}

/** Single-quote a value for a PowerShell literal (`'` → `''`). */
function psLit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Build the PowerShell + embedded-C# de-elevation script for `file`/`args`. */
function buildScript(file: string, args: string[]): string {
  const fileLit = psLit(file);
  const argsLit = args.length > 0 ? `@(${args.map(psLit).join(',')})` : '@()';
  // NB: C# is embedded verbatim; keep it self-contained (no external deps).
  return `
$ErrorActionPreference = 'Stop'
$targetFile = ${fileLit}
$targetArgs = ${argsLit}
Add-Type -Namespace Throng -Name DeElev -MemberDefinition @'
[DllImport("user32.dll")] static extern IntPtr GetShellWindow();
[DllImport("user32.dll", SetLastError=true)] static extern int GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
[DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr proc, uint access, out IntPtr token);
[DllImport("advapi32.dll", SetLastError=true)] static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attrs, int impLevel, int tokType, out IntPtr dupToken);
[DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr h);
[DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
[DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
[DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
static extern bool CreateProcessWithTokenW(IntPtr token, uint logonFlags, string appName, string cmdLine, uint creationFlags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

[StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; }
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct STARTUPINFO { public int cb; public string res0; public string desktop; public string title; public int x; public int y; public int xs; public int ys; public int xc; public int yc; public int fill; public int flags; public short showWin; public short res2; public IntPtr res3; public IntPtr stdIn; public IntPtr stdOut; public IntPtr stdErr; }

// Launch "targetFile targetArgs" at the interactive user's (medium) integrity,
// inheriting THIS process's ConPTY console. Returns the child's exit code.
public static int Run(string appName, string cmdLine) {
  IntPtr shell = GetShellWindow();
  if (shell == IntPtr.Zero) throw new Exception("no shell window (session 0?)");
  uint pid; GetWindowThreadProcessId(shell, out pid);
  IntPtr proc = OpenProcess(0x0400 /*QUERY_INFORMATION*/, false, pid);
  if (proc == IntPtr.Zero) throw new Exception("OpenProcess(explorer) failed: " + Marshal.GetLastWin32Error());
  IntPtr token, dup;
  if (!OpenProcessToken(proc, 0x0002 /*DUPLICATE*/, out token)) throw new Exception("OpenProcessToken failed: " + Marshal.GetLastWin32Error());
  // TOKEN_ALL_ACCESS; SecurityImpersonation(2); TokenPrimary(1).
  if (!DuplicateTokenEx(token, 0xF01FF, IntPtr.Zero, 2, 1, out dup)) throw new Exception("DuplicateTokenEx failed: " + Marshal.GetLastWin32Error());
  STARTUPINFO si = new STARTUPINFO(); si.cb = Marshal.SizeOf(si);
  PROCESS_INFORMATION pi;
  // logonFlags=WITH_PROFILE(1); creationFlags=CREATE_UNICODE_ENVIRONMENT(0x400);
  // null env/cwd → inherit ours (node-pty already set cwd = project root); no
  // CREATE_NEW_CONSOLE → the child attaches to our inherited ConPTY.
  if (!CreateProcessWithTokenW(dup, 1, appName, cmdLine, 0x400, IntPtr.Zero, null, ref si, out pi))
    throw new Exception("CreateProcessWithTokenW failed: " + Marshal.GetLastWin32Error());
  WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
  uint code; GetExitCodeProcess(pi.hProcess, out code);
  CloseHandle(pi.hThread); CloseHandle(pi.hProcess); CloseHandle(dup); CloseHandle(token); CloseHandle(proc);
  return (int)code;
}
'@
# Build a properly-quoted command line: "file" "arg1" "arg2" ...
function Quote([string]$s) { if ($s -match '[\\s"]') { '"' + ($s -replace '"','\\"') + '"' } else { $s } }
$cmdLine = (@($targetFile) + $targetArgs | ForEach-Object { Quote $_ }) -join ' '
try {
  exit ([Throng.DeElev]::Run($targetFile, $cmdLine))
} catch {
  [Console]::Error.WriteLine("[throng] de-elevation failed: " + $_.Exception.Message)
  exit 1
}
`.trim();
}
