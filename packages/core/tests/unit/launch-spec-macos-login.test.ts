import { describe, expect, it } from 'vitest';
import { BUILTIN_FLAVOUR_COMMAND_RECIPES, resolveLaunchSpec } from '@throng/core';
import { withHostTraits } from '@throng/core/testing';

/**
 * 070 FR-017, research R9: on macOS a shell starts as a login shell, as Terminal.app starts it, so a terminal has the
 * user's login environment even when throng was launched from the Dock with launchd's short PATH.
 */
const flavour = (id: string, args: string[] = []) => ({
  id,
  file: `/bin/${id}`,
  args,
  commandRecipe: BUILTIN_FLAVOUR_COMMAND_RECIPES[id],
});

describe('login shells on macOS', () => {
  it.each(['bash', 'zsh', 'fish', 'sh'])('starts %s with -l', (id) => {
    withHostTraits('macos', () => {
      expect(resolveLaunchSpec(flavour(id), '', '/Users/dev/p').args).toEqual(['-l']);
    });
  });

  it('puts -l first, ahead of the shell arguments and of a recipe’s command', () => {
    withHostTraits('macos', () => {
      const spec = resolveLaunchSpec(flavour('zsh', ['-i']), '--no-rcs', '/Users/dev/p', 'npm run dev');
      expect(spec.args[0]).toBe('-l');
      expect(spec.args.slice(1, 3)).toEqual(['-i', '--no-rcs']);
      expect(spec.args.at(-1)).toContain('npm run dev');
    });
  });

  it('does not add a second login switch the user already asked for', () => {
    withHostTraits('macos', () => {
      expect(resolveLaunchSpec(flavour('bash'), '--login', '/Users/dev/p').args).toEqual(['--login']);
      expect(resolveLaunchSpec(flavour('zsh', ['-l']), '', '/Users/dev/p').args).toEqual(['-l']);
    });
  });

  it('leaves a shell throng has no login rule for as it is', () => {
    withHostTraits('macos', () => {
      expect(resolveLaunchSpec(flavour('nu'), '', '/Users/dev/p').args).toEqual([]);
      expect(resolveLaunchSpec({ file: '/opt/x', args: [] }, '', '/Users/dev/p').args).toEqual([]);
    });
  });

  it.each(['dash', 'ksh'])('starts %s with -l too, as Terminal.app would', (id) => {
    withHostTraits('macos', () => {
      expect(resolveLaunchSpec(flavour(id), '', '/Users/dev/p').args).toEqual(['-l']);
    });
  });

  // A Startup Command or shell integration runs through the recipe, whose `exec <shell> -i` replaces the login shell.
  // The shell the user is left at must be a login shell too, or bash never reads ~/.bash_profile.
  it.each([
    ['bash', 'exec bash -il'],
    ['zsh', 'exec zsh -il'],
    ['sh', 'exec sh -il'],
    ['dash', 'exec dash -il'],
    ['ksh', 'exec ksh -il'],
  ])('re-executes %s as a login shell after a startup command', (id, tail) => {
    withHostTraits('macos', () => {
      const spec = resolveLaunchSpec(flavour(id), '', '/Users/dev/p', 'npm run dev');
      expect(spec.args[0]).toBe('-l');
      expect(spec.args.at(-1)).toBe(`trap : INT; npm run dev; ${tail}`);
    });
  });

  it('re-executes a shell the user asked to start with --login as a login shell as well', () => {
    withHostTraits('macos', () => {
      expect(resolveLaunchSpec(flavour('bash'), '--login', '/Users/dev/p', 'ls').args.at(-1)).toBe('trap : INT; ls; exec bash -il');
    });
  });

  // tcsh takes -l only as its sole flag, so it cannot be combined with -i or -c: `exec tcsh -l` is the re-exec (a
  // terminal is a tty, so tcsh is interactive without -i), and a bare tcsh starts with -l alone.
  it('makes tcsh a login shell only where -l is its sole flag', () => {
    withHostTraits('macos', () => {
      expect(resolveLaunchSpec(flavour('tcsh'), '', '/Users/dev/p').args).toEqual(['-l']);
      expect(resolveLaunchSpec(flavour('tcsh'), '-f', '/Users/dev/p').args).toEqual(['-f']);
      const withCommand = resolveLaunchSpec(flavour('tcsh'), '', '/Users/dev/p', 'ls');
      expect(withCommand.args).toEqual(['-c', 'ls; exec tcsh -l']);
    });
  });

  it('leaves a recipe the user wrote themselves as they wrote it', () => {
    withHostTraits('macos', () => {
      const own = { ...flavour('bash'), commandRecipe: ['-c', '{command}; exec bash -i'] };
      expect(resolveLaunchSpec(own, '', '/Users/dev/p', 'ls').args.at(-1)).toBe('ls; exec bash -i');
    });
  });

  it('keeps every Linux and Windows recipe byte-identical (FR-039)', () => {
    withHostTraits('linux', () => {
      expect(resolveLaunchSpec(flavour('bash'), '', '/home/dev/p', 'ls').args).toEqual(['-c', 'trap : INT; ls; exec bash -i']);
      expect(resolveLaunchSpec(flavour('tcsh'), '', '/home/dev/p', 'ls').args).toEqual(['-c', 'ls; exec tcsh -i']);
      expect(resolveLaunchSpec(flavour('dash'), '', '/home/dev/p').args).toEqual([]);
    });
    expect(resolveLaunchSpec(flavour('git-bash'), '', 'C:/p', 'ls').args).toEqual(['-c', 'trap : INT; ls; exec bash -i']);
  });

  it('changes nothing on Linux or Windows (FR-039)', () => {
    withHostTraits('linux', () => {
      expect(resolveLaunchSpec(flavour('zsh'), '', '/home/dev/p').args).toEqual([]);
    });
    expect(resolveLaunchSpec(flavour('bash'), '', 'C:/p').args).toEqual([]);
  });
});
