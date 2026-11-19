/**
 * 055 SC-002 — the Resource Monitor window is shown, loading state and all, within 1 s of the click. A
 * profile of its cold open (Linux, 2026-11-19) put ~65 ms of the renderer's script time in deriving the
 * fourteen bundled themes while `@throng/core` was imported — before any window could paint, in every
 * window, for themes the window never shows. So the themes are derived on first read: importing the
 * module measures no colour, and reading or enumerating the record still gives every theme, the same
 * object on every read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const measured = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../src/config/theme-quality.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/config/theme-quality.js')>();
  return {
    ...real,
    ciede2000: (...args: Parameters<typeof real.ciede2000>) => {
      measured.count++;
      return real.ciede2000(...args);
    },
  };
});

afterEach(() => {
  measured.count = 0;
  vi.resetModules();
});

describe('the bundled themes are derived on first read, not at import (055 SC-002)', () => {
  it('importing the default themes measures no colour', async () => {
    await import('../../src/config/default-themes/index.js');
    expect(measured.count).toBe(0);
  });

  it('reading one theme derives that theme, and reads after it return the same object', async () => {
    const { DEFAULT_THEMES } = await import('../../src/config/default-themes/index.js');
    const light = DEFAULT_THEMES.Light;
    expect(light?.name).toBe('Light');
    expect(measured.count).toBeGreaterThan(0);
    const after = measured.count;
    expect(DEFAULT_THEMES.Light).toBe(light);
    expect(measured.count).toBe(after);
  });

  it('enumerating still gives every theme, throng first in the full set', async () => {
    const { DEFAULT_THEMES, ALL_DEFAULT_THEMES } = await import('../../src/config/default-themes/index.js');
    expect(Object.keys(DEFAULT_THEMES)).toHaveLength(14);
    expect(Object.keys(ALL_DEFAULT_THEMES)[0]).toBe('throng');
    expect(Object.keys(ALL_DEFAULT_THEMES)).toEqual(['throng', ...Object.keys(DEFAULT_THEMES)]);
    for (const [name, theme] of Object.entries(DEFAULT_THEMES)) {
      expect(theme.name).toBe(name);
      expect(ALL_DEFAULT_THEMES[name]).toBe(theme);
    }
    expect({ ...ALL_DEFAULT_THEMES }.Matrix).toBe(DEFAULT_THEMES.Matrix);
  });
});
