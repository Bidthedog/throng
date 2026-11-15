// The process table on macOS, and the order to end a tree of it in (070 FR-047, research R27).
//
// macOS has no /proc, so the table comes from BSD `ps`: the columns `pid= ppid= comm= args=` with `-ww`, so nothing
// is cut at the terminal's width. They are read in TWO invocations rather than one because macOS's `comm` is the
// executable's full path, and a path can hold spaces (`…/Electron Helper (Renderer).app/…`): with `comm` and `args`
// on one line there is no telling where one ends and the other starts. Each invocation ends with the column that can
// hold spaces, so every line splits exactly, and the two are joined on the pid.
//
// The parsers and the tree walk are pure, so a captured `ps` sample tests them on any machine. Reading and ending
// processes are the thin parts around them.
//
//   node scripts/process-table.mjs --json     every process, as [{ pid, ppid, comm, args }]
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `ps` arguments for the two halves of the table. Every column has an `=` so no header line is printed. */
export const PS_COMM_ARGS = ['-axo', 'pid=,ppid=,comm=', '-ww'];
export const PS_ARGS_ARGS = ['-axo', 'pid=,args=', '-ww'];

/**
 * Join `ps -axo pid=,ppid=,comm= -ww` and `ps -axo pid=,args= -ww` into rows. A process in the first and not the
 * second started or ended between the two calls; it keeps an empty command line rather than being dropped, because
 * a process that is there is there.
 *
 * @param {string} commText the first invocation's output
 * @param {string} argsText the second invocation's output
 * @returns {{pid: number, ppid: number, comm: string, args: string}[]}
 */
export function parseBsdProcessTable(commText, argsText) {
  const argsByPid = new Map();
  for (const line of argsText.split('\n')) {
    const m = /^\s*(\d+)(?:\s+(.*?))?\s*$/.exec(line);
    if (m) argsByPid.set(Number(m[1]), m[2] ?? '');
  }
  const rows = [];
  for (const line of commText.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*?)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    rows.push({ pid, ppid: Number(m[2]), comm: m[3] ?? '', args: argsByPid.get(pid) ?? '' });
  }
  return rows;
}

/**
 * The given processes and every descendant, ordered so each child comes before its parent: ending them in this order
 * leaves nothing re-parented to launchd on the way down. The caller's own pid is never in the result.
 *
 * @param {{pid: number, ppid: number}[]} rows
 * @param {Iterable<number>} roots
 * @param {number} [self] a pid to leave out, normally `process.pid`
 * @returns {number[]}
 */
export function treeDeepestFirst(rows, roots, self = -1) {
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row.pid);
  }
  const order = [];
  const seen = new Set();
  // Breadth first from the roots, so a parent is always recorded before any of its children; then reversed.
  const queue = [...roots];
  while (queue.length > 0) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    order.push(pid);
    for (const child of children.get(pid) ?? []) queue.push(child);
  }
  return order.reverse().filter((pid) => pid !== self);
}

/** Every process on this Mac. Throws when `ps` fails, so a broken probe never reads as "nothing running". */
export function darwinProcessTable() {
  const options = { encoding: 'utf8', timeout: 20_000, maxBuffer: 64 * 1024 * 1024 };
  return parseBsdProcessTable(execFileSync('ps', PS_COMM_ARGS, options), execFileSync('ps', PS_ARGS_ARGS, options));
}

/** End `roots` and everything under them, deepest first, with SIGKILL. Answers how many were signalled. */
export function killTreesDeepestFirst(rows, roots, self = process.pid) {
  let ended = 0;
  for (const pid of treeDeepestFirst(rows, roots, self)) {
    try {
      process.kill(pid, 'SIGKILL');
      ended += 1;
    } catch {
      // Already gone.
    }
  }
  return ended;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)) && process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(darwinProcessTable()));
}
