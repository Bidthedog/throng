import { describe, expect, it } from 'vitest';
import {
  claudeResumeCommand,
  isClaudeCodeProcess,
  resumeShellFor,
  type ResumeShell,
} from '../../src/terminal/claude-resume.js';

const ID = '11111111-2222-3333-4444-555555555555';

describe('isClaudeCodeProcess', () => {
  it('recognises the native image at any path, with or without .exe', () => {
    expect(isClaudeCodeProcess({ commandLine: 'claude --model opus' })).toBe(true);
    // Measured on Linux: /proc/<pid>/exe is the versioned image, argv[0] and comm are `claude`.
    expect(isClaudeCodeProcess({ commandLine: 'claude --model opus', executablePath: '/home/a/.local/share/claude/versions/2.1.322' })).toBe(true);
    // A background session's argv[0] is the versioned image itself.
    expect(isClaudeCodeProcess({ commandLine: '/home/a/.local/share/claude/versions/2.1.322 --agent claude' })).toBe(true);
    expect(isClaudeCodeProcess({ commandLine: 'x', executablePath: '/home/a/bin/claude' })).toBe(true);
    expect(isClaudeCodeProcess({ commandLine: '"C:\\Users\\a\\claude.exe" -c' })).toBe(true);
    expect(isClaudeCodeProcess({ commandLine: 'x', executablePath: 'C:\\Users\\a\\Claude.EXE' })).toBe(true);
  });

  it('recognises node running the Claude Code package', () => {
    expect(isClaudeCodeProcess({ commandLine: 'node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js --x' })).toBe(true);
    expect(isClaudeCodeProcess({ commandLine: 'node /opt/claude-code/cli.js' })).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isClaudeCodeProcess({ commandLine: 'node server.js' })).toBe(false);
    expect(isClaudeCodeProcess({ commandLine: 'codex --full-auto' })).toBe(false);
    expect(isClaudeCodeProcess({ commandLine: 'aider' })).toBe(false);
    expect(isClaudeCodeProcess({ commandLine: 'bash -lc claude' })).toBe(false);
    expect(isClaudeCodeProcess({ commandLine: '' })).toBe(false);
  });
});

describe('claudeResumeCommand', () => {
  it('appends --resume <id> to a bare claude and keeps launch flags', () => {
    expect(claudeResumeCommand(['/x/claude', '--model', 'opus', '--dangerously-skip-permissions'], ID)).toBe(
      `claude --model opus --dangerously-skip-permissions --resume ${ID}`,
    );
  });

  it('drops the session-selecting arguments', () => {
    const argv = [
      'claude',
      '--resume', 'old',
      '--resume=old2',
      '-r', 'old3',
      '--continue',
      '-c',
      '--session-id', 'abc',
      '--session-id=abc',
      '--fork-session',
      '--effort', 'high',
    ];
    expect(claudeResumeCommand(argv, ID)).toBe(`claude --effort high --resume ${ID}`);
  });

  it('drops a leading agents subcommand only', () => {
    expect(claudeResumeCommand(['claude', 'agents', '--model', 'opus'], ID)).toBe(`claude --model opus --resume ${ID}`);
    // Not leading: a positional argument, dropped like any other.
    expect(claudeResumeCommand(['claude', '--model', 'opus', 'agents'], ID)).toBe(`claude --model opus --resume ${ID}`);
  });

  it('drops positional arguments (a prompt would be resent on every restore) and keeps flags and their values (FR-041a)', () => {
    expect(claudeResumeCommand(['claude', 'commit and push', '--model', 'opus'], ID)).toBe(`claude --model opus --resume ${ID}`);
    expect(claudeResumeCommand(['claude', '--model', 'opus', 'commit and push'], ID)).toBe(`claude --model opus --resume ${ID}`);
    expect(claudeResumeCommand(['claude', '--dangerously-skip-permissions', 'do it'], ID)).toBe(
      `claude --dangerously-skip-permissions --resume ${ID}`,
    );
    expect(claudeResumeCommand(['claude', '--verbose', '--effort', 'high', 'go'], ID)).toBe(`claude --verbose --effort high --resume ${ID}`);
    expect(claudeResumeCommand(['claude', '--effort=high', 'go'], ID)).toBe(`claude --effort=high --resume ${ID}`);
  });

  it('keeps every value of a variadic flag', () => {
    expect(claudeResumeCommand(['claude', '--add-dir', '/a', '/b', '--model', 'opus'], ID)).toBe(
      `claude --add-dir /a /b --model opus --resume ${ID}`,
    );
  });

  it('does not swallow the next flag after a value-less --resume', () => {
    expect(claudeResumeCommand(['claude', '--resume', '--model', 'opus'], ID)).toBe(`claude --model opus --resume ${ID}`);
  });

  it('skips the node script when node runs the package', () => {
    expect(claudeResumeCommand(['node', '/x/@anthropic-ai/claude-code/cli.js', '--model', 'opus'], ID)).toBe(
      `claude --model opus --resume ${ID}`,
    );
  });

  it('returns null when the result is not capturable', () => {
    expect(claudeResumeCommand(['claude', '--append-system-prompt', 'line1\nline2'], ID)).toBeNull();
    expect(claudeResumeCommand(['claude', '--append-system-prompt', 'x'.repeat(3000)], ID)).toBeNull();
    expect(claudeResumeCommand([], ID)).toBeNull();
  });
});

