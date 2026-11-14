import { describe, it, expect } from 'vitest';
import { BUILTIN_FLAVOUR_COMMAND_RECIPES, expandCommandRecipe, resolveLaunchSpec } from '@throng/core';

const CMD = { file: 'cmd.exe', args: [], commandRecipe: ['/K', '{command}'] as readonly string[] };
const NO_RECIPE = { file: 'weird-shell.exe', args: ['--login'] };

describe('resolveLaunchSpec with a Startup Command (025 FR-004/FR-012)', () => {
  it('changes NOTHING when the startup command is empty (FR-006)', () => {
    const withOut = resolveLaunchSpec(CMD, '-x', 'C:/proj');
    const withEmpty = resolveLaunchSpec(CMD, '-x', 'C:/proj', '');
    expect(withEmpty).toEqual(withOut);
    expect(withEmpty.writeOnReady).toBeUndefined();
    expect(withEmpty.args).toEqual(['-x']);
  });

  it('expands the recipe into args when the flavour has one', () => {
    const spec = resolveLaunchSpec(CMD, '', 'C:/proj', 'npm run dev');
    expect(spec.args).toEqual(['/K', 'npm run dev']);
    // The command is already in argv — writing it to the PTY as well would run it twice.
    expect(spec.writeOnReady).toBeUndefined();
  });

  it('puts shell arguments BEFORE the recipe, so the recipe terminator stays last', () => {
    const spec = resolveLaunchSpec(CMD, '/Q', 'C:/proj', 'npm run dev');
    expect(spec.args).toEqual(['/Q', '/K', 'npm run dev']);
  });

  it('falls back to writeOnReady when the flavour has NO recipe (FR-012)', () => {
    const spec = resolveLaunchSpec(NO_RECIPE, '', 'C:/proj', 'npm run dev');
    expect(spec.args).toEqual(['--login']);
    expect(spec.writeOnReady).toBe('npm run dev');
  });

  it('never sets both — a command runs exactly once', () => {
    for (const flavour of [CMD, NO_RECIPE]) {
      const spec = resolveLaunchSpec(flavour, '', 'C:/proj', 'npm run dev');
      const inArgs = spec.args.some((a) => a.includes('npm run dev'));
      expect(inArgs && spec.writeOnReady !== undefined).toBe(false);
      expect(inArgs || spec.writeOnReady !== undefined).toBe(true);
    }
  });

  it('keeps a quoted command intact as one argv element', () => {
    const spec = resolveLaunchSpec(CMD, '', 'C:/proj', 'git commit -m "a message"');
    expect(spec.args).toEqual(['/K', 'git commit -m "a message"']);
  });

  it('still refuses a null project root', () => {
    expect(() => resolveLaunchSpec(CMD, '', null, 'npm run dev')).toThrow();
  });
});

describe('a recipe must not duplicate the flavour’s own shell arguments (FR-014)', () => {
  it('drops a shell argument the recipe already supplies — cmd ships /K and so does its recipe', () => {
    // Without this, cmd receives `/K /K echo hi` and tries to run "/K echo hi" as the command.
    // Caught by an E2E that launched the real shell, not by inspection.
    const spec = resolveLaunchSpec(CMD, '/K', 'C:/proj', 'echo hi');
    expect(spec.args).toEqual(['/K', 'echo hi']);
  });

  it('keeps shell arguments the recipe does NOT supply', () => {
    const pwsh = {
      file: 'pwsh.exe',
      args: [],
      commandRecipe: ['-NoExit', '-Command', '{command}'] as readonly string[],
    };
    expect(resolveLaunchSpec(pwsh, '-NoLogo', 'C:/proj', 'echo hi').args).toEqual([
      '-NoLogo',
      '-NoExit',
      '-Command',
      'echo hi',
    ]);
  });

  it('leaves shell arguments untouched when there is no startup command', () => {
    expect(resolveLaunchSpec(CMD, '/K', 'C:/proj').args).toEqual(['/K']);
  });
});

describe('068 FR-048 — a Claude Code resume command is wrapped so the shell stays interactive after it exits', () => {
  const RESUME = 'claude --model opus --resume 11111111-2222-3333-4444-555555555555';
  const INTERACTIVE_TAIL: Record<string, RegExp> = {
    'windows-powershell': /^-NoExit$/,
    pwsh: /^-NoExit$/,
    cmd: /^\/K$/,
    'git-bash': /exec bash -i$/,
    bash: /exec bash -i$/,
    zsh: /exec zsh -i$/,
    sh: /exec sh -i$/,
    dash: /exec dash -i$/,
    ksh: /exec ksh -i$/,
    tcsh: /exec tcsh -i$/,
    fish: /^--init-command$/,
    nu: /^--execute$/,
  };

  it.each(Object.keys(BUILTIN_FLAVOUR_COMMAND_RECIPES))('%s carries the command once, in one argv element, beside its keep-open', (id) => {
    const args = expandCommandRecipe(BUILTIN_FLAVOUR_COMMAND_RECIPES[id]!, RESUME);

    expect(args.filter((a) => a.includes(RESUME))).toHaveLength(1);
    expect(args.some((a) => INTERACTIVE_TAIL[id]!.test(a))).toBe(true);
  });
});
