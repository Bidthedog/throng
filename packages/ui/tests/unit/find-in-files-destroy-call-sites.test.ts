import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 043 T102 — wherever a Panel's find SESSION is discarded, its Find in Files STATE goes too
 * (FR-023, FR-026, US5 scenario 5).
 *
 * ══ WHY A SOURCE GUARD, AND WHY THIS PAIRING ══
 *
 * `find-in-files-discard.test.ts` asserts what discarding DOES — the results go, the scan is
 * cancelled, a panel opened afterwards starts with none — by calling the store function directly,
 * which is `find-session-per-panel.test.ts`'s idiom for the find bar's identical rule. What that
 * cannot say is that every place a panel actually dies calls it. There are three such places, they
 * are three different components, and a fourth added next year would be invisible to any render.
 *
 * The pairing with `destroyPanelSearch` is the whole mechanism, and it is deliberate rather than
 * convenient: 043 FR-006 already requires a panel's find session to die with the panel, so those
 * call sites are exactly the set of places that know a panel is gone. Discovering them by that
 * marker means a future destroy path cannot forget one half without forgetting the other, and
 * forgetting the other is loud.
 *
 * `icon-call-sites.test.ts` and `unsaved-dot-call-sites.test.ts` argue the general case for this
 * shape: a property of EVERY site at once is a claim no single render can make.
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

const SOURCES = walk(RENDERER, /\.tsx?$/);

/** `<relative path>` for every renderer file that ends a panel's find session. */
function sessionDestroySites(): string[] {
  const found: string[] = [];
  for (const file of SOURCES) {
    const src = readFileSync(file, 'utf8');
    // The CALL, not the import line, and not the declaration in the store itself.
    if (/(?<!function )\bdestroyPanelSearch\(/.test(src.replace(/^import[\s\S]*?;$/gm, ''))) {
      found.push(file.slice(RENDERER.length + 1).replace(/\\/g, '/'));
    }
  }
  return found.sort();
}

/**
 * The one site that ends a find session WITHOUT a panel dying.
 *
 * `disposeEditor` tears down a DOCUMENT — the dirty-file lock, the recovery temp, the one-buffer
 * registry — and takes that panel's find bar with it. A Find in Files panel is never an editor and
 * never reaches this function, so calling `destroyFindInFilesPanel` here would be a call that can
 * only ever be a no-op, which is worse than no call: it would read as though this were a fourth
 * place a Find in Files panel can die.
 */
const EXEMPT = new Set(['editor/use-editor.ts']);

describe('a destroyed panel takes its Find in Files state with it (FR-023)', () => {
  const sites = sessionDestroySites();

  it('finds the destroy paths at all', () => {
    // Anti-vacuity: with an empty set every assertion below is satisfied by an empty filter, which
    // is the failure mode a guard like this exists to avoid rather than to demonstrate.
    expect(sites.length, `no renderer file appears to destroy a panel's find session`).
      toBeGreaterThanOrEqual(3);
  });

  it('destroys the panel’s Find in Files state at every one of them', () => {
    const missing = sites
      .filter((rel) => !EXEMPT.has(rel))
      .filter(
        (rel) =>
          !readFileSync(join(RENDERER, rel), 'utf8').includes('destroyFindInFilesPanel('),
      );
    expect(
      missing,
      `these renderer files end a Panel's find session but leave its Find in Files results in the ` +
        `store. FR-023: results live only as long as the panel that owns them, and a panel opened ` +
        `afterwards must start with none — so every place a Panel dies calls ` +
        `destroyFindInFilesPanel(id) beside destroyPanelSearch(id):\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('names an exemption that still exists', () => {
    // An exemption for a file nobody destroys sessions in any more is an exemption that has stopped
    // meaning anything, and would silently excuse a real site if the path were ever reused.
    for (const rel of EXEMPT) {
      expect(sites, `${rel} is exempted but no longer ends a find session`).toContain(rel);
    }
  });
});
