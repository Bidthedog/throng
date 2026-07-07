import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings, DEFAULT_EXCLUDE_GLOBS } from '@throng/core';

describe('AppSettings explorer section (004 T004/T005)', () => {
  it('defaults to single open, recycle delete, and the VS Code exclude list', () => {
    const e = DEFAULT_APP_SETTINGS.explorer;
    expect(e.openMode).toBe('single');
    expect(e.deleteMode).toBe('recycle');
    expect(e.excludeGlobs).toEqual([...DEFAULT_EXCLUDE_GLOBS]);
  });

  it('fills explorer defaults when the section is absent', () => {
    const s = parseAppSettings({ version: 1 });
    expect(s.explorer).toEqual(DEFAULT_APP_SETTINGS.explorer);
  });

  it('coerces invalid open/delete modes back to defaults', () => {
    const s = parseAppSettings({ explorer: { openMode: 'triple', deleteMode: 'nuke' } });
    expect(s.explorer.openMode).toBe('single');
    expect(s.explorer.deleteMode).toBe('recycle');
  });

  it('accepts a custom open/delete mode', () => {
    const s = parseAppSettings({ explorer: { openMode: 'double', deleteMode: 'permanent' } });
    expect(s.explorer.openMode).toBe('double');
    expect(s.explorer.deleteMode).toBe('permanent');
  });

  it('honours an explicit (even empty) exclude list and drops non-strings', () => {
    expect(parseAppSettings({ explorer: { excludeGlobs: [] } }).explorer.excludeGlobs).toEqual([]);
    expect(
      parseAppSettings({ explorer: { excludeGlobs: ['*.log', 5, '**/tmp'] } }).explorer.excludeGlobs,
    ).toEqual(['*.log', '**/tmp']);
  });

  it('falls back to the default list when excludeGlobs is not an array', () => {
    const s = parseAppSettings({ explorer: { excludeGlobs: 'nope' } });
    expect(s.explorer.excludeGlobs).toEqual([...DEFAULT_EXCLUDE_GLOBS]);
  });

  it('returns a fresh default explorer for a wholly malformed document', () => {
    expect(parseAppSettings(null).explorer).toEqual(DEFAULT_APP_SETTINGS.explorer);
  });

  it('defaults the drag modifiers to Ctrl=copy / Shift=move (Windows-style, FR-095)', () => {
    expect(DEFAULT_APP_SETTINGS.explorer.dragCopyModifier).toBe('ctrl');
    expect(DEFAULT_APP_SETTINGS.explorer.dragMoveModifier).toBe('shift');
  });

  it('accepts custom drag modifiers and coerces invalid ones back to defaults', () => {
    const s = parseAppSettings({ explorer: { dragCopyModifier: 'alt', dragMoveModifier: 'ctrl' } });
    expect(s.explorer.dragCopyModifier).toBe('alt');
    expect(s.explorer.dragMoveModifier).toBe('ctrl');
    const bad = parseAppSettings({ explorer: { dragCopyModifier: 'space', dragMoveModifier: 9 } });
    expect(bad.explorer.dragCopyModifier).toBe('ctrl');
    expect(bad.explorer.dragMoveModifier).toBe('shift');
  });
});
