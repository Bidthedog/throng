/**
 * 044 T233 (2) — the renderer half of FR-121e's wire change, and FR-121h's source tag (data-model §15.2
 * "Renderer-only tag", §15.4; research R32).
 *
 * A history step onto an entry with no saved place now arrives with `viewState: null` — present, not
 * absent — and the store must keep that `null`, because it is what tells the body "a step onto the top"
 * from "a link followed". It also tags where a place came from: `'attach'` for the answer the panel's
 * attach call site applies (an opening or restoring preview, where FR-121h lets the editor's line win) and
 * `'update'` for every other apply (a step, where FR-107's saved place wins). The tag never crosses IPC.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { PreviewUpdate } from '@throng/core';
import {
  __resetPreviewStore,
  applyPreviewUpdate,
  clearPreviewViewState,
  getPreviewState,
} from '../../src/renderer/preview/preview-store.js';

const base = (over: Partial<PreviewUpdate> = {}): PreviewUpdate => ({
  panelId: 'v1',
  revision: 1,
  filePath: 'C:/p/README.md',
  providerId: 'markdown',
  content: { kind: 'text', text: '# Readme\n' },
  dirty: false,
  parent: null,
  notice: null,
  navigationSeq: 0,
  ...over,
});

beforeEach(() => {
  __resetPreviewStore();
});

describe('a history step with no saved place (FR-121e)', () => {
  it('keeps viewState: null, present, tagged update', () => {
    applyPreviewUpdate(base());
    applyPreviewUpdate(base({ revision: 2, viewState: null, navigationSeq: 1 }));

    const state = getPreviewState('v1')!;
    expect('viewState' in state).toBe(true);
    expect(state.viewState).toBeNull();
    expect(state.viewStateSource).toBe('update');
  });

  it('the same null at the same revision (a push and its reply) is applied once', () => {
    applyPreviewUpdate(base());
    const step = base({ revision: 2, viewState: null, content: null });
    expect(applyPreviewUpdate(step)).toBe(true);
    const held = getPreviewState('v1');

    // The other route delivers the identical update: not applied, and the state object is untouched, so no
    // subscriber re-renders and the body restores once.
    expect(applyPreviewUpdate({ ...step })).toBe(false);

    expect(getPreviewState('v1')).toBe(held);
  });

  it('an update with no viewState key keeps neither a place nor a tag it did not bring', () => {
    applyPreviewUpdate(base());
    applyPreviewUpdate(base({ revision: 2 }));

    const state = getPreviewState('v1')!;
    expect(state).not.toHaveProperty('viewState');
    expect(state).not.toHaveProperty('viewStateSource');
  });
});

describe('where a place came from (FR-121h)', () => {
  it('a place applied through the attach call path is tagged attach', () => {
    applyPreviewUpdate(base({ viewState: { line: 40, offsetRatio: 0 } }), 'attach');

    expect(getPreviewState('v1')).toMatchObject({ viewState: { line: 40, offsetRatio: 0 }, viewStateSource: 'attach' });
  });

  it('a re-attach answer that only brings a place, at the revision held, is tagged attach too', () => {
    applyPreviewUpdate(base());
    applyPreviewUpdate(base({ viewState: { line: 40, offsetRatio: 0 } }), 'attach');

    expect(getPreviewState('v1')).toMatchObject({ revision: 1, viewStateSource: 'attach' });
  });

  it('a later step’s place replaces the attach tag with update', () => {
    applyPreviewUpdate(base({ viewState: { line: 40, offsetRatio: 0 } }), 'attach');
    applyPreviewUpdate(base({ revision: 2, viewState: { line: 8, offsetRatio: 0 } }));

    expect(getPreviewState('v1')).toMatchObject({ viewState: { line: 8, offsetRatio: 0 }, viewStateSource: 'update' });
  });

  it('an ordinary update after an attach drops the place and its tag together', () => {
    // A new revision with no place is "keep the reader where they are" (FR-024): the store holds a place
    // only from the update that brought it, and a tag never outlives its place.
    applyPreviewUpdate(base({ viewState: { line: 40, offsetRatio: 0 } }), 'attach');
    applyPreviewUpdate(base({ revision: 2, dirty: true }));

    const state = getPreviewState('v1')!;
    expect(state).not.toHaveProperty('viewState');
    expect(state).not.toHaveProperty('viewStateSource');
  });

  it('clearing the place drops its tag with it', () => {
    applyPreviewUpdate(base({ viewState: { line: 40, offsetRatio: 0 } }), 'attach');

    clearPreviewViewState('v1');

    const state = getPreviewState('v1')!;
    expect(state).not.toHaveProperty('viewState');
    expect(state).not.toHaveProperty('viewStateSource');
  });
});
