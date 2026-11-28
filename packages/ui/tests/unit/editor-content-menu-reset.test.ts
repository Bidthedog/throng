/**
 * *Reset Language* in the editor's format rows (055 FR-024b, US6 scenario 7), which the v1 review (#732) moved from
 * the body menu to the panel title menu (`editorFormatItems`, drawn by `panelHeaderMenu`).
 *
 * Every panel action has a menu item, so the reset the status strip offers stays reachable with the status
 * bar hidden. `editorFormatItems` is a pure function over its arguments, so this is a unit test.
 */
import { describe, expect, it, vi } from 'vitest';
import { editorFormatItems } from '../../src/renderer/editor/content-menu.js';

function menu(resetLanguage?: { enabled: boolean; reset: () => void }) {
  return editorFormatItems({ panelId: 'p1', languageName: 'JSON', ...(resetLanguage ? { resetLanguage } : {}) });
}

describe('Reset Language', () => {
  it('sits immediately after Set Language…', () => {
    const labels = menu({ enabled: true, reset: () => {} }).map((item) => item.label);
    const set = labels.indexOf('Set Language… (JSON)');
    expect(set).toBeGreaterThanOrEqual(0);
    expect(labels[set + 1]).toBe('Reset Language');
  });

  it('is enabled while the document has an override, and runs the reset', () => {
    const reset = vi.fn();
    const item = menu({ enabled: true, reset }).find((i) => i.label === 'Reset Language');
    expect(item?.disabled).toBeFalsy();
    item?.onClick();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('is disabled while the document has no override', () => {
    const item = menu({ enabled: false, reset: () => {} }).find((i) => i.label === 'Reset Language');
    expect(item).toBeDefined();
    expect(item?.disabled).toBe(true);
  });
});
