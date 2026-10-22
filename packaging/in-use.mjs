// Who is using this copy of throng? (spec 058 research D9; FR-015, FR-016a, FR-017.)
//
// Run by both installers before they replace or remove a copy:
//   - the setup, with the EXISTING installation's own bundled runtime
//     (<install root>\resources\runtime\node.exe), from a copy embedded in the setup;
//   - the MSI's custom action, from <install root>\resources\in-use\.
//
//   node in-use.mjs [--nsis] <install root>
//
// It lists the processes whose executable lies under the install root, with their owning accounts,
// and prints the verdict of the classifier. Default output is the JSON verdict; `--nsis` prints one
// line, "<decision>|<message>", which is all the NSIS script can parse cheaply. Exit 0 whenever it
// could answer; non-zero (1 the query failed, 2 no install root) means the caller must NOT assume
// "free" -- the setup then falls back to the by-name check.
//
// STANDALONE ON PURPOSE. The classifier is imported from `./in-use-classify.js` BESIDE this file --
// the built output of packages/core/src/config/install-in-use.ts, staged next to it -- and never from
// `@throng/core`, which neither a pre-058 install root nor the setup's plugins directory can resolve.
// The file is loaded as text and imported as a data: URL, so it works whatever the nearest
// package.json says and whatever (older) Node the existing installation bundled.
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

/** PowerShell run with -EncodedCommand, so the script needs no quoting. The root arrives in an env var. */
const QUERY = `
$ErrorActionPreference = 'Stop'
$root = $env:THRONG_IN_USE_ROOT.TrimEnd('\\') + '\\'
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$rows = foreach ($p in Get-CimInstance -ClassName Win32_Process) {
  if ($p.ExecutablePath -and $p.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    $sid = ''
    $name = ''
    $s = Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid -ErrorAction SilentlyContinue
    if ($s -and $s.Sid) { $sid = [string]$s.Sid }
    $o = Invoke-CimMethod -InputObject $p -MethodName GetOwner -ErrorAction SilentlyContinue
    if ($o -and $o.User) { $name = ([string]$o.Domain) + '\\' + ([string]$o.User) }
    [pscustomobject]@{ pid = [int]$p.ProcessId; executablePath = [string]$p.ExecutablePath; ownerSid = $sid; ownerName = $name }
  }
}
$list = @()
if ($rows) { $list = @($rows) }
ConvertTo-Json -Compress -Depth 4 -InputObject @{ performingSid = $me; processes = $list }
`;

/** The real OS query: the processes under `installRoot` and the SID of the account running this. */
export function listProcesses(installRoot) {
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from(QUERY, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      powershell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env: { ...process.env, THRONG_IN_USE_ROOT: installRoot }, maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 60000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`could not list processes: ${stderr.trim() || error.message}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`could not read the process list: ${stdout.slice(0, 200)}`));
        }
      },
    );
  });
}

/** Load the classifier staged beside this file. */
export async function loadClassifier(dir = dirname(fileURLToPath(import.meta.url))) {
  const source = await readFile(join(dir, 'in-use-classify.js'), 'utf8');
  const module = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  return module.classifyInstallUse;
}

/**
 * The command decision. `deps` replaces the three things that touch the machine, for tests.
 *
 * @param {string[]} argv
 * @param {{listProcesses?: (root: string) => Promise<{performingSid: string, processes: object[]}>,
 *          classify?: Function, selfPid?: number}} [deps]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export async function main(argv, deps = {}) {
  const nsis = argv.includes('--nsis');
  const installRoot = argv.filter((a) => a !== '--nsis')[0];
  if (!installRoot) {
    return { code: 2, stdout: '', stderr: 'in-use: an install root is required: node in-use.mjs [--nsis] <install root>\n' };
  }
  try {
    const { performingSid, processes } = await (deps.listProcesses ?? listProcesses)(installRoot);
    const classify = deps.classify ?? (await loadClassifier());
    // This process runs from the install root's own runtime when the setup asks about it: it is not "use".
    const selfPid = deps.selfPid ?? process.pid;
    const verdict = classify(
      processes.filter((p) => p.pid !== selfPid),
      installRoot,
      performingSid,
    );
    if (nsis) {
      const message = (verdict.message ?? '').replace(/\s+/g, ' ');
      return { code: 0, stdout: `${verdict.decision}|${message}\n`, stderr: '' };
    }
    return { code: 0, stdout: JSON.stringify(verdict) + '\n', stderr: '' };
  } catch (error) {
    return { code: 1, stdout: '', stderr: `in-use: ${error instanceof Error ? error.message : String(error)}\n` };
  }
}

/**
 * Was this file started as the script (rather than imported by a test)? Compared by REAL path: Node
 * resolves a module to its real path, while argv[1] keeps whatever spelling it was started with — an
 * 8.3 short name under a runner's temp folder, a junction. A plain comparison was false there, so the
 * entry point silently never ran and the helper printed nothing and exited 0.
 */
function startedAsScript() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  if (import.meta.url === pathToFileURL(argv1).href) return true;
  try {
    return realpathSync.native(argv1).toLowerCase() === realpathSync.native(fileURLToPath(import.meta.url)).toLowerCase();
  } catch {
    return false;
  }
}

// Run as a script (and not when imported by a test).
if (startedAsScript()) {
  const result = await main(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
