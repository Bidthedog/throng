import { afterEach, describe, expect, it } from 'vitest';
import {
  applyWikiResolution,
  UNRESOLVED_CLASS,
  WIKI_INDEX_ATTRIBUTE,
} from '../../src/renderer/preview/providers/markdown/wikilinks.js';

/**
 * 047 T063 (FR-055) — marking a wikilink `preview-link--unresolved` from `main`'s
 * `resolveWikiTargets` answer, over a plain DOM tree (the same style as `fold-gutter.test.ts`): the
 * async IPC round trip and the render-time collection of targets belong to `markdown-body.tsx` and
 * `preview-panel.tsx`, which this module has no need of to prove its own DOM update.
 */

function link(index: number): HTMLAnchorElement {
  const a = document.createElement('a');
  a.setAttribute(WIKI_INDEX_ATTRIBUTE, String(index));
  return a;
}

function mount(children: HTMLElement[]): HTMLElement {
  const root = document.createElement('div');
  root.append(...children);
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('applyWikiResolution (T063, FR-055)', () => {
  it('marks a wikilink unresolved when its answer is null', () => {
    const a = link(0);
    const root = mount([a]);
    applyWikiResolution(root, [null]);
    expect(a.classList.contains(UNRESOLVED_CLASS)).toBe(true);
  });

  it('leaves a resolved wikilink unmarked', () => {
    const a = link(0);
    const root = mount([a]);
    applyWikiResolution(root, ['D:/proj/docs/Note.md']);
    expect(a.classList.contains(UNRESOLVED_CLASS)).toBe(false);
  });

  it('matches each link by its OWN index, not document order', () => {
    const resolved = link(1); // answer[1] is resolved — this link appears FIRST in the DOM
    const unresolved = link(0); // answer[0] is null — this link appears SECOND in the DOM
    const root = mount([resolved, unresolved]);
    applyWikiResolution(root, [null, 'D:/proj/docs/Two.md']);
    expect(resolved.classList.contains(UNRESOLVED_CLASS)).toBe(false);
    expect(unresolved.classList.contains(UNRESOLVED_CLASS)).toBe(true);
  });

  it('treats an index past the end of resolved (T062’s 500-target cap) as unresolved', () => {
    const a = link(5);
    const root = mount([a]);
    applyWikiResolution(root, ['D:/proj/docs/A.md']); // only index 0 was answered
    expect(a.classList.contains(UNRESOLVED_CLASS)).toBe(true);
  });

  it('re-applying with a new answer flips a previously unresolved link back to resolved', () => {
    const a = link(0);
    const root = mount([a]);
    applyWikiResolution(root, [null]);
    expect(a.classList.contains(UNRESOLVED_CLASS)).toBe(true);
    applyWikiResolution(root, ['D:/proj/docs/Note.md']);
    expect(a.classList.contains(UNRESOLVED_CLASS)).toBe(false);
  });

  it('does nothing when there are no wikilinks at all', () => {
    const root = mount([document.createElement('p')]);
    expect(() => applyWikiResolution(root, [])).not.toThrow();
  });
});
