/**
 * 080 FR-048, FR-051 — the Help window's two decisions: which key press steps its history, and where the guide's
 * view sits below the toolbar.
 *
 * Layer: unit — pure functions.
 */
import { describe, expect, it } from 'vitest';

import { historyStepFor, viewBoundsFor } from '../../src/main/help-window-model.js';

const key = (key: string, mods: Partial<{ alt: boolean; control: boolean; meta: boolean; shift: boolean }> = {}) => ({
  type: 'keyDown',
  key,
  alt: false,
  control: false,
  meta: false,
  shift: false,
  ...mods,
});

describe('historyStepFor (FR-051)', () => {
  it('steps back on Alt+Left and forward on Alt+Right', () => {
    expect(historyStepFor(key('ArrowLeft', { alt: true }))).toBe('back');
    expect(historyStepFor(key('ArrowRight', { alt: true }))).toBe('forward');
  });

  it('leaves every other press to the page', () => {
    expect(historyStepFor(key('ArrowLeft'))).toBeUndefined();
    expect(historyStepFor(key('ArrowLeft', { alt: true, shift: true }))).toBeUndefined();
    expect(historyStepFor(key('ArrowLeft', { alt: true, control: true }))).toBeUndefined();
    expect(historyStepFor({ ...key('ArrowLeft', { alt: true }), type: 'keyUp' })).toBeUndefined();
    expect(historyStepFor(key('a', { alt: true }))).toBeUndefined();
  });
});

describe('viewBoundsFor (FR-048)', () => {
  it('fills the content area below the toolbar', () => {
    expect(viewBoundsFor({ width: 1100, height: 800 }, 72)).toEqual({ x: 0, y: 72, width: 1100, height: 728 });
  });

  it('never gives a negative height, whatever the toolbar reports', () => {
    expect(viewBoundsFor({ width: 400, height: 50 }, 72)).toEqual({ x: 0, y: 50, width: 400, height: 0 });
    expect(viewBoundsFor({ width: 400, height: 300 }, -5)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });
});
