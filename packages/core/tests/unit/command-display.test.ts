import { describe, it, expect } from 'vitest';
import { commandDisplay } from '@throng/core';

/**
 * 053 FR-003 / FR-011 — the running command as a terminal's name shows it.
 *
 * The observed command line is what the launcher built, usually the resolved image path. A name
 * must never carry that path: `{command}` names the program by its bare name and keeps the
 * arguments, `{app}` is the bare name alone.
 */
describe('commandDisplay (053 FR-003, FR-011)', () => {
  it('names a quoted full path by its bare name, arguments unchanged', () => {
    expect(commandDisplay('"C:\\WINDOWS\\system32\\PING.EXE" -t host')).toEqual({
      command: 'ping -t host',
      app: 'ping',
    });
  });

  it('keeps a bare command as typed', () => {
    expect(commandDisplay('npm run dev')).toEqual({ command: 'npm run dev', app: 'npm' });
  });

  it('strips the directory and extension from an unquoted path', () => {
    expect(commandDisplay('C:/tools/node.exe server.js')).toEqual({
      command: 'node server.js',
      app: 'node',
    });
  });

  it('handles a quoted path with spaces and no arguments', () => {
    expect(commandDisplay('"C:\\Program Files\\Git\\usr\\bin\\vim.exe"')).toEqual({
      command: 'vim',
      app: 'vim',
    });
  });

  it('renders nothing for an empty line', () => {
    expect(commandDisplay('')).toEqual({ command: '', app: '' });
    expect(commandDisplay('   ')).toEqual({ command: '', app: '' });
  });
});
