import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  planUnload,
  projectPanelIdsInSubWorkspaces,
  type LayoutNode,
  type Tab,
} from '@throng/core';

/**
 * 046 T125 — the Unload planner after FR-111 (data-model §8, "Superseded at the iterate round 1
 * checkpoint"), and the sub-workspace spare list (FR-037, unchanged from T053).
 *
 * ══ WHAT CHANGED, AND WHY THE OLD CASES ARE GONE ══
 *
 * T053 pinned a planner that could return a three-button `choose` step and a `confirmEnd` step,
 * driven by `confirmations.unloadProject` and by how many terminals were busy. FR-111 withdraws both:
 * each Unload row states its action before the click (FR-081), so the click carries it out and no
 * dialog asks anything. The plan is now exactly one step:
 *
 *   planUnload({ defaultAction, variant? }) = [{ kind: 'apply', action: variant ?? defaultAction }]
 *
 * `level` is gone from the input (the setting is withdrawn), and `busyCount` no longer changes the
 * steps — a busy terminal is kept or ended exactly like an idle one (FR-086, FR-111).
 */

type Action = 'keepRunning' | 'endTerminals';
const ACTIONS: readonly Action[] = ['keepRunning', 'endTerminals'];
const opposite = (a: Action): Action => (a === 'keepRunning' ? 'endTerminals' : 'keepRunning');
const apply = (action: Action) => ({ kind: 'apply', action });

describe('planUnload — one apply step, never a dialog (FR-111, data-model §8)', () => {
  it.each(ACTIONS)('the plain Unload Project row applies the preference (%s)', (defaultAction) => {
    expect(planUnload({ defaultAction })).toEqual([apply(defaultAction)]);
  });

  it.each(ACTIONS)('the opposite-action row under %s applies the OTHER action (FR-081)', (defaultAction) => {
    const variant = opposite(defaultAction);
    expect(planUnload({ defaultAction, variant })).toEqual([apply(variant)]);
  });

  it('a variant equal to the preference is still just that action', () => {
    for (const a of ACTIONS) {
      expect(planUnload({ defaultAction: a, variant: a })).toEqual([apply(a)]);
    }
  });

  it('no input ever yields a choose or confirmEnd step (SC-015)', () => {
    for (const defaultAction of ACTIONS) {
      for (const variant of [undefined, ...ACTIONS]) {
        const steps = planUnload({ defaultAction, variant });
        expect(steps).toHaveLength(1);
        expect(steps.map((s) => s.kind)).toEqual(['apply']);
      }
    }
  });

  it('a stale caller still passing level and busyCount gets the same single step — neither is read', () => {
    // Before T127 these two inputs produced `choose` (busy, level double). A caller that has not
    // caught up must not be able to bring the dialog back.
    const stale = { defaultAction: 'endTerminals', level: 'double', busyCount: 3 } as unknown as Parameters<
      typeof planUnload
    >[0];
    expect(planUnload(stale)).toEqual([apply('endTerminals')]);

    const staleKeep = { defaultAction: 'keepRunning', level: 'double', busyCount: 3 } as unknown as Parameters<
      typeof planUnload
    >[0];
    expect(planUnload(staleKeep)).toEqual([apply('keepRunning')]);
  });

  it('takes no level (checked by the typecheck, not at run time)', () => {
    expectTypeOf<Parameters<typeof planUnload>[0]>().not.toHaveProperty('level');
  });
});

describe('projectPanelIdsInSubWorkspaces (FR-037)', () => {
  const panel = (id: string, originProjectId: string): LayoutNode => ({
    type: 'panel',
    id,
    originProjectId,
    title: id,
  });
  const split = (...children: LayoutNode[]): LayoutNode => ({
    type: 'split',
    orientation: 'row',
    children,
    sizes: children.map(() => 1 / children.length),
  });
  const tab = (id: string, root: LayoutNode): Tab => ({ id, title: id, root });

  const subs = [
    {
      id: 's1',
      name: 'Scratch',
      tabs: [
        // A mixed tab: nested splits, this project's panels at two depths, another project's beside.
        tab('t1', split(panel('p-a', 'proj'), split(panel('o-a', 'other'), panel('p-b', 'proj')))),
        tab('t2', panel('o-b', 'other')),
      ],
    },
    { id: 's2', name: 'Notes', tabs: [tab('t3', panel('p-c', 'proj'))] },
    { id: 's3', name: 'Empty of proj', tabs: [tab('t4', split(panel('o-c', 'other'), panel('o-d', 'other')))] },
  ];

  it("returns every one of this project's panels held by any sub-workspace, at any depth", () => {
    expect([...projectPanelIdsInSubWorkspaces('proj', subs)].sort()).toEqual(['p-a', 'p-b', 'p-c']);
  });

  it("never returns another project's panel", () => {
    const ids = projectPanelIdsInSubWorkspaces('proj', subs);
    expect(ids.some((id) => id.startsWith('o-'))).toBe(false);
  });

  it('returns each panel once', () => {
    const ids = projectPanelIdsInSubWorkspaces('proj', subs);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is empty when no sub-workspace holds the project, or there are none', () => {
    expect(projectPanelIdsInSubWorkspaces('absent', subs)).toEqual([]);
    expect(projectPanelIdsInSubWorkspaces('proj', [])).toEqual([]);
  });
});
