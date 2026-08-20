import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * WHAT IS IN THE SIDEBAR (021, migrated from `sidebar.e2e.ts:56`).
 *
 * ══ WHY A SOURCE GUARD, WHEN THE REST OF 035 MOVES TO COMPONENT ══
 *
 * The migrated test asserted three things: `projects-panel` is visible,
 * `.sidebar-panel--subworkspaces` is visible, and the **Terminals panel is gone entirely**. The
 * first two are ordinary rendering; the third is the claim the test exists for, and it is a claim
 * about ABSENCE — which is the one shape a render test is worst at.
 *
 * A component test asserting `queryByTestId('terminals-panel')` is null passes when the panel is
 * gone, and it also passes when the panel exists but this particular mount did not reach it, when
 * the testid was renamed, and when the tree failed to render at all. The requirement is that the
 * panel does not exist ANYWHERE, and that is a property of the whole renderer — the same argument
 * `icon-call-sites.test.ts` makes for its own guards, and the same one `unsaved-dot-call-sites.test
 * .ts` makes for the shared dot.
 *
 * The stack itself is not asserted by rendering, either, and for a reason worth stating: the panel
 * list lives inside `app.tsx`, in a `panels={[…]}` prop, and `app.tsx` is the application. Mounting
 * it to read an array is a worse trade than reading the array.
 *
 * ══ WHAT THIS DOES NOT COVER, SAID PLAINLY ══
 *
 * That the two panels RENDER. `component/projects-panel-form.test.ts` mounts `ProjectsPanel` and
 * `component/subworkspace-sync.test.ts` mounts `SubworkspacesPanel`, each against its own real
 * store, which is stronger evidence than a visibility assertion from a spec that created no
 * projects. What is left here is the composition: which panels the sidebar is built from, in order,
 * and that a third has not crept back in.
 */

const APP = fileURLToPath(new URL('../../src/renderer/app.tsx', import.meta.url));
const RENDERER_ROOT = fileURLToPath(new URL('../../src/renderer', import.meta.url));

/** The `key:` values of the sidebar's `VerticalPanelStack`, in the order they are declared. */
function sidebarPanelKeys(): string[] {
  const src = readFileSync(APP, 'utf8');
  const at = src.indexOf("storageKey=\"throng.sidebarPanelSizes\"");
  expect(at, 'the sidebar stack is no longer keyed on throng.sidebarPanelSizes').toBeGreaterThan(-1);
  // The `panels={[ … ]}` array that follows it, up to the closing `]}`.
  const arrayStart = src.indexOf('panels={[', at);
  const arrayEnd = src.indexOf(']}', arrayStart);
  expect(arrayStart, 'the sidebar stack has no panels prop').toBeGreaterThan(-1);
  expect(arrayEnd).toBeGreaterThan(arrayStart);
  const body = src.slice(arrayStart, arrayEnd);
  return [...body.matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1]);
}

describe('the sidebar is Projects and Sub-workspaces, in that order', () => {
  it('declares exactly those two panels', () => {
    // Order matters and is asserted: Projects is the one the user reaches for, and a stack whose
    // members were swapped would satisfy a set comparison.
    expect(sidebarPanelKeys()).toEqual(['projects', 'subworkspaces']);
  });

  it('gives Sub-workspaces the taller minimum, so it cannot be squeezed out', () => {
    const src = readFileSync(APP, 'utf8');
    const at = src.indexOf("storageKey=\"throng.sidebarPanelSizes\"");
    const body = src.slice(at, src.indexOf(']}', src.indexOf('panels={[', at)));
    const mins = [...body.matchAll(/minHeight:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(mins).toHaveLength(2);
    // `sidebar.e2e.ts` keeps the COMPUTED heights (a `@reserve:layout` claim about what the browser
    // actually laid out). What is asserted here is the intent behind them, which is what a
    // regression would change: Sub-workspaces stays visible while Projects may shrink to its header.
    expect(mins[1]).toBeGreaterThan(mins[0]);
  });
});

describe('the Terminals panel is gone, and has not crept back (021)', () => {
  it('appears nowhere in the renderer, by any of the three names it had', () => {
    /*
     * A claim about ABSENCE across the whole renderer, which is exactly what a render test cannot
     * make: `queryByTestId(...) === null` is satisfied by the panel existing somewhere this mount
     * did not reach. So the tree is walked instead.
     *
     * All three names are checked because a partial revert is the realistic failure — a component
     * restored without its testid, or a testid restored without its class.
     */
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(tsx?|css)$/.test(entry)) continue;
        const src = readFileSync(path, 'utf8');
        for (const name of ['terminals-panel', 'TerminalsPanel', 'sidebar-panel--terminals']) {
          if (src.includes(name)) offenders.push(`${path.slice(RENDERER_ROOT.length + 1)} → ${name}`);
        }
      }
    };
    walk(RENDERER_ROOT);

    expect(offenders, 'the Terminals panel has returned to the renderer').toEqual([]);
  });
});
