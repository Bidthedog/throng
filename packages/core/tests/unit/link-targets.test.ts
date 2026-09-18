import { describe, expect, it } from 'vitest';
import { LINK_TARGETS, linkTargetStates } from '../../src/links/targets.js';
import type { LinkTarget } from '../../src/links/targets.js';
import type { ResolvedLink } from '../../src/links/types.js';

/**
 * 045 FR-030 and SC-009 — `data-model.md` §3.
 *
 * SC-009 names five link shapes and asks for "exactly the items FR-030 and FR-031 prescribe, with
 * no extra, missing or wrongly enabled items". Those five shapes are the five `describe` blocks
 * below, and each one asserts the WHOLE record rather than the one state it is interested in —
 * because "no extra items" is a claim about everything the function did not say.
 */

const link = (over: Partial<ResolvedLink> = {}): ResolvedLink => ({
  path: 'C:\\throng\\src\\foo.ts',
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
  ...over,
});

describe('linkTargetStates — SC-009 shape 1: an in-project file, no preview provider', () => {
  it('offers the editor, the OS file manager and the OS default program', () => {
    expect(linkTargetStates(link())).toEqual({
      editor: 'offered',
      preview: 'absent',
      osExplorer: 'offered',
      osDefaultProgram: 'offered',
    });
  });
});

describe('linkTargetStates — SC-009 shape 2: an in-project file with an ENABLED provider', () => {
  it('offers the preview as well', () => {
    expect(linkTargetStates(link({ preview: 'enabled' }))).toEqual({
      editor: 'offered',
      preview: 'offered',
      osExplorer: 'offered',
      osDefaultProgram: 'offered',
    });
  });
});

describe('linkTargetStates — SC-009 shape 3: an in-project file with a DISABLED provider', () => {
  it('draws the preview disabled rather than hiding it (044 FR-062)', () => {
    expect(linkTargetStates(link({ preview: 'disabled' }))).toEqual({
      editor: 'offered',
      preview: 'disabled',
      osExplorer: 'offered',
      osDefaultProgram: 'offered',
    });
  });
});

describe('linkTargetStates — SC-009 shape 4: a file OUTSIDE the project', () => {
  it('offers neither the editor nor the preview, whatever a provider would say (FR-055)', () => {
    expect(linkTargetStates(link({ inProject: false }))).toEqual({
      editor: 'absent',
      preview: 'absent',
      osExplorer: 'offered',
      osDefaultProgram: 'offered',
    });
    // A provider accepting the type does NOT bring the preview back for an out-of-project file.
    expect(linkTargetStates(link({ inProject: false, preview: 'enabled' })).preview).toBe('absent');
    expect(linkTargetStates(link({ inProject: false, preview: 'disabled' })).preview).toBe('absent');
  });
});

describe('linkTargetStates — SC-009 shape 5: a folder', () => {
  it('offers the OS file manager alone', () => {
    expect(linkTargetStates(link({ kind: 'folder', path: 'C:\\throng\\src' }))).toEqual({
      editor: 'absent',
      preview: 'absent',
      osExplorer: 'offered',
      osDefaultProgram: 'absent',
    });
  });

  it('an in-project folder is still not an editor or a preview target', () => {
    const states = linkTargetStates(link({ kind: 'folder', inProject: true, preview: 'enabled' }));
    expect(states.editor).toBe('absent');
    expect(states.preview).toBe('absent');
  });
});

describe('linkTargetStates — the invariants FR-030 states once', () => {
  const every: ResolvedLink[] = [];
  for (const kind of ['file', 'folder'] as const) {
    for (const inProject of [true, false]) {
      for (const preview of ['none', 'enabled', 'disabled'] as const) {
        for (const executable of [true, false]) {
          every.push(link({ kind, inProject, preview, executable }));
        }
      }
    }
  }

  it('Open in OS Explorer is offered for every link there is', () => {
    for (const l of every) expect(linkTargetStates(l).osExplorer).toBe('offered');
  });

  it('preview is the ONLY target that can be disabled', () => {
    for (const l of every) {
      const states = linkTargetStates(l);
      for (const target of LINK_TARGETS) {
        if (target !== 'preview') expect(states[target]).not.toBe('disabled');
      }
    }
  });

  it('executability changes no target state — FR-039 is a rule about ACTIONS, not about items', () => {
    for (const kind of ['file', 'folder'] as const) {
      for (const preview of ['none', 'enabled', 'disabled'] as const) {
        const runnable = linkTargetStates(link({ kind, preview, executable: true }));
        const inert = linkTargetStates(link({ kind, preview, executable: false }));
        expect(runnable).toEqual(inert);
      }
    }
  });

  it('answers for every target, every time, and for no target twice', () => {
    for (const l of every) {
      expect(Object.keys(linkTargetStates(l)).sort()).toEqual([...LINK_TARGETS].sort());
    }
  });

  it('LINK_TARGETS is FR-030\u2019s order, which is the order the menu draws them in', () => {
    const expected: LinkTarget[] = ['editor', 'preview', 'osExplorer', 'osDefaultProgram'];
    expect([...LINK_TARGETS]).toEqual(expected);
  });
});
