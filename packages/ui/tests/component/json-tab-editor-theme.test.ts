/**
 * 007 FR-021a — the Preferences JSON editors are themed exactly as an editor panel is. Found while fixing the same defect
 * in the cell dialog (073 FR-036f): the JSON tab's CodeMirror view sat outside `editor.css`'s `.editor-panel` scope, so
 * it drew CodeMirror's defaults. Measured in the running app (throng, Light, Matrix): a transparent background, a black
 * caret, a light grey gutter and a pale lavender selection in every theme; inside `.editor-panel`, every colour matched
 * an editor panel's.
 *
 * jsdom applies no stylesheet, so what is pinned is the scope, and the layout rule that keeps the editor filling the tab.
 *
 * Layer: component — the JSON tab's markup checked against its stylesheets, read as text.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER = join(__dirname, '../../src/renderer');

describe('the Preferences JSON editors wear the editor panel\'s theme (007 FR-021a)', () => {
  it('the JSON tab mounts its editor inside the scope editor.css themes an editor panel by', () => {
    const tab = readFileSync(join(RENDERER, 'preferences/json-tab.tsx'), 'utf8');
    expect(tab).toMatch(/<div className="editor-panel">\s*<StandaloneEditor\b/);
  });

  it('that scope is a column in the tab, so the editor still fills it and scrolls within it', () => {
    const css = readFileSync(join(RENDERER, 'preferences/preferences.css'), 'utf8');
    expect(css).toMatch(/\.json-tab > \.editor-panel \{[^}]*display: flex;[^}]*flex-direction: column;/);
  });

  it('the preferences stylesheet gives the view no colours of its own', () => {
    const css = readFileSync(join(RENDERER, 'preferences/preferences.css'), 'utf8');
    expect(css).not.toMatch(/\.cm-[\w-]+[^{]*\{[^}]*(?:background|color)\s*:/);
  });
});
