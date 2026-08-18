/**
 * FR-017's structural half: `ContextMenuProvider` is the ONLY thing in the renderer that draws a
 * context menu.
 *
 * PLACE AT: `packages/ui/tests/unit/single-menu-host.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/context-menu.e2e.ts` ("only one context menu is open app-wide")
 * and `packages/ui/tests/e2e/menus.e2e.ts` ("opening any menu closes any other"), together with
 * `packages/ui/tests/component/context-menu-lifecycle.test.ts`. 034 FR-045.
 *
 * ══ WHY THE CLAIM NEEDS TWO TESTS, NOT ONE ══
 *
 * "Exactly one menu, app-wide" is two statements. The provider replacing its own state is one, and it
 * is a render — the component test drives it. The other is that no module BYPASSES the provider, and
 * that is a claim about absence: a second `<ContextMenu>` mounted somewhere the test never navigated
 * to would satisfy every rendered assertion and still be the defect. The E2E could not see it either
 * — it sampled two surfaces (a panel handle and a tab chip) in one window and inferred the rest.
 *
 * This is the same argument `icon-call-sites.test.ts` makes for `resolveIcon`, and the same mechanism.
 *
 * ══ WHY IT IS WORTH GUARDING ══
 *
 * 018's whole subject was that three bespoke menus had grown up beside the shared one — the cog
 * drop-down, the Key Bindings chord menu and the font typeahead — each with its own markup, its own
 * click-away and no share in the one-menu invariant. They were folded in. Nothing but this test stops
 * a fourth: `<ContextMenu>` is exported, and rendering it directly compiles perfectly.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RENDERER = fileURLToPath(new URL('../../src/renderer', import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file: string): string => relative(RENDERER, file).split('\\').join('/');

/**
 * `<ContextMenu …>` but never `<ContextMenuProvider …>`.
 *
 * The negative lookahead is the whole trick and it has to be a word-boundary one: without it, every
 * file that mounts the PROVIDER — the two composition roots and the preferences app — reads as a file
 * that mounts a menu, and the test would either fail on correct code or be relaxed until it proved
 * nothing.
 */
/*
 * BOTH MOUNT SHAPES, and the second one is not hypothetical.
 *
 * This matched JSX only. A module mounting the menu through `createElement(ContextMenu, …)` — which
 * is the form every component test in this repo uses, and which any non-TSX module would have to use
 * — walked straight past the second-host defect this guard exists to catch. A vacuity audit found it,
 * and a guard that can be evaded by choosing a different call syntax is not a guard.
 */
const RENDERS_A_MENU = /<ContextMenu(?!Provider)\b|createElement\(\s*ContextMenu(?!Provider)\b/;

/** Which modules mount the provider — informational, and a second vacuous-pass guard. */
const RENDERS_THE_PROVIDER = /<ContextMenuProvider\b|createElement\(\s*ContextMenuProvider\b/;

describe('one menu host', () => {
  const files = walk(RENDERER);

  it('only the provider renders a ContextMenu', () => {
    const hosts = files.filter((f) => RENDERS_A_MENU.test(readFileSync(f, 'utf8'))).map(rel);
    expect(
      hosts,
      'a module other than the provider renders its own context menu, so two can be on screen at ' +
        'once and neither closes the other:\n  ' +
        hosts.join('\n  '),
    ).toEqual(['context-menu-provider.tsx']);
  });

  it('every window mounts that provider, so no surface is left without a menu host', () => {
    // Three renderer entry points draw menus: the main window and the sub-workspace window (both from
    // the composition root) and the preferences window, whose Key Bindings editor grew a bespoke menu
    // of its own precisely because it had no provider above it.
    const mounts = files.filter((f) => RENDERS_THE_PROVIDER.test(readFileSync(f, 'utf8'))).map(rel);
    expect(mounts.sort()).toEqual(['composition-root.tsx', 'preferences/preferences-app.tsx']);
  });

  it('finds the source it claims to walk (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => rel(f) === 'context-menu-provider.tsx')).toBe(true);
  });
});
