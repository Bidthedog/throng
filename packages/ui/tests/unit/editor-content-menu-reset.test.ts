/**
 * *Reset Language* in the editor content menu (055 FR-024b, US6 scenario 7).
 *
 * Every panel action has a menu item, so the reset the status strip offers stays reachable with the status
 * bar hidden. `editorContentMenu` is a pure function over its arguments, so this is a unit test; the
 * two-member view stand-in is the one `menu-sections.test.ts` uses.
 */
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { editorContentMenu } from '../../src/renderer/editor/content-menu.js';

const noop = (): void => {};

function menu(resetLanguage?: { enabled: boolean; reset: () => void }) {
  return editorContentMenu({
    view: {} as EditorView,
    panelId: 'p1',
    viewId: 'v1',
    lineEnding: () => 'lf',
    wordWrap: { on: false, toggle: noop },
    gotoLine: { open: noop },
    languageName: 'JSON',
    resetLanguage,
  });
}

describe('Reset Language', () => {
  it('sits immediately after Set Language…', () => {
    const labels = menu({ enabled: true, reset: noop }).map((item) => item.label);
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
    const item = menu({ enabled: false, reset: noop }).find((i) => i.label === 'Reset Language');
    expect(item).toBeDefined();
    expect(item?.disabled).toBe(true);
  });
});
