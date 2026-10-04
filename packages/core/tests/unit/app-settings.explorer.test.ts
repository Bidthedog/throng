import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings, DEFAULT_EXCLUDE_GLOBS } from '@throng/core';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

describe('AppSettings explorer section (004 T004/T005)', () => {
  it('defaults to recycle delete and the VS Code exclude list', () => {
    const e = DEFAULT_APP_SETTINGS.explorer;
    expect(e.deleteMode).toBe('recycle');
    expect(e.excludeGlobs).toEqual([...DEFAULT_EXCLUDE_GLOBS]);
  });

  it('fills explorer defaults when the section is absent', () => {
    const s = parseAppSettings({ version: 1 });
    expect(s.explorer).toEqual(DEFAULT_APP_SETTINGS.explorer);
  });

  it('coerces an invalid delete mode back to the default', () => {
    const s = parseAppSettings({ explorer: { deleteMode: 'nuke' } });
    expect(s.explorer.deleteMode).toBe('recycle');
  });

  it('accepts a custom delete mode', () => {
    const s = parseAppSettings({ explorer: { deleteMode: 'permanent' } });
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

  it('follows the active editor by default, and honours an explicit false (#188)', () => {
    expect(DEFAULT_APP_SETTINGS.explorer.autoRevealActiveFile).toBe(true);
    expect(parseAppSettings({ explorer: { autoRevealActiveFile: false } }).explorer.autoRevealActiveFile).toBe(
      false,
    );
  });

  it('replaces into the Recycle Bin by default, and accepts permanent (050 FR-018f)', () => {
    expect(DEFAULT_APP_SETTINGS.explorer.replaceMode).toBe('recycle');
    expect(parseAppSettings({ explorer: { replaceMode: 'permanent' } }).explorer.replaceMode).toBe('permanent');
  });

  it('coerces an invalid replace mode back to the default, independent of the delete mode (050 FR-018f)', () => {
    const s = parseAppSettings({ explorer: { replaceMode: 'nuke', deleteMode: 'permanent' } });
    expect(s.explorer.replaceMode).toBe('recycle');
    expect(s.explorer.deleteMode).toBe('permanent');
  });

  it('describes the replace mode directly after the delete mode (050 FR-018f "shown beside it")', () => {
    const keys = SETTINGS_METADATA.map((d) => d.key);
    expect(keys.indexOf('explorer.replaceMode')).toBe(keys.indexOf('explorer.deleteMode') + 1);
    const d = SETTINGS_METADATA.find((m) => m.key === 'explorer.replaceMode');
    expect(d?.allowedValues).toEqual(['recycle', 'permanent']);
    expect(d?.group).toBe('File Explorer');
  });

  it('coerces a non-boolean follow setting back to the default (#188)', () => {
    // 'false' the STRING is the classic hand-edit; it must not read as "off" by being truthy, nor
    // silently disable the feature by being falsy.
    expect(parseAppSettings({ explorer: { autoRevealActiveFile: 'false' } }).explorer.autoRevealActiveFile).toBe(
      true,
    );
  });
});
