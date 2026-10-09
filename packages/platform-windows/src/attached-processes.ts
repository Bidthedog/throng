import type { ChildProcess } from '@throng/core';

/**
 * 051 FR-040/FR-041 (#193) — which processes are attached to each terminal's console.
 *
 * A process can belong to a terminal without being a descendant the process table can trace: Git
 * Bash starts `docker` through a script whose `sh.exe` is re-parented to an msys fork that has
 * already exited. The console knows regardless. A process may only attach to ONE console, and the
 * daemon is attached to its own, so the asking happens in a short-lived hidden helper:
 * `FreeConsole` → for each shell `AttachConsole(pid)` → `GetConsoleProcessList` → `FreeConsole`.
 * One helper run answers for every terminal (FR-041); it runs off the daemon's event loop (FR-010).
 * Measured in research.md R12's addendum: 10/10 samples, ~80 ms a run.
 *
 * The helper leaves its own pid out (FR-043). A shell it could not attach to answers `null`, which
 * is "unknown", not "nothing attached".
 */
export const ATTACHED_HELPER_SOURCE = [
  '// argv: [execPath, koffi module path, ...shell pids]',
  'const koffi = require(process.argv[1]);',
  "const k32 = koffi.load('kernel32.dll');",
  "const FreeConsole = k32.func('FreeConsole', 'bool', []);",
  "const AttachConsole = k32.func('AttachConsole', 'bool', ['uint32']);",
  "const List = k32.func('GetConsoleProcessList', 'uint32', ['_Out_ uint32 *', 'uint32']);",
  'const out = {};',
  'FreeConsole();',
  'for (const arg of process.argv.slice(2)) {',
  '  const pid = Number(arg);',
  '  if (!AttachConsole(pid)) { out[pid] = null; continue; }',
  '  const buf = new Array(1024).fill(0);',
  '  const n = List(buf, 1024);',
  '  out[pid] = n > 0 && n <= 1024 ? buf.slice(0, n).filter((p) => p !== process.pid) : null;',
  '  FreeConsole();',
  '}',
  'process.stdout.write(JSON.stringify(out));',
].join('\n');

/** Runs the helper with the shell pids as arguments and resolves its stdout. */
export type AttachedHelperRunner = (shellPids: readonly number[]) => Promise<string>;

/**
 * The attached processes of each shell, with their details from `table` (pid → process). A pid the
 * helper lists but the table no longer holds has exited in between and is left out. REJECTS when the
 * helper or the table failed: that is unknown, which the caller must not read as nothing attached.
 */
export async function readAttachedProcesses(
  shellPids: readonly number[],
  run: AttachedHelperRunner,
  table: () => Promise<ReadonlyMap<number, ChildProcess>>,
): Promise<Map<number, ChildProcess[]>> {
  const result = new Map<number, ChildProcess[]>();
  if (shellPids.length === 0) return result;
  const [answer, byPid] = await Promise.all([
    run(shellPids).then((out) => JSON.parse(out) as Record<string, number[] | null>),
    table(),
  ]);
  for (const shell of shellPids) {
    const pids = answer[String(shell)];
    if (!Array.isArray(pids)) continue; // unknown for this terminal: it falls back to direct children
    result.set(
      shell,
      pids.flatMap((pid) => {
        const row = byPid.get(pid);
        return row ? [row] : [];
      }),
    );
  }
  return result;
}
