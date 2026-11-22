import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Constitution v6.7.0, "One popup style" — every tooltip, hover popover, hint, indicator and confirmation is drawn by
 * the ONE shared popup class (`.throng-popup`, theme.css), and the OS never draws a `title` tooltip.
 *
 * Three ways the rule breaks, each caught here:
 *  1. a popup's own stylesheet rule restyles it — a background, a border, a radius, a padding, a font size or a
 *     shadow of its own — so it drifts from the others again (the state #637's review found: two families, five
 *     radii and paddings, four shadows);
 *  2. a popup's root element stops wearing the shared class, so it renders unstyled;
 *  3. a window stops mounting the title tooltip, so the OS's tooltip comes back.
 *
 * A NEW popup is added to POPUPS in the change that adds it. The floating-surfaces guard
 * (`floating-surfaces.test.ts`) discovers every floating surface and makes someone register it; whether that
 * surface is a popup is the question this list answers.
 */

const RENDERER = fileURLToPath(new URL('../../src/renderer', import.meta.url));

/** Each popup's class, and the file that renders its root element. */
const POPUPS: Readonly<Record<string, string>> = {
  'tabstrip-popover': 'workspace/tab-popover.tsx',
  'attention-popover': 'attention/attention-popover.tsx',
  'notification-place-popover': 'notifications/place-popover.tsx',
  'status-popover': 'resources/status-popover.tsx',
  'info-helper-popover': 'common/help-tip.tsx',
  'monitor-help': 'resources/help-panel.tsx',
  'cm-ws-hover-name': 'editor/view-whitespace.ts',
  'link-hint': 'links/link-hint.tsx',
  'editor-pending-chord': 'editor/pending-chord.tsx',
  'zoom-indicator': 'workspace/zoom-indicator.tsx',
  'tree-drag-label': 'explorer/drag-action-label.tsx',
  'title-tooltip': 'common/title-tooltips.tsx',
};

/** What only the shared class may say. Placement, width, wrapping and pointer behaviour stay each popup's own. */
const SHARED_LOOK = /^(background(-color)?|color|border(-width|-style|-radius)?|padding(-\w+)?|box-shadow|font-size|line-height)$/;

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, match));
    else if (match.test(entry)) out.push(path);
  }
  return out;
}

/** Every rule whose selector names `cls` as a whole class token on its subject or anywhere in the selector. */
function rulesNaming(cls: string): { file: string; selector: string; props: string[] }[] {
  const token = new RegExp(`\\.${cls.replace(/[-]/g, '\\-')}(?![\\w-])`);
  const out: { file: string; selector: string; props: string[] }[] = [];
  for (const file of walk(RENDERER, /\.css$/)) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (match[1] ?? '').trim();
      if (selector.startsWith('@') || !token.test(selector)) continue;
      const props = [...(match[2] ?? '').matchAll(/([\w-]+)\s*:/g)].map((m) => m[1] ?? '');
      out.push({ file: file.slice(RENDERER.length + 1), selector, props });
    }
  }
  return out;
}

describe('one popup style (constitution v6.7.0)', () => {
  it('the shared class carries the whole look, from the popup tokens', () => {
    const theme = readFileSync(join(RENDERER, 'theme.css'), 'utf8');
    const rule = /\n\.throng-popup\s*\{([^}]*)\}/.exec(theme)?.[1] ?? '';
    for (const decl of [
      'background: var(--throng-popup-bg)',
      'color: var(--throng-popup-fg)',
      'border: 1px solid var(--throng-popup-border)',
      'border-radius: var(--throng-popup-radius)',
      'padding: var(--throng-popup-padding)',
      'box-shadow: var(--throng-popup-shadow)',
    ]) {
      expect(rule, `.throng-popup is missing \`${decl}\``).toContain(decl);
    }
    expect(rule).toMatch(/animation: throng-popup-in var\(--throng-popup-fade-in\)/);
  });

  for (const [cls, source] of Object.entries(POPUPS)) {
    it(`.${cls} keeps no look of its own, and its root wears the shared class`, () => {
      const offending = rulesNaming(cls).flatMap(({ file, selector, props }) =>
        // A modifier on the subject may change ONE thing for a reason — the failed copy's border colour.
        props.filter((p) => SHARED_LOOK.test(p)).map((p) => `${file}: ${selector} { ${p} }`),
      );
      expect(offending, `restyles the shared popup — move the value to .throng-popup or drop it`).toEqual([]);
      const src = readFileSync(join(RENDERER, source), 'utf8');
      // The shared class first, then this one, within one class list — a string or an array of names.
      expect(src, `${source} renders .${cls} without the shared class`).toMatch(
        new RegExp(`throng-popup['"\`]?,?\\s*['"\`]?${cls.replace(/-/g, '\\-')}(?![\\w-])`),
      );
    });
  }

  it('every window mounts the title tooltip, at the entry every window kind shares', () => {
    const entry = readFileSync(join(RENDERER, 'main.tsx'), 'utf8');
    expect(entry).toContain('<WindowPopups />');
    const popups = readFileSync(join(RENDERER, 'common/window-popups.tsx'), 'utf8');
    for (const part of ['installTitleTooltips()', '<TitleTooltipHost />']) {
      expect(popups).toContain(part);
    }
  });
});
