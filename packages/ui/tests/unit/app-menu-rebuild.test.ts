/**
 * When the native app menu is rebuilt (070 FR-027). Every config write broadcasts a payload; rebuilding the menu on
 * each one closes a menu the user has open on macOS and does needless work elsewhere. It is rebuilt only when what the
 * menu shows changed: Settings…'s chord (macOS only — the Help-only menu shows no chord) or whether the `throng`
 * command can be installed.
 */
import { describe, expect, it, vi } from 'vitest';
import { appMenuRebuilder } from '../../src/main/app-menu-template.js';

describe('appMenuRebuilder', () => {
  it('builds once, and an unrelated settings write does not rebuild it', () => {
    const install = vi.fn();
    const rebuild = appMenuRebuilder(install);
    rebuild({ os: 'macos', settingsChord: 'Meta+,', commandLine: true });
    rebuild({ os: 'macos', settingsChord: 'Meta+,', commandLine: true });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when Settings…’s chord is rebound, or the command-line state changes', () => {
    const install = vi.fn();
    const rebuild = appMenuRebuilder(install);
    rebuild({ os: 'macos', settingsChord: 'Meta+,', commandLine: true });
    rebuild({ os: 'macos', settingsChord: 'Meta+;', commandLine: true });
    rebuild({ os: 'macos', settingsChord: undefined, commandLine: true });
    rebuild({ os: 'macos', settingsChord: undefined, commandLine: false });
    expect(install).toHaveBeenCalledTimes(4);
  });

  it('does not rebuild the Help-only menu of Windows and Linux for a chord it never shows', () => {
    const install = vi.fn();
    const rebuild = appMenuRebuilder(install);
    rebuild({ os: 'windows', settingsChord: undefined, commandLine: false });
    rebuild({ os: 'windows', settingsChord: 'Ctrl+,', commandLine: false });
    expect(install).toHaveBeenCalledTimes(1);
  });
});
