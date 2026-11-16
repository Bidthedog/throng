import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THRONG_THEME, TOKEN_PARENT } from '@throng/core';

/**
 * Constitution, *Toast controls* (069 FR-050): every button a notice offers sits in the card's one
 * control group at its top-right — the notice's own controls, then Copy, then Dismiss — and never
 * inside its content. A notice's \`body\` that holds a button puts that button wherever the text
 * happens to end, a different place on every card.
 *
 * Layer: unit — a source scan. The rule is about what every call site PASSES, and the only complete
 * list of call sites is the source; a component test would cover only the notices it happened to mount.
 */
const RENDERER = join(__dirname, '../../src/renderer');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.tsx?$/.test(e.name) ? [path] : [];
  });
}

/** The expression after `body:`, up to the next property or the end of the object. */
function bodyExpression(text: string, from: number): string {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]!;
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) {
      if (depth === 0) return text.slice(from, i);
      depth -= 1;
    } else if (ch === ',' && depth === 0) return text.slice(from, i);
  }
  return text.slice(from);
}

/** The initialiser of `const <name> ... =`, when a body is passed as a variable. */
function initialiser(text: string, name: string): string {
  const at = new RegExp(`const ${name}\\b[^=]*=`).exec(text);
  return at ? bodyExpression(text, at.index + at[0].length) : '';
}

const HOLDS_A_BUTTON = /<IconButton\b|<button\b/;

describe('toast controls (constitution; 069 FR-050)', () => {
  it('no notice passes a button in its body: every button goes in `controls`', () => {
    const offenders: string[] = [];
    for (const file of sources(RENDERER)) {
      const text = readFileSync(file, 'utf8');
      if (!/\bnotify\(|\bupdate\(/.test(text)) continue;
      for (const m of text.matchAll(/\bbody:\s*/g)) {
        const expr = bodyExpression(text, m.index! + m[0].length).trim();
        const resolved = /^[A-Za-z_$][\w$]*$/.test(expr) ? initialiser(text, expr) : expr;
        if (HOLDS_A_BUTTON.test(resolved)) {
          const line = text.slice(0, m.index).split('\n').length;
          offenders.push(`${relative(RENDERER, file)}:${line}`);
        }
      }
    }
    expect(offenders, 'move these buttons into the notice\'s `controls`').toEqual([]);
  });

  it('the scan sees a button passed as a body variable (a guard that cannot fail proves nothing)', () => {
    const text = 'const open = (\n  <IconButton token="x" />\n);\nnotify({ message: "m", body: open, testId: "t" });';
    const at = text.indexOf('body:') + 'body: '.length;
    expect(HOLDS_A_BUTTON.test(initialiser(text, bodyExpression(text, at).trim()))).toBe(true);
  });
});

describe('the control groups are spaced and every control has a hover surface (069 FR-051)', () => {
  const theme = readFileSync(join(RENDERER, 'theme.css'), 'utf8');
  const panel = readFileSync(join(RENDERER, 'notifications/notifications.css'), 'utf8');
  const block = (css: string, selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };

  it('spaces a toast\'s control group and a panel entry\'s alike', () => {
    expect(block(theme, '.notice__controls')).toMatch(/gap:\s*6px/);
    expect(block(panel, '.notification-entry__controls')).toMatch(/gap:\s*6px/);
  });

  // The defect the maintainer saw: the panel's controls shaded and the toasts' did not. `hoverSurface` falls back to
  // `surface`, and a toast card is `surface`, so the shared wash drew the card's own colour over itself.
  it('washes a toast\'s controls in a colour that differs from the card, since hoverSurface defaults to the card\'s surface', () => {
    expect(TOKEN_PARENT.hoverSurface).toBe('surface');
    expect(THRONG_THEME.colours.hoverSurface).toBe(THRONG_THEME.colours.surface);
    const toastHover =
      /\.notice :is\(\.notice__control, \.notice__copy, \.notice__dismiss\):hover:not\(:disabled\) \{\s*background: ([^;]+);/.exec(theme);
    expect(toastHover?.[1]).toBe('color-mix(in srgb, currentColor 16%, transparent)');
  });

  it('lifts Copy, Dismiss and a notice\'s own controls onto the hover surface, not only a colour change', () => {
    expect(theme).toMatch(
      /:is\(\.notice__control, \.notice__copy, \.notice__dismiss\):hover:not\(:disabled\) \{\s*background: var\(--throng-colour-hoverSurface\)/,
    );
  });
});