describe('claudeResumeCommand quotes for the shell that will read it', () => {
  const flag = (value: string, shell: ResumeShell): string | null =>
    claudeResumeCommand(['claude', '--append-system-prompt', value], ID, shell);

  it('POSIX: single quotes, with an embedded single quote as \'\\\'\'', () => {
    expect(flag('plain-value_1', 'posix')).toBe(`claude --append-system-prompt plain-value_1 --resume ${ID}`);
    expect(flag('two words', 'posix')).toBe(`claude --append-system-prompt 'two words' --resume ${ID}`);
    expect(flag('', 'posix')).toBe(`claude --append-system-prompt '' --resume ${ID}`);
    expect(flag('Bash(npm:*)', 'posix')).toBe(`claude --append-system-prompt 'Bash(npm:*)' --resume ${ID}`);
    expect(flag('{"model":"opus"}', 'posix')).toBe(`claude --append-system-prompt '{"model":"opus"}' --resume ${ID}`);
    expect(flag("it's", 'posix')).toBe(`claude --append-system-prompt 'it'\\''s' --resume ${ID}`);
    expect(flag('a";touch /tmp/x;"', 'posix')).toBe(`claude --append-system-prompt 'a";touch /tmp/x;"' --resume ${ID}`);
    expect(flag('$(id) `id` $HOME', 'posix')).toBe(`claude --append-system-prompt '$(id) \`id\` $HOME' --resume ${ID}`);
  });

  it('PowerShell: single quotes with the quote doubled; an argument holding a double quote is declined', () => {
    expect(flag('two words', 'powershell')).toBe(`claude --append-system-prompt 'two words' --resume ${ID}`);
    expect(flag("it's", 'powershell')).toBe(`claude --append-system-prompt 'it''s' --resume ${ID}`);
    expect(flag('Bash(npm:*)', 'powershell')).toBe(`claude --append-system-prompt 'Bash(npm:*)' --resume ${ID}`);
    expect(flag('a;b', 'powershell')).toBe(`claude --append-system-prompt 'a;b' --resume ${ID}`);
    expect(flag('C:\\My Dir\\x', 'powershell')).toBe(`claude --append-system-prompt 'C:\\My Dir\\x' --resume ${ID}`);
    expect(flag('{"model":"opus"}', 'powershell')).toBeNull();
  });

  it('cmd: double quotes for spaces; an argument cmd would interpret is declined', () => {
    expect(flag('two words', 'cmd')).toBe(`claude --append-system-prompt "two words" --resume ${ID}`);
    expect(flag('C:\\My Dir\\x', 'cmd')).toBe(`claude --append-system-prompt "C:\\My Dir\\x" --resume ${ID}`);
    for (const bad of ['a"b', '100%', 'a^b', 'a&b', 'a|b', 'a<b', 'a>b', 'a!b']) {
      expect(flag(bad, 'cmd'), bad).toBeNull();
    }
  });

  it('names the shell from the terminal image', () => {
    expect(resumeShellFor('pwsh.exe')).toBe('powershell');
    expect(resumeShellFor('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe('powershell');
    expect(resumeShellFor('cmd.exe')).toBe('cmd');
    expect(resumeShellFor('/usr/bin/bash')).toBe('posix');
    expect(resumeShellFor('wsl.exe')).toBe('posix');
    expect(resumeShellFor('')).toBe('posix');
  });
});
