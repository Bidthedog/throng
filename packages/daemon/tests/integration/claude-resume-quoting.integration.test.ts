import { skipUnlessLinux } from '@throng/core/testing';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { claudeResumeCommand } from '@throng/core';

/**
 * 068 FR-041a — the resume command is typed into the terminal's shell, so every argument must come back
 * exactly, whatever characters it holds.
 *
 * Layer: integration — the claim is what a real bash does with the text; no fake parses shell quoting.
 * The PowerShell and cmd spellings are table-tested in claude-resume.test.ts (they cannot run here).
 */

const ID = '11111111-2222-3333-4444-555555555555';
const NUL = String.fromCharCode(0);

/** The arguments a real bash passes to a `claude` that prints each one, NUL-terminated. */
function argvSeenByBash(command: string): string[] {
  const out = execFileSync('bash', ['-c', `claude() { printf '%s\\0' "$@"; }; ${command}`], { encoding: 'utf8' });
  const parts = out.split(NUL);
  parts.pop();
  return parts;
}

describe.skipIf(skipUnlessLinux('runs the real bash'))('claudeResumeCommand typed into bash', () => {
  const awkward = [
    'Bash(npm:*)',
    '{"model":"opus"}',
    "it's a 'quoted' value",
    'a";touch /tmp/throng-injected;"',
    '$(id) `id` $HOME',
    'two  spaces',
    '',
    'back\\slash',
    '*.ts ~ ! #',
  ];

  it.each(awkward)('returns %j exactly', (value) => {
    const command = claudeResumeCommand(['claude', '--append-system-prompt', value, '--model', 'opus'], ID, 'posix');

    expect(command).not.toBeNull();
    expect(argvSeenByBash(command as string)).toEqual(['--append-system-prompt', value, '--model', 'opus', '--resume', ID]);
  });
});
