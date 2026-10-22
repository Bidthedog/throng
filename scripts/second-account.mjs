// A genuine second, standard (non-administrator) account for the verification matrix (058 FR-029,
// research D11).
//
// The hosted runner's default account is an administrator with UAC disabled, so there is no
// filtered token to drop to and "works for a standard user" cannot be inferred from it. This makes
// a real one: a local account with a random password, used for exactly the steps that need it, and
// removed in a `finally` along with its profile. A run that cannot create it is a FAILED step with
// the reason, never an unproven one — creating a local account is within an administrator's rights
// on the runner, so being unable to is a defect (contracts/verification-matrix.md).
//
// `run` is injected (`(command, args, options) => Promise<{code, stdout, stderr}>`) so the
// create/use/delete sequence is unit-tested without touching a machine; `systemRunner` is the real
// one.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/** A password that satisfies Windows' complexity rule by construction, and is never reused. */
export function randomPassword() {
  return `Tg1!${randomBytes(15).toString('base64url')}`;
}

/** At most 20 characters (the SAM account-name limit), and distinguishable as ours. */
export function randomAccountName() {
  return `tv${randomBytes(4).toString('hex')}`;
}

export class SecondAccountError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SecondAccountError';
  }
}

/** The real runner: spawn, capture, bound. */
export function systemRunner(command, args, { timeoutMs = 120000, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, env: env ?? process.env });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // When time is up, stop the whole tree AND answer: `close` only fires once every pipe is closed,
    // and a grandchild (an installer, a daemon) that inherited them keeps them open after its parent
    // is killed — so waiting for `close` after a timeout waited forever.
    const timer = setTimeout(() => {
      try {
        execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', timeout: 15000 });
      } catch {
        child.kill();
      }
      settle({ code: -1, stdout, stderr: `${stderr}[timed out after ${timeoutMs} ms]` });
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => settle({ code: -1, stdout, stderr: `${stderr}${err.message}` }));
    child.on('close', (code) => settle({ code: code ?? -1, stdout, stderr }));
  });
}

const encode = (script) => Buffer.from(script, 'utf16le').toString('base64');

/** Remove a local account's profile folder and its profile registration. */
function profileRemovalScript(name) {
  return (
    `$ErrorActionPreference = 'SilentlyContinue'\n` +
    `Get-CimInstance Win32_UserProfile | Where-Object { $_.LocalPath -like '*\\${name}' } | Remove-CimInstance\n` +
    `Remove-Item -LiteralPath (Join-Path $env:SystemDrive 'Users\\${name}') -Recurse -Force`
  );
}

/**
 * Create a standard account, run `work` with it, and always delete it afterwards.
 *
 * @param {Function} run the command runner.
 * @param {(account: {name: string, password: string}) => Promise<T>} work
 * @param {{onWarning?: (message: string) => void}} [options]
 * @template T
 */
export async function withSecondAccount(run, work, { onWarning = () => {} } = {}) {
  const account = { name: randomAccountName(), password: randomPassword() };

  const created = await run('net.exe', ['user', account.name, account.password, '/add', '/y', '/expires:never']);
  if (created.code !== 0) {
    // It may exist half-made; try to remove it, then say why creation failed.
    await run('net.exe', ['user', account.name, '/delete']).catch(() => {});
    throw new SecondAccountError(
      `could not create the second account (net user /add exit ${created.code}): ${(created.stderr || created.stdout).trim()}`,
    );
  }

  try {
    return await work(account);
  } finally {
    // Neither cleanup may mask the work's own result or error, and the first must not skip the second.
    try {
      const removed = await run('net.exe', ['user', account.name, '/delete']);
      if (removed.code !== 0) onWarning(`could not delete the second account ${account.name} (exit ${removed.code})`);
    } catch (err) {
      onWarning(`could not delete the second account ${account.name}: ${err.message}`);
    }
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(profileRemovalScript(account.name))]);
    } catch (err) {
      onWarning(`could not remove the second account's profile: ${err.message}`);
    }
  }
}

/**
 * PowerShell that runs `file` as the account in the environment, waits for it, and exits with its
 * exit code. The password reaches it through `$env:THRONG_VERIFY_PASSWORD` only — never in the script
 * text, which can end up in a process listing or a log.
 */
