/**
 * The window-local "this document's language override changed" event (055 FR-024a; 016 FR-028b).
 *
 * A choice made in one panel must reach every other panel already showing the same file. Each editor decides
 * whether a change is about ITS document from the project id and the project-relative path, so the matching
 * rule is what these tests pin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isSameDocument,
  publishDocumentLanguageChange,
  subscribeDocumentLanguageChange,
} from '../../src/renderer/editor/document-language-events.js';

const unsubscribers: Array<() => void> = [];
afterEach(() => {
  while (unsubscribers.length > 0) unsubscribers.pop()?.();
});

describe('publishing a change', () => {
  it('reaches every subscriber, with the change as published', () => {
    const a = vi.fn();
    const b = vi.fn();
    unsubscribers.push(subscribeDocumentLanguageChange(a), subscribeDocumentLanguageChange(b));
    const change = { projectId: 'p', relPath: 'src/a.json', originPanelId: 'panel-1', includeOrigin: true };

    publishDocumentLanguageChange(change);

    expect(a).toHaveBeenCalledWith(change);
    expect(b).toHaveBeenCalledWith(change);
  });

  it('stops reaching a subscriber once it unsubscribes', () => {
    const a = vi.fn();
    subscribeDocumentLanguageChange(a)();
    publishDocumentLanguageChange({ projectId: 'p', relPath: 'a', originPanelId: 'x', includeOrigin: false });
    expect(a).not.toHaveBeenCalled();
  });
});

describe('isSameDocument', () => {
  it('matches the same project and path, ignoring case and slash direction', () => {
    expect(
      isSameDocument({ projectId: 'p', relPath: 'Src\\Config.JSON' }, { projectId: 'p', relPath: 'src/config.json' }),
    ).toBe(true);
  });

  it('does not match another project or another path', () => {
    expect(isSameDocument({ projectId: 'p', relPath: 'a.json' }, { projectId: 'q', relPath: 'a.json' })).toBe(false);
    expect(isSameDocument({ projectId: 'p', relPath: 'a.json' }, { projectId: 'p', relPath: 'b.json' })).toBe(false);
  });

  it('never matches an untitled document, which has no path to compare', () => {
    expect(isSameDocument({ projectId: 'p', relPath: null }, { projectId: 'p', relPath: null })).toBe(false);
    expect(isSameDocument({ projectId: null, relPath: 'a' }, { projectId: null, relPath: 'a' })).toBe(false);
  });
});
