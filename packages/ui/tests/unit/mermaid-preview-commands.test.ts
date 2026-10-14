/**
 * 054 (manual test change request, 2026-10-12) — a Mermaid file's preview is one picture, not a document:
 * its menus offer no Select All, Go to Heading or Synchronise Scrolling, and neither do its source's editor
 * menus. A Markdown preview keeps all three, in Focus Mode too. Opening the preview and going to the editor
 * are unaffected.
 *
 * Layer: unit — the pure menu builders, with the shipped provider descriptors.
 */
import { describe, expect, it } from 'vitest';
import { isFlowingDocument, SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS, type PreviewAffordance } from '@throng/core';
import { previewContentMenu } from '../../src/renderer/preview/content-menu.js';
import { panelHeaderMenu } from '../../src/renderer/workspace/panel-header-menu.js';

const provider = (id: string) => {
  const found = SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS.find((p) => p.id === id);
  if (!found) throw new Error(`no shipped provider ${id}`);
  return found;
};
const MERMAID = provider('mermaid');
const MARKDOWN = provider('markdown');

const labels = (items: readonly { label?: string }[]) => items.map((i) => i.label);

function previewMenu(flowingDocument: boolean) {
  return previewContentMenu({
    selectionEmpty: false,
    content: { copyFormat: 'rich', copy: () => {}, selectAll: () => {} },
    editorRoute: { parented: true, run: () => {} },
    find: { run: () => {} },
    goToHeading: { run: () => {} },
    flowingDocument,
  } as never);
}

function headerMenu(extra: Record<string, unknown>) {
  return panelHeaderMenu({
    panelVerb: 'Destroy',
    keybindings: { bindings: {} },
    otherTabs: [],
    panelFailure: false,
    detach: null,
    syncScroll: false,
    actions: new Proxy({}, { get: () => () => {} }),
    ...extra,
  } as never) as unknown as { label?: string }[];
}

describe('isFlowingDocument', () => {
  it('is false for the Mermaid provider and true for Markdown', () => {
    expect(isFlowingDocument(MERMAID)).toBe(false);
    expect(isFlowingDocument(MARKDOWN)).toBe(true);
    expect(isFlowingDocument(undefined)).toBe(false);
  });
});

describe('a Mermaid preview’s body menu', () => {
  it('offers no Select All or Go to Heading, and keeps Go to Editor', () => {
    const l = labels(previewMenu(false));
    expect(l).not.toContain('Select All');
    expect(l).not.toContain('Go to Heading…');
    expect(l).toContain('Go to Editor');
  });

  it('a Markdown preview keeps both', () => {
    const l = labels(previewMenu(true));
    expect(l).toContain('Select All');
    expect(l).toContain('Go to Heading…');
  });
});

describe('Synchronise Scrolling in the panel menu', () => {
  const editorWith = (p: typeof MERMAID) =>
    headerMenu({
      panel: { type: 'panel', id: 'e', kind: 'editor', title: 'E' },
      editor: { dirty: false, hasFilePath: true },
      openPreview: { state: 'enabled', provider: p } satisfies PreviewAffordance,
    });
  const previewWith = (flowingDocument: boolean) =>
    headerMenu({
      panel: { type: 'panel', id: 'p', kind: 'preview', title: 'P' },
      preview: { providerKind: 'text', parented: true, flowingDocument },
    });

  it('is absent from a .mmd editor and its preview, and Open Preview stays', () => {
    expect(labels(editorWith(MERMAID))).not.toContain('Synchronise Scrolling');
    expect(labels(editorWith(MERMAID))).toContain('Open Preview');
    expect(labels(previewWith(false))).not.toContain('Synchronise Scrolling');
  });

  it('is offered for a Markdown editor and its preview', () => {
    expect(labels(editorWith(MARKDOWN))).toContain('Synchronise Scrolling');
    expect(labels(previewWith(true))).toContain('Synchronise Scrolling');
  });
});

/** 054 (manual test change request, 2026-10-12) — the rows a right-click over a diagram adds. */
describe('a right-click over a diagram', () => {
  const withDiagram = (inFocus: boolean, focusChord?: string) =>
    previewContentMenu({
      selectionEmpty: true,
      find: { run: () => {} },
      goToHeading: { run: () => {} },
      diagram: { inFocus, copyImage: () => {}, toggleFocus: () => {}, ...(focusChord ? { focusChord } : {}) },
    } as never);

  it('leads with Copy Diagram as Image and Enter Focus Mode, in the Contextual section', () => {
    const items = withDiagram(false);
    expect(items.slice(0, 2).map((i) => [i.label, i.section])).toEqual([
      ['Copy Diagram as Image', 'contextual'],
      ['Enter Focus Mode', 'contextual'],
    ]);
  });

  it('reads Exit Focus Mode while the diagram is in it, with the chord when there is one', () => {
    const row = withDiagram(true, 'Shift+Alt+Enter').find((i) => i.label === 'Exit Focus Mode');
    expect(row?.shortcut).toBe('Shift+Alt+Enter');
  });

  it('adds nothing away from a diagram', () => {
    expect(labels(previewMenu(true))).not.toContain('Copy Diagram as Image');
  });
});
