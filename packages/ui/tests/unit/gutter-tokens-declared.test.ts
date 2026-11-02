/**
 * Hiding the gutter does not make 009's gutter tokens inert (040 US4 — FR-045): the registry and
 * stylesheet halves.
 *
 * Moved from `component/gutter-tokens-live.test.ts`: neither half renders anything. The form half
 * (the Themes editor still offers a live control for each token) stays there. The failure being
 * guarded against and why `getComputedStyle` cannot be used are stated in that file's header.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRAST_PAIRINGS, THEME_METADATA, THRONG_THEME } from '@throng/core';

/** 009's two gutter tokens, by the colour keys a theme document writes. */
const TOKENS = ['editorGutterBg', 'editorGutterFg'] as const;

const EDITOR_CSS = resolve(process.cwd(), 'packages/ui/src/renderer/editor/editor.css');

/* ────────────────────────────────────────────────────────────────────────── *
 * Declared — the registry still carries both, with their copy
 * ────────────────────────────────────────────────────────────────────────── */

describe('the gutter tokens are still declared (FR-045)', () => {
  it('keeps a descriptor for each, with a label and a description', () => {
    for (const token of TOKENS) {
      const descriptor = THEME_METADATA.find((d) => d.key === `colours.${token}`);
      expect(descriptor, `no theme descriptor for colours.${token}`).toBeDefined();
      expect(descriptor?.label.length, token).toBeGreaterThan(0);
      expect(descriptor?.description.length, token).toBeGreaterThan(0);
    }
  });

  it('keeps a shipped value for each in the default theme', () => {
    for (const token of TOKENS) {
      expect(THRONG_THEME.colours[token], token).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('keeps measuring the gutter contrast pair', () => {
    /*
     * 009's promise that the line numbers are READABLE on every bundled theme is enforced by this
     * pairing and by nothing else. A setting that can hide the gutter is the obvious excuse to stop
     * measuring it — and the moment it is turned back on, an unmeasured theme is one nobody checked.
     */
    const pair = CONTRAST_PAIRINGS.find(
      (p) => p.fg === 'editorGutterFg' && p.bg === 'editorGutterBg',
    );
    expect(pair, 'the gutter pairing was dropped from the theme quality audit').toBeDefined();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Consumed — the stylesheet rule that repaints the gutter still reads them
 * ────────────────────────────────────────────────────────────────────────── */

describe('the stylesheet still paints the gutter from those tokens (FR-045)', () => {
  it('declares .cm-gutters against both custom properties', () => {
    /*
     * Read as TEXT rather than through `getComputedStyle`, because jsdom does not substitute
     * `var()`: the claim here is that the RULE still names the tokens, which is what makes turning
     * the gutter back on restore the user's colours rather than the built-in fallbacks.
     */
    expect(existsSync(EDITOR_CSS), `editor.css was not found at ${EDITOR_CSS}`).toBe(true);
    const css = readFileSync(EDITOR_CSS, 'utf8');
    const rule = /\.editor-panel \.cm-gutters\s*\{[^}]*\}/.exec(css)?.[0];
    expect(rule, 'the .cm-gutters rule is gone from editor.css').toBeDefined();
    expect(rule).toContain('--throng-colour-editorGutterBg');
    expect(rule).toContain('--throng-colour-editorGutterFg');
  });
});