export function buildRunAsScript({ file, args = [], cwd = 'C:\\Users\\Public' }) {
  // ONE command line, not an array: Start-Process joins an -ArgumentList array with bare spaces, so
  // `C:\Program Files\throng` arrived as two arguments. Each is quoted by the rules the C runtime
  // parses with (CommandLineToArgvW), then the whole line is a single-quoted PowerShell string.
  const commandLine = args.map((a) => quoteWindowsArg(String(a))).join(' ').replace(/'/g, "''");
  return [
    `$ErrorActionPreference = 'Stop'`,
    `$secure = ConvertTo-SecureString $env:THRONG_VERIFY_PASSWORD -AsPlainText -Force`,
    `$credential = New-Object System.Management.Automation.PSCredential($env:THRONG_VERIFY_USER, $secure)`,
    `$stdout = Join-Path $env:THRONG_VERIFY_SHARED ('out-' + [guid]::NewGuid().ToString('N') + '.txt')`,
    `$stderr = Join-Path $env:THRONG_VERIFY_SHARED ('err-' + [guid]::NewGuid().ToString('N') + '.txt')`,
    `$start = @{ FilePath = '${file.replace(/'/g, "''")}'; Credential = $credential; WorkingDirectory = '${cwd.replace(/'/g, "''")}';` +
      ` PassThru = $true; RedirectStandardOutput = $stdout; RedirectStandardError = $stderr; LoadUserProfile = $true }`,
    ...(args.length > 0 ? [`$start.ArgumentList = '${commandLine}'`] : []),
    // Not -Wait: that waits for the whole process TREE, and the probe deliberately leaves the
    // account's daemon running. Reading Handle first keeps ExitCode available after the exit.
    `$process = Start-Process @start`,
    `$null = $process.Handle`,
    `$process.WaitForExit()`,
    `if (Test-Path $stdout) { Get-Content -Raw $stdout | Write-Output }`,
    `if (Test-Path $stderr) { Get-Content -Raw $stderr | ForEach-Object { [Console]::Error.Write($_) } }`,
    `Remove-Item $stdout, $stderr -ErrorAction SilentlyContinue`,
    `exit $process.ExitCode`,
  ].join('\n');
}

/** One argument quoted for CommandLineToArgvW: backslashes double only before a quote or the end. */
function quoteWindowsArg(arg) {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let slashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      slashes++;
      continue;
    }
    out += '\\'.repeat(ch === '"' ? slashes * 2 + 1 : slashes) + ch;
    slashes = 0;
  }
  return `${out}${'\\'.repeat(slashes * 2)}"`;
}

/**
 * PowerShell that STARTS `file` as the account and prints its process id without waiting for it: for
 * a program with a window that a driver then works (the hand tests). The process opens on the
 * interactive session's desktop, so a UI Automation helper in the runner's own session can see it.
 */
export function buildStartAsScript({ file, args = [], cwd = 'C:\\Users\\Public' }) {
  const commandLine = args.map((a) => quoteWindowsArg(String(a))).join(' ').replace(/'/g, "''");
  return [
    `$ErrorActionPreference = 'Stop'`,
    `$secure = ConvertTo-SecureString $env:THRONG_VERIFY_PASSWORD -AsPlainText -Force`,
    `$credential = New-Object System.Management.Automation.PSCredential($env:THRONG_VERIFY_USER, $secure)`,
    `$start = @{ FilePath = '${file.replace(/'/g, "''")}'; Credential = $credential; WorkingDirectory = '${cwd.replace(/'/g, "''")}'; PassThru = $true; LoadUserProfile = $true }`,
    ...(args.length > 0 ? [`$start.ArgumentList = '${commandLine}'`] : []),
    `$process = Start-Process @start`,
    `Write-Output $process.Id`,
  ].join('\n');
}

/** Start a program as the account; resolves to `{pid}` (null when it did not start) plus stderr. */
export async function startAsAccount(run, account, sharedDir, { file, args, cwd }) {
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(buildStartAsScript({ file, args, cwd }))], {
    timeoutMs: 60000,
    env: {
      ...process.env,
      THRONG_VERIFY_USER: `${process.env.COMPUTERNAME ?? '.'}\\${account.name}`,
      THRONG_VERIFY_PASSWORD: account.password,
      THRONG_VERIFY_SHARED: sharedDir,
    },
  });
  const pid = Number(String(r.stdout).trim().split(/\r?\n/).pop());
  return { pid: Number.isInteger(pid) && pid > 0 ? pid : null, code: r.code, stderr: r.stderr };
}

/**
 * Run a program as the account and return `{code, stdout, stderr}`. `sharedDir` must be writable by
 * the account and by this process (it carries the redirected output).
 */
export function runAsAccount(run, account, sharedDir, { file, args, cwd, timeoutMs }) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(buildRunAsScript({ file, args, cwd }))], {
    timeoutMs,
    env: {
      ...process.env,
      THRONG_VERIFY_USER: `${process.env.COMPUTERNAME ?? '.'}\\${account.name}`,
      THRONG_VERIFY_PASSWORD: account.password,
      THRONG_VERIFY_SHARED: sharedDir,
    },
  });
}
