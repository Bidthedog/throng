import { describe, it, expect } from 'vitest';
import {
  createOpenRegistry,
  isOpenAnywhere,
  openOrFocus,
  registerOpen,
  unregisterPath,
  unregisterPanel,
} from '../../src/editor/open-registry.js';

describe('app-wide open-document registry (006, FR-011a)', () => {
  it('a fresh path opens; once registered it focuses the existing editor', () => {
    const reg = createOpenRegistry();
    expect(openOrFocus(reg, 'C:/proj/a.ts')).toEqual({ action: 'open' });

    registerOpen(reg, 'C:/proj/a.ts', { panelId: 'p1', windowId: 'w1' });
    expect(openOrFocus(reg, 'C:/proj/a.ts')).toEqual({
      action: 'focus',
      panelId: 'p1',
      windowId: 'w1',
    });
  });

  it('matches paths case/separator-insensitively (no duplicate buffer)', () => {
    const reg = createOpenRegistry();
    registerOpen(reg, 'C:/proj/a.ts', { panelId: 'p1', windowId: 'w1' });
    expect(isOpenAnywhere(reg, 'C:\\PROJ\\a.ts')).toBe(true);
    expect(openOrFocus(reg, 'c:/proj/a.ts')).toMatchObject({ action: 'focus', panelId: 'p1' });
  });

  it('isOpenAnywhere drives Open-In disabling', () => {
    const reg = createOpenRegistry();
    expect(isOpenAnywhere(reg, 'C:/proj/a.ts')).toBe(false);
    registerOpen(reg, 'C:/proj/a.ts', { panelId: 'p1', windowId: 'w1' });
    expect(isOpenAnywhere(reg, 'C:/proj/a.ts')).toBe(true);
  });

  it('unregisterPath frees the file for a fresh open', () => {
    const reg = createOpenRegistry();
    registerOpen(reg, 'C:/proj/a.ts', { panelId: 'p1', windowId: 'w1' });
    unregisterPath(reg, 'C:/proj/a.ts');
    expect(openOrFocus(reg, 'C:/proj/a.ts')).toEqual({ action: 'open' });
  });

  it('unregisterPanel removes every path owned by a destroyed panel', () => {
    const reg = createOpenRegistry();
    registerOpen(reg, 'C:/proj/a.ts', { panelId: 'p1', windowId: 'w1' });
    registerOpen(reg, 'C:/proj/b.ts', { panelId: 'p1', windowId: 'w1' });
    registerOpen(reg, 'C:/proj/c.ts', { panelId: 'p2', windowId: 'w1' });
    unregisterPanel(reg, 'p1');
    expect(isOpenAnywhere(reg, 'C:/proj/a.ts')).toBe(false);
    expect(isOpenAnywhere(reg, 'C:/proj/b.ts')).toBe(false);
    expect(isOpenAnywhere(reg, 'C:/proj/c.ts')).toBe(true);
  });
});
