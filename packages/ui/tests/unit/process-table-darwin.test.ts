import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain-JS CI script, imported for its pure decisions.
import { darwinDevFolders, isDarwinDevProcess, isDevProcess } from '../../../../scripts/clear-dev-state-lib.mjs';
// @ts-expect-error — plain-JS CI script, imported for its pure decisions.
import { parseBsdProcessTable, PS_ARGS_ARGS, PS_COMM_ARGS, treeDeepestFirst } from '../../../../scripts/process-table.mjs';

/**
 * 070 FR-047, research R27 — CI and release jobs on macOS end what a run leaves behind, as Windows and Linux do. macOS
 * has no /proc, so the table is BSD `ps`, whose `comm` is a full path that can hold spaces. These samples are in the
 * exact shape `ps -axo pid=,ppid=,comm= -ww` and `ps -axo pid=,args= -ww` print on macOS: right-aligned pids, then the
 * last column unpadded. They were written in that shape, not captured; the first macOS CI run is the capture.
 *
 * Layer: unit — pure parsing and ordering; nothing is listed or ended.
 */

const ROOT = '/Users/runner/work/throng/throng';
const ELECTRON = `${ROOT}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`;
const HELPERS = `${ROOT}/node_modules/electron/dist/Electron.app/Contents/Frameworks`;
const NODE = '/Users/runner/hostedtoolcache/node/24.11.0/arm64/bin/node';

const COMM = [
  '    1     0 /sbin/launchd',
  '  312     1 /usr/libexec/logd',
  '  600     1 /System/Library/CoreServices/Finder.app/Contents/MacOS/Finder',
  ` 4100   600 ${ELECTRON}`,
  ` 4102  4100 ${HELPERS}/Electron Helper (GPU).app/Contents/MacOS/Electron Helper (GPU)`,
  ` 4103  4100 ${HELPERS}/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer)`,
  ` 4110     1 ${NODE}`,
  ` 4111  4110 ${NODE}`,
  ' 4120  4111 /bin/zsh',
  ' 4121  4120 /sbin/ping',
  ' 5000   600 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ' 5001  4120 /usr/bin/vim',
  ` 5002     1 ${NODE}`,
  '',
].join('\n');

const ARGS = [
  '    1 /sbin/launchd',
  '  312 /usr/libexec/logd',
  '  600 /System/Library/CoreServices/Finder.app/Contents/MacOS/Finder',
  ` 4100 ${ELECTRON} ${ROOT}/packages/ui/dist/main/main.js --user-data-dir=/var/folders/zz/T/throng e2e`,
  ` 4102 ${HELPERS}/Electron Helper (GPU).app/Contents/MacOS/Electron Helper (GPU) --type=gpu-process`,
  ` 4103 ${HELPERS}/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer) --type=renderer`,
  ` 4110 ${NODE} ${ROOT}/packages/daemon/dist/main.js`,
  ` 4111 ${NODE} ${ROOT}/packages/daemon/dist/pty-agent-entry.js`,
  ' 4120 -zsh',
  ' 4121 ping 127.0.0.7',
  ' 5000 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ` 5001 vim ${ROOT}/packages/ui/dist/main/main.js`,
  ` 5002 ${NODE} /elsewhere${ROOT}/packages/daemon/dist/main.js`,
  ' 5003 /usr/sbin/cfprefsd agent',
  '',
].join('\n');

