import { describe, it, expect } from 'vitest';
import { friendlyName } from '../../../src/resources/index.js';

describe('friendlyName (055 FR-023)', () => {
  it.each([
    ['bash.exe', undefined, 'Bash'],
    ['pwsh.exe', undefined, 'PowerShell'],
    ['powershell.exe', undefined, 'Windows PowerShell'],
    ['cmd.exe', undefined, 'Command Prompt'],
    ['node.exe', 'node server.js', 'Node'],
    ['node.exe', '"C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js" --resume', 'Claude Code'],
    ['claude.exe', undefined, 'Claude Code'],
    ['git.exe', 'git status', 'Git'],
    ['python.exe', undefined, 'Python'],
    ['python3.12.exe', undefined, 'Python'],
    ['conhost.exe', 'conhost.exe --headless --width 80', 'Console host'],
  ])('%s (%s) is "%s"', (image, commandLine, expected) => {
    expect(friendlyName(image, commandLine)).toBe(expected);
  });

  it('matches the image name regardless of case', () => {
    expect(friendlyName('NODE.EXE')).toBe('Node');
  });

  it('falls back to the image name for anything unrecognised', () => {
    expect(friendlyName('ripgrep-thing.exe')).toBe('ripgrep-thing.exe');
  });
});
