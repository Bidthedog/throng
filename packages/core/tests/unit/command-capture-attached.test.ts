import { describe, expect, it } from 'vitest';
import type { ChildProcess } from '../../src/abstractions/pty-host.js';
import { foregroundCommand } from '../../src/terminal/command-capture.js';

/**
 * 051 US4 (FR-040–FR-044, #193) — the running command when the shell's direct children cannot see it.
 *
 * The rows are the ones measured (research.md R12 addendum): Git Bash starts `docker` through a
 * shell-script wrapper whose `sh.exe` is re-parented to a dead msys fork, so the shell has no direct
 * child at all while `docker run` holds the terminal. The OS can still say which processes are
 * attached to the terminal's console, and that set is the fallback.
 */
const SHELL = 100;
const SHELL_IMAGE = 'E:/tools/Git/bin/bash.exe';
const AT = 1_000_000;

const proc = (pid: number, ppid: number, commandLine: string, startedAt: number): ChildProcess => ({
  pid,
  ppid,
  commandLine,
  startedAt,
});

/** What the attached list held for `docker run` in Git Bash (pids renumbered). */
const DOCKER_ATTACHED = [
  proc(SHELL, 1, 'E:/tools/Git/bin/bash.exe --login -i', AT),
  proc(101, SHELL, '"E:\\tools\\Git\\bin\\..\\usr\\bin\\bash.exe" --login -i', AT + 20),
  proc(300, 299, 'E:\\tools\\Git\\usr\\bin\\sh.exe /e/tools/docker/resources/bin/docker run --rm alpine sleep 600', AT + 3000),
  proc(301, 300, 'E:\\tools\\Git\\usr\\bin\\sh.exe /e/tools/docker/resources/bin/docker run --rm alpine sleep 600', AT + 3090),
  proc(302, 301, 'E:\\tools\\docker\\resources\\bin\\docker.exe run --rm --init alpine sleep 600', AT + 3110),
];
/** The direct-children view of the same moment: only the shell's re-exec. */
const DOCKER_CHILDREN = [DOCKER_ATTACHED[1]!];

describe('051 FR-040 — attached processes as the fallback', () => {
  it('names a re-parented command the direct children cannot see: the root of what is attached', () => {
    expect(foregroundCommand(SHELL, DOCKER_CHILDREN, SHELL_IMAGE, AT, DOCKER_ATTACHED)).toBe(
      '"E:\\tools\\Git\\usr\\bin\\sh.exe" /e/tools/docker/resources/bin/docker run --rm alpine sleep 600',
    );
  });

  it('without an attached set the result is exactly the direct-children one (OS cannot say)', () => {
    expect(foregroundCommand(SHELL, DOCKER_CHILDREN, SHELL_IMAGE, AT)).toBeNull();
  });

  it('of two attached command trees, the more recently started root wins (025 tie-break)', () => {
    const later = proc(400, 398, 'node watch.js', AT + 9000);
    expect(foregroundCommand(SHELL, DOCKER_CHILDREN, SHELL_IMAGE, AT, [...DOCKER_ATTACHED, later])).toBe(
      'node watch.js',
    );
  });
});

describe('051 FR-044 — a command the shell starts directly is unchanged', () => {
  it('a direct child wins even when the attached set holds its descendants', () => {
    const npm = proc(200, SHELL, 'npm run dev', AT + 100);
    const node = proc(201, 200, 'node server.js', AT + 200);
    expect(foregroundCommand(SHELL, [npm], 'cmd.exe', AT, [proc(SHELL, 1, 'cmd.exe', AT), npm, node])).toBe(
      'npm run dev',
    );
  });
});

describe('051 FR-042 / FR-043 — what is never the command', () => {
  it('nothing attached but the shell and its re-exec → nothing running', () => {
    expect(foregroundCommand(SHELL, DOCKER_CHILDREN, SHELL_IMAGE, AT, DOCKER_ATTACHED.slice(0, 2))).toBeNull();
  });

  it('the console host is never the command', () => {
    const host = proc(500, 1, 'C:\\WINDOWS\\system32\\conhost.exe --headless --width 80', AT + 5);
    const open = proc(501, 1, '"C:\\app\\OpenConsole.exe" --headless', AT + 6);
    expect(foregroundCommand(SHELL, [], 'cmd.exe', AT, [proc(SHELL, 1, 'cmd.exe', AT), host, open])).toBeNull();
  });

  it('a process that started before the shell is a pid-reuse impostor, not the command (#280)', () => {
    const old = proc(600, 1, 'vim notes.txt', AT - 5000);
    expect(foregroundCommand(SHELL, [], 'cmd.exe', AT, [proc(SHELL, 1, 'cmd.exe', AT), old])).toBeNull();
  });
});
