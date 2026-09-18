import { describe, expect, it } from 'vitest';
import { isWslExecutable } from '../../src/terminal/wsl-flavour.js';

/**
 * 045 T189 — "is this flavour WSL?" (FR-144, FR-151; contracts/platform-ports.md §6.2). One answer for
 * both requirements; a Git Bash, MSYS2 or Cygwin `bash.exe` must never be read as WSL.
 */
describe('isWslExecutable', () => {
  it.each([
    'C:\\Windows\\System32\\wsl.exe',
    'c:/windows/system32/WSL.EXE',
    'wsl.exe',
    'wsl',
    '"C:\\Windows\\System32\\wsl.exe"',
    'C:\\Windows\\System32\\bash.exe',
    'C:\\Windows\\Sysnative\\bash.exe',
  ])('%s is WSL', (file) => {
    expect(isWslExecutable(file)).toBe(true);
  });

  it.each([
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\msys64\\usr\\bin\\bash.exe',
    'bash.exe',
    'C:\\Windows\\System32\\cmd.exe',
    'pwsh.exe',
    'C:\\tools\\wslview.exe',
    '',
    undefined,
  ])('%s is not WSL', (file) => {
    expect(isWslExecutable(file)).toBe(false);
  });
});