describe('reading the macOS process table (070 FR-047)', () => {
  const rows = parseBsdProcessTable(COMM, ARGS);

  it('asks ps for every process, unclipped, with no header line', () => {
    expect(PS_COMM_ARGS).toEqual(['-axo', 'pid=,ppid=,comm=', '-ww']);
    expect(PS_ARGS_ARGS).toEqual(['-axo', 'pid=,args=', '-ww']);
  });

  it('keeps an executable path with spaces whole, and joins its command line by pid', () => {
    expect(rows.find((r: { pid: number }) => r.pid === 4103)).toEqual({
      pid: 4103,
      ppid: 4100,
      comm: `${HELPERS}/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer)`,
      args: `${HELPERS}/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer) --type=renderer`,
    });
    expect(rows.find((r: { pid: number }) => r.pid === 5000)?.comm).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });

  it('reads every line of the first listing, and nothing from the second alone', () => {
    expect(rows.map((r: { pid: number }) => r.pid)).toEqual([1, 312, 600, 4100, 4102, 4103, 4110, 4111, 4120, 4121, 5000, 5001, 5002]);
  });

  it('keeps a process whose command line was gone by the second call, with an empty one', () => {
    const [row] = parseBsdProcessTable(' 7000     1 /usr/bin/true\n', '');
    expect(row).toEqual({ pid: 7000, ppid: 1, comm: '/usr/bin/true', args: '' });
  });

  it('ignores blank and malformed lines rather than inventing a process', () => {
    expect(parseBsdProcessTable('\n  \nps: no controlling terminal\n', '')).toEqual([]);
  });
});

describe('which macOS processes clear-dev-state may end (070 FR-047)', () => {
  const rows = parseBsdProcessTable(COMM, ARGS);
  const dev = rows.filter((r: { comm: string; args: string }) => isDarwinDevProcess(r.comm, r.args, ROOT)).map((r: { pid: number }) => r.pid);

  it('takes the checkout’s Electron, its daemon and its terminal host', () => {
    expect(dev).toEqual([4100, 4110, 4111]);
  });

  it('leaves an editor naming the checkout, another Electron app, and a checkout that merely ends the same way', () => {
    for (const pid of [5000, 5001, 5002]) expect(dev).not.toContain(pid);
  });

  it('leaves a worktree of this checkout', () => {
    expect(isDarwinDevProcess(NODE, `${NODE} ${ROOT}/.claude/worktrees/x/packages/daemon/dist/main.js`, ROOT)).toBe(false);
  });

  it('accepts a checkout whose path has a space in it', () => {
    const spaced = '/Users/me/my code/throng';
    expect(isDarwinDevProcess(NODE, `${NODE} ${spaced}/packages/daemon/dist/main.js`, spaced)).toBe(true);
  });

  it('leaves the Linux rule exactly as it was', () => {
    expect(isDevProcess([`${ROOT}/node_modules/electron/dist/Electron`, '--type=renderer'], ROOT)).toBe(false);
    expect(isDevProcess([`${ROOT}/node_modules/electron/dist/electron`, '--type=renderer'], ROOT)).toBe(true);
  });

  it('names the dev folders, and only the dev folders (research R5)', () => {
    expect(darwinDevFolders('/Users/me')).toEqual(['/Users/me/Library/Application Support/throng-dev', '/Users/me/Library/Logs/throng-dev']);
  });
});

describe('ending a tree deepest first (070 FR-047)', () => {
  const rows = parseBsdProcessTable(COMM, ARGS);

  it('ends every descendant, each child before its parent, the shell’s children before the shell', () => {
    const order = treeDeepestFirst(rows, [4100, 4110]);
    expect([...order].sort((a: number, b: number) => a - b)).toEqual([4100, 4102, 4103, 4110, 4111, 4120, 4121, 5001]);
    const before = (child: number, parent: number): boolean => order.indexOf(child) < order.indexOf(parent);
    for (const [child, parent] of [[4102, 4100], [4103, 4100], [4111, 4110], [4120, 4111], [4121, 4120], [5001, 4120]]) {
      expect(before(child, parent), `${child} before ${parent}`).toBe(true);
    }
  });

  it('never ends the caller, and survives a cycle in a table read mid-change', () => {
    expect(treeDeepestFirst(rows, [4110], 4111)).not.toContain(4111);
    expect(treeDeepestFirst([{ pid: 1, ppid: 2 }, { pid: 2, ppid: 1 }], [1]).sort()).toEqual([1, 2]);
  });
});
