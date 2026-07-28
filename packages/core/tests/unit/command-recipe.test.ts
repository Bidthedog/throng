import { describe, it, expect } from 'vitest';
import {
  expandCommandRecipe,
  isValidCommandRecipe,
  resolveCommandRecipe,
  BUILTIN_FLAVOUR_COMMAND_RECIPES,
  BUILTIN_SHELL_INTEGRATION,
  flavourReportsDirectory,
  prepareStartupCommand,
} from '@throng/core';
import type { TerminalSettings } from '@throng/core';

function settings(overrides: Partial<TerminalSettings> = {}): TerminalSettings {
  return {
    flavours: [],
    disabledBuiltins: [],
    defaultShellArguments: {},
    commandRecipes: {},
    commandPollMs: 1000,
    showStatusBar: true,
    linkHoverDelayMs: 500,
    ...overrides,
  };
}

describe('expandCommandRecipe (025 FR-010)', () => {
  it('substitutes {command} inside the element that holds it', () => {
    expect(expandCommandRecipe(['/K', '{command}'], 'npm run dev')).toEqual(['/K', 'npm run dev']);
  });

  it('keeps the command as ONE argv element even with spaces and quotes (research R1a)', () => {
    // cmd.exe does not honour the \" escaping convention every other shell uses, so the command
    // must never be split across argv elements — that is what makes quoting the shell's business.
    const out = expandCommandRecipe(['/K', '{command}'], 'git commit -m "a message"');
    expect(out).toHaveLength(2);
    expect(out[1]).toBe('git commit -m "a message"');
  });

  it('substitutes into a surrounding template, as git-bash needs for its re-exec', () => {
    expect(expandCommandRecipe(['-c', '{command}; exec bash -i'], 'npm run dev')).toEqual([
      '-c',
      'npm run dev; exec bash -i',
    ]);
  });

  it('rejects a recipe with no {command} placeholder', () => {
    expect(isValidCommandRecipe(['-NoExit'])).toBe(false);
    expect(isValidCommandRecipe([])).toBe(false);
    expect(isValidCommandRecipe(['-c', '{command}'])).toBe(true);
  });
});

describe('BUILTIN_FLAVOUR_COMMAND_RECIPES — proven in research R1', () => {
  it('every built-in recipe is valid', () => {
    for (const recipe of Object.values(BUILTIN_FLAVOUR_COMMAND_RECIPES)) {
      expect(isValidCommandRecipe(recipe)).toBe(true);
    }
  });

  it('git-bash re-execs an interactive shell — without it the shell exits (FR-005)', () => {
    const expanded = expandCommandRecipe(BUILTIN_FLAVOUR_COMMAND_RECIPES['git-bash']!, 'npm run dev');
    expect(expanded.join(' ')).toContain('exec bash -i');
  });

  it('cmd uses /K, not /C — /C would close the terminal when the command finishes', () => {
    expect(BUILTIN_FLAVOUR_COMMAND_RECIPES.cmd).toEqual(['/K', '{command}']);
  });

  it('both PowerShell flavours use -NoExit -Command', () => {
    expect(BUILTIN_FLAVOUR_COMMAND_RECIPES.pwsh).toEqual(['-NoExit', '-Command', '{command}']);
    expect(BUILTIN_FLAVOUR_COMMAND_RECIPES['windows-powershell']).toEqual([
      '-NoExit',
      '-Command',
      '{command}',
    ]);
  });
});

describe('resolveCommandRecipe precedence (025 FR-011)', () => {
  it('settings.commandRecipes[id] wins over everything', () => {
    expect(
      resolveCommandRecipe('cmd', 'builtin', undefined, settings({ commandRecipes: { cmd: ['/C', '{command}'] } })),
    ).toEqual(['/C', '{command}']);
  });

  it("uses a user flavour's own commandRecipe when set", () => {
    const entry = { id: 'my-cmd', label: 'My CMD', file: 'cmd.exe', args: [], defaultShellArguments: '', commandRecipe: ['/K', '{command}'] };
    expect(resolveCommandRecipe('my-cmd', 'user', entry, settings())).toEqual(['/K', '{command}']);
  });

  it('falls back to the built-in catalogue for a built-in', () => {
    expect(resolveCommandRecipe('pwsh', 'builtin', undefined, settings())).toEqual([
      '-NoExit',
      '-Command',
      '{command}',
    ]);
  });

  it('returns undefined for an unknown flavour — the PTY-write fallback path (FR-012)', () => {
    expect(resolveCommandRecipe('mystery', 'user', undefined, settings())).toBeUndefined();
  });

  it('treats an INVALID configured recipe as absent rather than launching something broken', () => {
    expect(
      resolveCommandRecipe('cmd', 'builtin', undefined, settings({ commandRecipes: { cmd: ['/K'] } })),
    ).toBeUndefined();
  });
});

