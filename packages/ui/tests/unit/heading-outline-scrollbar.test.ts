import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_DEFAULT_THEMES, THRONG_THEME, contrastRatio, type Theme } from '@throng/core';

/**
 * 047 FR-079 (MT-04, research R20) — the Go to Heading pop-down's background must differ visibly from its
 * scrollbar thumb, on every shipped theme.
 *
 * The pop-down paints `surfaceActive` (a floating surface — `surface-token-roles.test.ts`) and the global
 * scrollbar thumb is `scrollbarThumb`; on the default theme those are `#222c3d` against `#2a3344`, nearly one
 * colour, and on `Windows Terminal`, `Claude`, `Debian` and `Ubuntu` they are the IDENTICAL hex.
 *
 * ══ THE MEASUREMENT (T082) ══
 *
 * R20 named four candidate pairs — `surface`/`sidebarBg` against `scrollbarThumb`/`border` — and asked for the
 * first that clears 1.5:1 everywhere. Measured over the eleven shipped themes plus Throng's own, NONE does:
 * the best worst-case is `sidebarBg` on `scrollbarThumb` and on `border` at 1.18:1 (Debian), `surface` at
 * 1.003:1 (Debian). `scrollbarThumb` and `border` are also equal on every theme measured, so they are one
 * candidate, not two. Widening to every existing colour token, the ones that clear 1.5:1 against
 * `surfaceActive` everywhere are the foreground and accent tokens; the quietest neutral one is `textMuted`
 * (worst case 3.20:1, VSCode), which also clears the 3:1 non-text floor. So the pop-down keeps its
 * `surfaceActive` background and its list's thumb is `textMuted`, over a transparent track so the thumb is
 * read against the pop-down itself and not against `scrollbarTrack`.
 *
 * The 1.5:1 floor is derived, not confirmed by the user (FR-079).
 */
const FLOOR = 1.5;

const CSS = readFileSync(
  fileURLToPath(new URL('../../src/renderer/preview/heading-outline.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ');

/** The `--throng-colour-<token>` a rule's `background` names, or undefined when the rule is absent. */
function backgroundTokenOf(selector: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (!rule) return undefined;
  return /background\s*:\s*var\(--throng-colour-([A-Za-z0-9]+)/.exec(rule[1]!)?.[1];
}

const themes: Record<string, Theme> = { throng: THRONG_THEME, ...ALL_DEFAULT_THEMES };

describe('the Go to Heading pop-down background vs its scrollbar thumb (FR-079, R20)', () => {
  const surfaceToken = backgroundTokenOf('.heading-outline');
  const thumbToken = backgroundTokenOf('.heading-outline__list::-webkit-scrollbar-thumb');

  it('names both colours from theme tokens (guard: the checks below are not vacuous)', () => {
    expect(surfaceToken, 'the pop-down paints its background from a token').toBeDefined();
    expect(thumbToken, 'the pop-down list has its own scrollbar-thumb rule, from a token').toBeDefined();
    expect(Object.keys(themes).length).toBeGreaterThan(10);
  });

  it('the thumb token is not the token the pop-down paints', () => {
    expect(thumbToken).toBeDefined();
    expect(thumbToken).not.toBe(surfaceToken);
  });

  it(`clears ${FLOOR}:1 on every shipped theme`, () => {
    const failing: string[] = [];
    for (const [name, theme] of Object.entries(themes)) {
      const colours = theme.colours as unknown as Record<string, string | undefined>;
      const bg = colours[surfaceToken ?? ''];
      const thumb = colours[thumbToken ?? ''];
      if (!bg || !thumb) {
        failing.push(`${name}: ${surfaceToken} / ${thumbToken} not both set`);
        continue;
      }
      const ratio = contrastRatio(bg, thumb);
      if (ratio < FLOOR) failing.push(`${name}: ${ratio.toFixed(2)}:1 (${bg} on ${thumb})`);
    }
    expect(failing).toEqual([]);
  });

  it('the list track is transparent, so the thumb is read against the pop-down and not scrollbarTrack', () => {
    expect(/\.heading-outline__list::-webkit-scrollbar-track\s*\{[^}]*background\s*:\s*transparent/.test(CSS)).toBe(true);
  });
});
