// End a checkout's dev processes and, unless --keep-data, remove its dev data folders (spec 062 T035).
//
// The Linux and macOS half of `.claude/skills/throng-clear-dev-state`. It matches processes by this checkout's path,
// never by name, because every other Electron and node on the machine shares those names. Children go first, so
// nothing is orphaned on the way down. macOS has no /proc, so there the table is BSD `ps` (070 FR-047, research R27).
//
//   node scripts/clear-dev-state.mjs [--keep-data] [--root <checkout>]
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { darwinDevFolders, isDarwinDevProcess, isDevProcess } from './clear-dev-state-lib.mjs';
import { darwinProcessTable, killTreesDeepestFirst } from './process-table.mjs';

const args = process.argv.slice(2);
const keepData = args.includes('--keep-data');
const rootAt = args.indexOf('--root');
const root = resolve(rootAt >= 0 ? args[rootAt + 1] : join(fileURLToPath(new URL('.', import.meta.url)), '..'));

const nul = String.fromCharCode(0);

/** macOS: the same clean-up from `ps`, then the same folders in Apple's per-user locations. */
function clearDarwin() {
  const rows = darwinProcessTable();
  const roots = rows.filter((row) => row.pid !== process.pid && isDarwinDevProcess(row.comm, row.args, root)).map((row) => row.pid);
  const ended = killTreesDeepestFirst(rows, roots);
  console.log(`[clear-dev-state] ended ${ended} process(es) under ${root}`);
  if (keepData) return;
  for (const dir of darwinDevFolders(homedir())) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    console.log(`[clear-dev-state] removed ${dir}`);
  }
}

if (process.platform === 'darwin') {
  clearDarwin();
  process.exit(0);
}

function table() {
  const rows = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      const args = readFileSync(`/proc/${name}/cmdline`, 'utf8').split(nul).filter(Boolean);
      rows.push({ pid: Number(name), ppid, args });
    } catch {
      // Gone while being read.
    }
  }
  return rows;
}

const rows = table();
const roots = rows.filter((row) => row.pid !== process.pid && isDevProcess(row.args, root));

const doomed = new Set(roots.map((row) => row.pid));
for (let grew = true; grew; ) {
  grew = false;
  for (const row of rows) {
    if (doomed.has(row.ppid) && !doomed.has(row.pid)) {
      doomed.add(row.pid);
      grew = true;
    }
  }
}
doomed.delete(process.pid);

// Deepest first: a parent seen later in the walk was added before its children.
for (const pid of [...doomed].reverse()) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}
console.log(`[clear-dev-state] ended ${doomed.size} process(es) under ${root}`);

if (!keepData) {
  const config = process.env.XDG_CONFIG_HOME?.startsWith('/') ? process.env.XDG_CONFIG_HOME : join(homedir(), '.config');
  const data = process.env.XDG_DATA_HOME?.startsWith('/') ? process.env.XDG_DATA_HOME : join(homedir(), '.local', 'share');
  for (const dir of [join(config, 'throng-dev'), join(data, 'throng-dev')]) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    console.log(`[clear-dev-state] removed ${dir}`);
  }
}
