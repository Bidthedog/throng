import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 018 / FR-001, SC-001 — the surface split, enforced.
 *
 * The overloaded `surface` token had ~30 call sites doing eight different jobs: pane bodies, menus,
 * input fields, row hovers, modal cards, the tab chip, buttons. Changing the pane background
 * repainted the drop-down menus. An author had one dial for eight surfaces.
 *
 * This guard is the only thing standing between that requirement and a false SC-001 — so it must be
 * shaped like the REQUIREMENT, not like the change. Three things make that true:
 *
 * 1. IT RESOLVES THE ALIAS CHAIN. The token is reachable under THREE names —
 *    `--throng-colour-surface`, and the `--bg-panel` and `--surface` aliases layered over it in
 *    theme.css. A guard that greps for two of them reports GREEN with fourteen call sites unmoved,
 *    including the shared context menu's own background and the active tab chip (a surface SC-001
 *    names by hand). An earlier draft of this guard did exactly that. The alias `--bg-panel` appears
 *    nowhere in this feature's specification, plan or tasks: it was found by walking the tree.
 *
 * 2. IT DISCOVERS, rather than checking a list of files someone remembered.
 *
 * 3. It guards `surfaceActive` too, which nothing policed at all — and where a hand-written audit
 *    recorded three call sites when there were ten, four of them hover states that belonged in
 *    `hoverSurface`.
 */

const RENDERER = fileURLToPath(new URL('../../src/renderer', import.meta.url));

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, match));
    else if (match.test(entry)) out.push(path);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Every custom-property name that transitively resolves to `--throng-colour-<token>`.
 *
 * This is the heart of the guard. `--bg-panel: var(--throng-colour-surface)` and
 * `--surface: var(--bg-panel)` mean a rule reading `var(--bg-panel)` is reading the pane token just
 * as surely as one naming it outright — and is just as much a violation if it is not a pane.
 */
function aliasesOf(token: string): Set<string> {
  const names = new Set([`--throng-colour-${token}`]);

  // Scan EVERY stylesheet, not just theme.css. Other files declare custom properties too
  // (preferences.css, title-bar.css, status-bar.css), so `--prefs-surface: var(--bg-panel)` declared
  // in one of them and read in a menu is a violation that a theme.css-only scan cannot follow — which
  // is the very hole this guard's own doc-comment claims to have closed.
  const decls: RegExpMatchArray[] = [];
  for (const file of walk(RENDERER, /\.css$/)) {
    const css = stripComments(readFileSync(file, 'utf8'));
    decls.push(...css.matchAll(/(?:^|[{;])\s*(--[a-zA-Z0-9-]+)\s*:\s*([^;}]+)/gm));
  }

  // Fixed point: keep absorbing aliases until no new name resolves to the token.
  //
  // Follow only the PRIMARY arm of `var(--x, fallback)`. A fallback arm is not an alias: the theme
  // emitter merges every theme over the built-in defaults, so `--x` is always defined and the
  // fallback never fires. `--btn-bg: var(--throng-colour-buttonBg, var(--bg-panel))` is an alias of
  // buttonBg, NOT of the pane token — and treating it as one falsely accuses three buttons of
  // painting themselves with the pane background.
  const primaryTarget = (value: string): string | undefined =>
    /var\(\s*(--[a-zA-Z0-9-]+)/.exec(value)?.[1];

  for (let grew = true; grew; ) {
    grew = false;
    for (const [, name, value] of decls) {
      if (names.has(name)) continue;
      const target = primaryTarget(value);
      if (target !== undefined && names.has(target)) {
        names.add(name);
        grew = true;
      }
    }
  }
  return names;
}

/**
 * Every rule that READS one of those names, with the FULL selector list it paints.
 *
 * The selector is accumulated across lines, because a comma-separated selector is routinely written
 * one-per-line in this codebase:
 *
 *     .context-menu,
 *     .pane--left {
 *       background: var(--bg-panel);
 *     }
 *
 * An earlier version of this guard kept only the line containing the `{`, so it recorded that rule's
 * selector as `.pane--left`, decided it was a pane, and reported GREEN while the context menu painted
 * itself with the pane background. A guard with a hole is worse than no guard: it reports success
 * over a violated requirement, and everyone believes it.
 *
 * Every comma-separated part is now checked independently, so ONE offending part fails the rule.
 */
function readsOf(names: Set<string>): { selector: string; where: string }[] {
  const hits: { selector: string; where: string }[] = [];
  for (const file of walk(RENDERER, /\.css$/)) {
    const rel = file.slice(RENDERER.length + 1).replace(/\\/g, '/');
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    let pending = ''; // selector text accumulating since the last `}`
    let selectors: string[] = [];

    lines.forEach((line, i) => {
      const open = line.indexOf('{');
      if (open >= 0) {
        selectors = (pending + line.slice(0, open))
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '');
        pending = '';
      } else if (line.includes('}')) {
        selectors = [];
        pending = '';
      } else if (selectors.length === 0) {
        pending += ` ${line}`; // still gathering a multi-line selector
      }

      // A declaration inside :root is the alias DEFINITION, not a read of it.
      if (selectors.length === 0 || selectors.some((s) => s.includes(':root'))) return;

      for (const name of names) {
        // Tolerate whitespace: `var( --bg-panel )` reads the token just as surely as `var(--bg-panel)`.
        if (new RegExp(`var\\(\\s*${name}\\s*[,)]`).test(line)) {
          for (const selector of selectors) hits.push({ selector, where: `${rel}:${i + 1}` });
        }
      }
    });
  }
  return hits;
}

