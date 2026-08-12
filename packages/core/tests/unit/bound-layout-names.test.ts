/**
 * 031 FR-040 — the PERSISTENCE half of the name limit.
 *
 * The limit shortens what is SHOWN on read, and that alone was implemented: the renderer bounds
 * `shownTitle`, the picker, and `panelDisplayTitle`. But the layout handed to `workspace.save` is
 * the in-memory one, whose titles were never bounded — so lowering the limit and then renaming a
 * DIFFERENT tab left the store still holding the full 64-character name. Found by an E2E that
 * failed on its own assertion, not on a timing one.
 *
 * FR-040 is precise about the two halves: shortening on read must NOT rewrite storage, and the
 * shortened form is persisted only when the layout is next written FOR SOME OTHER REASON. That
 * makes the write boundary the one correct place for this, which is what these tests pin.
 */
import { describe, it, expect } from 'vitest';
import { boundLayoutNames } from '../../src/workspace/bound-names.js';
import type { WorkspaceLayout, Panel } from '../../src/workspace/model.js';

// A Panel IS a LayoutNode in this model — there is no leaf wrapper (model.ts: `LayoutNode = SplitNode | Panel`).
function panel(id: string, title: string, custom = true): Panel {
  return { id, kind: 'editor', title, titleIsCustom: custom } as Panel;
}

function layout(tabTitle: string, panels: Panel[]): WorkspaceLayout {
  return {
    projectId: 'p1',
    schemaVersion: 3,
    activeTabId: 't1',
    tabs: [{ id: 't1', title: tabTitle, root: panels[0] } as never],
  };
}

const LONG = 'feature-S031-a-deliberately-long-tab-name-that-runs-past-any-sane-limit';

describe('boundLayoutNames — FR-040, applied at the WRITE boundary', () => {
  it('shortens a tab title that exceeds the limit', () => {
    const out = boundLayoutNames(layout(LONG, [panel('p1', 'short')]), 16);
    expect(out.tabs[0].title).toHaveLength(16);
    expect(LONG.startsWith(out.tabs[0].title)).toBe(true);
  });

  it('shortens a panel title that exceeds the limit', () => {
    const out = boundLayoutNames(layout('short', [panel('p1', LONG)]), 12);
    expect((out.tabs[0].root as Panel).title).toHaveLength(12);
  });

  it('leaves a layout already within the limit byte-for-byte alone', () => {
    const input = layout('fine', [panel('p1', 'also fine')]);
    const out = boundLayoutNames(input, 64);
    expect(out).toEqual(input);
  });

  it('is idempotent — bounding an already-bounded layout changes nothing', () => {
    const once = boundLayoutNames(layout(LONG, [panel('p1', LONG)]), 20);
    const twice = boundLayoutNames(once, 20);
    expect(twice).toEqual(once);
  });

  it('never mutates the layout it was given', () => {
    const input = layout(LONG, [panel('p1', LONG)]);
    boundLayoutNames(input, 8);
    expect(input.tabs[0].title).toBe(LONG);
  });

  it('treats a non-finite or absent limit as unbounded, so a mangled setting cannot blank names', () => {
    const input = layout(LONG, [panel('p1', LONG)]);
    expect(boundLayoutNames(input, Number.NaN)).toEqual(input);
    expect(boundLayoutNames(input, undefined as unknown as number)).toEqual(input);
  });

  it('cuts on a grapheme boundary, never through an emoji', () => {
    const emoji = '\u{1F468}‍\u{1F469}‍\u{1F467}'; // one cluster, many code units
    const out = boundLayoutNames(layout(`ab${emoji}cd`, [panel('p1', 'x')]), 3);
    // Three clusters: 'a', 'b', and the whole family — never half of it.
    expect(out.tabs[0].title).toBe(`ab${emoji}`);
  });
});
