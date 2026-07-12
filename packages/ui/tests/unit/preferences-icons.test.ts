/**
 * No hard-coded icon graphics anywhere in the preferences window (015, FR-009b/SC-014;
 * constitution v3.12.0, "Action controls MUST be themeable icons with hover titles").
 *
 * The v3.12.0 amendment recorded these files as KNOWN VIOLATIONS, to be remediated by "the next
 * change that touches those controls" — feature 015 is that change.
 *
 * This scans **every** component in the preferences directory, not a hand-listed few. The first
 * version of this test listed only the three files the feature happened to edit, and passed while
 * `form-controls.tsx` still rendered a hard-coded ↑ / ↓ / ✕ on every array row — the guard was
 * shaped like the change instead of like the requirement. A guard that excludes what it has not
 * looked at is not a guard.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { ROW_ACTION_TOKENS } from '../../src/renderer/preferences/row-action-tokens.js';

const here = dirname(fileURLToPath(import.meta.url));
const prefsDir = join(here, '..', '..', 'src', 'renderer', 'preferences');
const read = (file: string): string => readFileSync(join(prefsDir, file), 'utf8');

/** Every component in the preferences window — discovered, never enumerated by hand. */
const COMPONENTS = readdirSync(prefsDir).filter((f) => f.endsWith('.tsx'));

/** Glyphs that used to be typed straight into the markup as an action control's face. */
const HARD_CODED_GLYPHS = ['↑', '↓', '✕', '×', '↻', '⎌'];

describe('every icon in the preferences window is themeable', () => {
  it('finds the components to scan', () => {
    expect(COMPONENTS.length).toBeGreaterThan(5);
    expect(COMPONENTS).toContain('form-controls.tsx');
  });

  for (const file of COMPONENTS) {
    it(`${file} renders no inline SVG`, () => {
      expect(read(file), `${file} hard-codes an icon as inline SVG`).not.toContain('<svg');
    });

    it(`${file} renders no hard-coded glyph as a control's face`, () => {
      const src = read(file);
      for (const glyph of HARD_CODED_GLYPHS) {
        expect(src, `${file} hard-codes the glyph ${glyph} — it belongs in a theme token`).not.toContain(glyph);
      }
    });
  }

  it('the toolbar reset affordances use the restore tokens feature 014 already ships', () => {
    // `retry` = restore ONE thing; `restoreAll` = restore everything. Reusing 014's distinction
    // keeps the two toolbar reset controls tellable apart at a glance.
    const shell = read('preferences-app.tsx');
    expect(shell).toContain('token="restoreAll"');
    expect(shell).toContain('token="retry"');
  });

  it('the three row actions use three DISTINCT tokens', () => {
    // Reset, revert and clear answer different questions — "what does Throng ship?", "what did I
    // open this window with?", "nothing, thanks" — and all three sit side by side on every row,
    // at all times. Two of them sharing a glyph would make the row lie about what a click does
    // (FR-013), and there is nowhere to hide that: they are never not on screen.
    //
    // Asserted against the EXPORTED map, not against the source text. Two earlier versions of
    // this guard grepped `row-actions.tsx` — one broke when the tokens became function arguments,
    // and one passed locally but matched NOTHING on CI, where a Windows checkout has CRLF line
    // endings and the regex was written around `\n`. It then cheerfully asserted an empty object
    // against nothing. A guard that can pass on your machine and fail on CI for a reason
    // unrelated to the behaviour is not a guard.
    expect(ROW_ACTION_TOKENS).toEqual({ revert: 'revert', reset: 'retry', clear: 'destroy' });
    expect(new Set(Object.values(ROW_ACTION_TOKENS)).size).toBe(3);
  });

  it('every row-action token is a real token in the shipped theme', () => {
    // A token that does not exist resolves to an empty glyph, so the button would render blank —
    // present, clickable, and invisible.
    for (const token of Object.values(ROW_ACTION_TOKENS)) {
      expect(Object.keys(THRONG_THEME.icons)).toContain(token);
    }
  });

  it('the tabs render their row actions through the shared gutter, not their own icons', () => {
    // The affordances live in ONE component (FR-015: they also have to share a gutter that holds
    // its width). A tab that grew its own copy would drift — different tokens, different titles,
    // and eventually a different placement.
    for (const file of ['settings-tab.tsx', 'keybindings-tab.tsx', 'themes-tab.tsx']) {
      expect(read(file), `${file} should delegate its row affordances`).toContain('<RowActions');
    }
  });

  it('the UI⇄JSON mode toggle renders theme tokens, not the text "{ }" / "UI"', () => {
    const src = read('preferences-app.tsx');
    expect(src).toContain("'editJson'");
    expect(src).toContain("'editVisual'");
    expect(src).not.toContain("{mode === 'ui' ? '{ }' : 'UI'}");
  });

  it('the array editor reorders and removes through theme tokens', () => {
    const src = read('form-controls.tsx');
    expect(src).toContain('token="moveUp"');
    expect(src).toContain('token="moveDown"');
    expect(src).toContain('token="destroy"');
    expect(src).toContain('token="add"'); // "+ Add" was a text-labelled action control
  });
});