describe('flavourReportsDirectory — what gates the Reopen control (025 follow-up)', () => {
  it('a shell throng can observe from outside always reports, integration or not', () => {
    // cmd is the one built-in whose `cd` genuinely moves the process working directory, so the
    // daemon can read it with no cooperation from the shell.
    expect(flavourReportsDirectory('cmd', true)).toBe(true);
    expect(flavourReportsDirectory('cmd', false)).toBe(true);
    // An unknown/user-defined flavour is assumed observable rather than gated pre-emptively.
    expect(flavourReportsDirectory('my-shell', false)).toBe(true);
  });

  it('every other built-in reports ONLY with shell integration on', () => {
    // Measured, not assumed: after a `cd`, cmd's PEB working directory follows and PowerShell's,
    // pwsh's and Git Bash's all stay at the launch directory. They can only be asked to report.
    for (const id of ['windows-powershell', 'pwsh', 'git-bash']) {
      expect(flavourReportsDirectory(id, true), `${id} with integration`).toBe(true);
      expect(flavourReportsDirectory(id, false), `${id} without integration`).toBe(false);
    }
  });

  it('every flavour needing integration has a snippet to install', () => {
    // Otherwise the control would be gated on a capability nothing could ever provide.
    for (const id of Object.keys(BUILTIN_SHELL_INTEGRATION)) {
      expect(flavourReportsDirectory(id, false)).toBe(false);
      expect(BUILTIN_SHELL_INTEGRATION[id]!.length).toBeGreaterThan(0);
    }
  });
});

describe('prepareStartupCommand — PowerShell needs the call operator (025 follow-up)', () => {
  const QUOTED = '"C:\\Windows\\System32\\PING.EXE" -t bbc.co.uk';

  it('prefixes & for a quoted executable path in PowerShell, which otherwise fails to parse', () => {
    // Without this PowerShell reports: Unexpected token '-t' in expression or statement.
    expect(prepareStartupCommand('windows-powershell', QUOTED)).toBe(`& ${QUOTED}`);
    expect(prepareStartupCommand('pwsh', QUOTED)).toBe(`& ${QUOTED}`);
  });

  it('leaves an UNQUOTED command exactly as typed — PowerShell parses it as a command already', () => {
    expect(prepareStartupCommand('pwsh', 'ping -t bbc.co.uk')).toBe('ping -t bbc.co.uk');
    expect(prepareStartupCommand('pwsh', 'npm run dev')).toBe('npm run dev');
  });

  it('never touches shells without that parsing rule', () => {
    expect(prepareStartupCommand('cmd', QUOTED)).toBe(QUOTED);
    expect(prepareStartupCommand('git-bash', QUOTED)).toBe(QUOTED);
    expect(prepareStartupCommand('my-shell', QUOTED)).toBe(QUOTED);
  });

  it('does not double up an explicit call operator the user already wrote', () => {
    expect(prepareStartupCommand('pwsh', `& ${QUOTED}`)).toBe(`& ${QUOTED}`);
  });

  it('leaves an empty command empty', () => {
    expect(prepareStartupCommand('pwsh', '')).toBe('');
    expect(prepareStartupCommand('pwsh', '   ')).toBe('   ');
  });

  it("handles a single-quoted path too — PowerShell's rule is about quoting, not the quote char", () => {
    expect(prepareStartupCommand('pwsh', "'C:\\a b\\x.exe' -q")).toBe("& 'C:\\a b\\x.exe' -q");
  });
});
