import { describe, expect, it } from 'vitest';
import { shippedBindingsFor } from '@throng/core';
import { chordCandidates } from '../../src/renderer/config/chord-key.js';

/**
 * 062 T032. Chromium on X11 reports AltGr as `AltGraph` with `ctrlKey` and `altKey` clear, where Windows reports Ctrl+Alt.
 * So on Linux no chord can be mistaken for the character it types, and the character reaches the focused surface.
 */
describe('AltGr on Linux', () => {
  const candidates = chordCandidates({ key: '@', code: 'KeyQ', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });

  it('adds no modifier to what it types', () => {
    expect(candidates.join(' ')).not.toMatch(/Ctrl|Alt/);
  });

  it('matches no shipped Linux binding', () => {
    const bound = new Set(Object.values(shippedBindingsFor('linux').bindings).flat());
    expect(candidates.filter((c) => bound.has(c))).toEqual([]);
  });
});
