/**
 * 073 FR-036f — the cell dialog's editor is themed exactly as an editor panel is (maintainer, 2026-11-20: "The CSV editor
 * dialog should be themed like a normal throng editor. At present, the text is hard to read because of the background,
 * and impossible to read when highlighted").
 *
 * An editor panel's colours — background, text, gutter, caret, active line, focused and unfocused selection — are
 * `editor.css`'s rules, every one keyed on `.editor-panel` and read from the theme's `editor*` tokens. The dialog's
 * CodeMirror view sat outside that scope, so it drew CodeMirror's own defaults: a light selection over the dark editor
 * background. jsdom applies no stylesheet, so what is pinned here is the scope: the dialog's view lies inside an
 * `.editor-panel`, and nothing in the dialog's own stylesheet colours the view. That the cascade then delivers the same
 * computed colours as a panel, theme by theme, was checked in the running app (commit message).
 *
 * Layer: component — the dialog mounted whole, its CodeMirror view real; the stylesheets read as text.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CellDialog } from '../../src/renderer/grid/cell-dialog.js';

const RENDERER = join(__dirname, '../../src/renderer');

afterEach(() => {
  document.body.replaceChildren();
});

describe('the cell dialog\'s editor wears the editor panel\'s theme (073 FR-036f)', () => {
  it('its CodeMirror view lies inside the scope editor.css themes an editor panel by', async () => {
    render(createElement(CellDialog, { cellLabel: 'B3', initial: 'text', json: false, onSave: vi.fn(), onCancel: vi.fn() }));
    const view = await waitFor(() => {
      const el = screen.getByTestId('cell-dialog').querySelector<HTMLElement>('.cm-editor');
      if (el === null) throw new Error('no editor yet');
      return el;
    });
    expect(view.closest('.editor-panel')).not.toBeNull();
  });

  it('editor.css colours every part of a panel\'s view under that scope, from the theme\'s editor tokens', () => {
    const css = readFileSync(join(RENDERER, 'editor/editor.css'), 'utf8');
    for (const part of ['.cm-editor', '.cm-gutters', '.cm-cursor', '.cm-selectionBackground', '.cm-activeLine']) {
      expect(css, part).toMatch(new RegExp(`\\.editor-panel [^{]*\\${part}`));
    }
    expect(css).toMatch(/\.editor-panel \.cm-editor:not\(\.cm-focused\) \.cm-selectionBackground[^}]*--throng-colour-editorSelectionInactive/);
  });

  it('the dialog\'s own stylesheet gives the view no colours of its own', () => {
    const css = readFileSync(join(RENDERER, 'grid/cell-dialog.css'), 'utf8');
    expect(css).not.toMatch(/\.cm-[\w-]+[^{]*\{[^}]*(?:background|color)\s*:/);
  });
});