describe('the surface token split (FR-001 / SC-001)', () => {
  it('reaches the pane token under every alias, not just its own name', () => {
    // Guard the guard. If theme.css stops aliasing, this can go — but it must never be narrowed
    // silently, because narrowing it is what makes the whole split a lie.
    const names = aliasesOf('surface');
    expect(names.has('--bg-panel'), 'the guard must follow --bg-panel').toBe(true);
    expect(names.has('--surface'), 'the guard must follow --surface').toBe(true);
  });

  it('paints ONLY pane/panel bodies and dialog cards with the pane token', () => {
    // 021 / FR-023 — the surface consolidation gave `surface` a SECOND legitimate job. `menuSurface`
    // and `dialogSurface` are gone; the menu/dropdown cards folded onto `surfaceActive`, and the
    // DIALOG/MODAL/NOTICE cards folded back onto `surface`. So the pane token now paints pane bodies,
    // panel boxes AND those dialog cards — and nothing else. The set is enumerated (not open) so a
    // NEW, un-audited surface reaching for the pane token still fails, exactly as before.
    const DIALOG_CARDS =
      /^\.(modal|notice|capture-modal|colour-picker|find-bar|app-closing__card|terminal-panel__starting|about-root)$|^\.app-close-table th$/;
    const offenders = readsOf(aliasesOf('surface')).filter(
      (h) => !/^\.pane--\w+$|^\.panel-box$/.test(h.selector) && !DIALOG_CARDS.test(h.selector),
    );
    const report = offenders.map((h) => `${h.selector} (${h.where})`).sort();
    expect(
      report,
      `these paint with the PANE token but are neither panes nor dialog cards:\n${report.join('\n')}`,
    ).toEqual([]);
  });

  it('paints ONLY selected/active surfaces with the active token', () => {
    // Nothing guarded this token before 018. The role it must NOT drift back into is `hover`:
    // four icon-button hovers were using it, which is the row-hover job FR-001 carves out.
    const offenders = readsOf(aliasesOf('surfaceActive')).filter((h) => /:hover(?!.*--)/.test(h.selector) && !/--selected/.test(h.selector));
    const report = offenders.map((h) => `${h.selector} (${h.where})`).sort();
    expect(
      report,
      `these are HOVER states painted with the ACTIVE token — use hoverSurface:\n${report.join('\n')}`,
    ).toEqual([]);
  });
});
