import { describe, expect, it } from 'vitest';

import { panelRemovalVerb } from '../../src/workspace/removal-verbs.js';

/**
 * 011 FR-030/FR-031, migrated from `removal-verbs.e2e.ts:130` (035 T058).
 *
 * ── WHAT THE E2E COULD ASK, AND WHAT THIS ASKS ──
 *
 * The E2E asserted ONE of the four combinations below — a project-owned panel in the main window
 * shows "Destroy" — by launching Electron, opening a project and reading the header ×'s tooltip.
 * Its own comment named the reason the other three went unasserted: `panelVerb` was computed inline
 * and rendered into a `title` attribute, so there was no seam below the component and each further
 * combination cost another launch.
 *
 * All four are here because the rule has two inputs, and the interesting one is the combination the
 * E2E could not reach at all: a SUB-WORKSPACE panel that the sub-workspace itself owns. It is in a
 * sub-workspace, which is where Close lives — and it is still a Destroy, because there is no other
 * copy of it anywhere. A rule tested only on the main window cannot tell that from an oversight.
 */
describe('the verb on a Panel’s own removal controls', () => {
  it('is Close for a mirrored project panel inside a sub-workspace — the project keeps it', () => {
    expect(panelRemovalVerb({ inSubWorkspace: true, hasOriginProject: true })).toBe('Close');
  });

  it('is Destroy for a sub-workspace’s OWN panel — in a sub-workspace, and still the only copy', () => {
    /*
     * The combination the E2E never reached, and the one that makes the rule two-input rather than
     * one. "Am I in a sub-workspace" alone would answer Close here, and be wrong: nothing else holds
     * this panel, so removing it terminates the process it hosts.
     */
    expect(panelRemovalVerb({ inSubWorkspace: true, hasOriginProject: false })).toBe('Destroy');
  });

  it('is Destroy in the main window, where a panel is never a view of something else', () => {
    // The one combination the E2E asserted.
    expect(panelRemovalVerb({ inSubWorkspace: false, hasOriginProject: true })).toBe('Destroy');
  });

  it('is Destroy in the main window even with no project resolved', () => {
    /*
     * `hasOriginProject` must not decide anything on its own either. In the main window the panel is
     * the original whether or not a project stands behind it, so an implementation that keyed off
     * the project alone would say Close here — dismissing a view of nothing.
     */
    expect(panelRemovalVerb({ inSubWorkspace: false, hasOriginProject: false })).toBe('Destroy');
  });

  it('only ever produces one of the two verbs a Panel can use', () => {
    /*
     * FR-030 has FOUR verbs, and the other two belong to other targets: Remove unregisters a
     * project, Delete destroys something on disk. This guards the whole input space rather than the
     * four cases above, so a future third branch returning "Remove" for some new condition fails
     * here rather than reaching a tooltip.
     */
    const verbs = new Set(
      [true, false].flatMap((inSubWorkspace) =>
        [true, false].map((hasOriginProject) =>
          panelRemovalVerb({ inSubWorkspace, hasOriginProject }),
        ),
      ),
    );
    expect([...verbs].sort()).toEqual(['Close', 'Destroy']);
  });
});
