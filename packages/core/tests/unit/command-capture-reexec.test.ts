import { describe, it, expect } from 'vitest';
import { foregroundCommand, normaliseCommand } from '@throng/core';

/**
 * 025 FR-022a / FR-023 — captured from REAL process trees, not invented ones.
 *
 * Both defects here were reported from use and then observed directly, by launching the shells
 * and dumping their descendants. The tree below is that dump, pids and all: Git for Windows'
 * `bin/bash.exe` is a launcher that starts `usr/bin/bash.exe`, and the recipe's own
 * `exec bash -i` adds a further link, so a command the user runs sits FOUR levels below the PTY.
 * Read literally, 'the most recently started direct child of the shell' found nothing there —
 * git-bash never remembered a command at all.
 */

const BASH = 'E:\\tools\\Git\\bin\\bash.exe';
const CMD = 'C:\\Windows\\System32\\cmd.exe';
const CLAUDE = 'C:\\Users\\Spikeh\\.local\\bin\\claude.exe agents';

/** The real git-bash tree, as observed. Shell pid 35944. */
const GIT_BASH_TREE = [
  { pid: 24588, ppid: 35944, startedAt: 100, commandLine: '"'+'E:\\tools\\Git\\bin\\..\\usr\\bin\\bash.exe'+'" -i -l -c "trap : INT; ping -t 127.0.0.1; exec bash -i"' },
  { pid: 35428, ppid: 24588, startedAt: 101, commandLine: 'E:\\tools\\Git\\usr\\bin\\bash.exe -i' },
  { pid: 33936, ppid: 35428, startedAt: 102, commandLine: 'E:\\tools\\Git\\usr\\bin\\bash.exe -i' },
  { pid: 32424, ppid: 33936, startedAt: 200, commandLine: CLAUDE },
];

describe('capturing through a shell that re-execs itself (025 FR-022a)', () => {
  it('finds the command git-bash is actually running, four levels down', () => {
    expect(foregroundCommand(35944, GIT_BASH_TREE, BASH)).toBe(CLAUDE);
  });

  it('without the shell image, finds the LAUNCHER instead — the defect that was reported', () => {
    // Kept deliberately: it states WHY the image must be threaded through, and fails loudly if
    // someone drops the parameter believing it optional. Note the old behaviour was not merely
    // 'nothing captured' — it was about to save bash's own launcher command line as the user's
    // startup command, which would then be re-run on every future launch.
    const withoutImage = foregroundCommand(35944, GIT_BASH_TREE);
    expect(withoutImage).not.toBe(CLAUDE);
    expect(withoutImage).toContain('bash.exe');
  });

  it('follows the shell chain only, never through a command into its own helper', () => {
    // FR-022: `npm run dev` spawning node stays ONE candidate — the npm the user typed.
    const tree = [
      { pid: 2, ppid: 1, startedAt: 100, commandLine: CMD + ' /K' },
      { pid: 3, ppid: 2, startedAt: 200, commandLine: 'npm run dev' },
      { pid: 4, ppid: 3, startedAt: 201, commandLine: 'node dev-server.js' },
    ];
    expect(foregroundCommand(1, tree, CMD)).toBe('npm run dev');
  });

  it('is unchanged for a shell that does not re-exec', () => {
    const tree = [{ pid: 2, ppid: 1, startedAt: 100, commandLine: 'ping -t 127.0.0.1' }];
    expect(foregroundCommand(1, tree, CMD)).toBe('ping -t 127.0.0.1');
  });
});

describe('saving a command as the user would recognise it (025 FR-023)', () => {
  it('collapses padding a launcher inserted — cmd reported `claude  agents`', () => {
    const tree = [{ pid: 2, ppid: 1, startedAt: 100, commandLine: 'claude  agents' }];
    expect(foregroundCommand(1, tree, CMD)).toBe('claude agents');
  });

  it('leaves spaces INSIDE quotes alone — a Windows path is not padding', () => {
    const quoted = '"'+'C:\\Program Files\\x\\PING.EXE'+'"';
    expect(normaliseCommand(quoted + '  -t')).toBe(quoted + ' -t');
  });

  it('trims, and collapses tabs and runs alike', () => {
    expect(normaliseCommand('  npm \t run   dev  ')).toBe('npm run dev');
  });
});
