/**
 * 054 FR-074 (manual test change request, 2026-10-11) — while an inline diagram of a preview is maximised
 * over it, the preview's document is covered, so its Find, Go to Heading, Copy, Select All, Synchronise
 * Scrolling, Outlining and Split are drawn disabled and their keys do nothing.
 *
 * Layer: component — the claim is about what the REAL preview panel's body menu draws and what its key
 * handlers do, in a mounted window; the section target is registered the way `DiagramFrame` registers one
 * (the diagram's own maximise control is `preview-diagram-frame.test.ts`).
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { __resetMaximise, maximiseSection, restoreAll } from '../../src/renderer/workspace/maximise-store.js';
import { COLD, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const DOC = '# One\n\nbody one\n\n## Two\n\nbody two\n';

let m: MountedPreviewWindow | undefined;

afterEach(() => {
  m?.unmount();
  m = undefined;
  __resetMaximise();
});

async function mountCovered(): Promise<{ body: HTMLElement; tabId: string }> {
  m = await mountMarkdownPreview(DOC);
  const body = await screen.findByText('body one', {}, COLD);
  const tabId = m.ws().layout!.tabs[0]!.id;
  act(() => maximiseSection(tabId, 'p1', 'diagram-0', () => createElement('span', null, 'the diagram')));
  return { body, tabId };
}

const LOCKED_ROWS = ['Find…', 'Go to Heading…', 'Select All', 'Synchronise Scrolling', 'Outlining', 'Split'];

function menuRow(label: string): HTMLElement {
  return screen.getByTestId(`menu-item-${label}`);
}

describe('a preview under its own maximised diagram (FR-074)', () => {
  it('draws Find, Go to Heading, Select All, Synchronise Scrolling, Outlining and Split disabled in the body menu', async () => {
    const { body } = await mountCovered();
    fireEvent.contextMenu(body, { clientX: 5, clientY: 5 });
    await screen.findByTestId('menu-item-Find…');
    for (const label of LOCKED_ROWS) expect(menuRow(label), label).toHaveAttribute('aria-disabled', 'true');
    expect(menuRow('Copy'), 'Copy').toHaveAttribute('aria-disabled', 'true');
  });

  it('enables them again once the diagram is minimised', async () => {
    const { body, tabId } = await mountCovered();
    act(() => restoreAll(tabId));
    fireEvent.contextMenu(body, { clientX: 5, clientY: 5 });
    await screen.findByTestId('menu-item-Find…');
    for (const label of LOCKED_ROWS) expect(menuRow(label), label).toHaveAttribute('aria-disabled', 'false');
  });

  it('Ctrl+A selects nothing in the covered document', async () => {
    const { body } = await mountCovered();
    window.getSelection()?.removeAllRanges();
    fireEvent.keyDown(body, { key: 'a', code: 'KeyA', ctrlKey: true });
    expect(window.getSelection()?.toString() ?? '').toBe('');
  });

  it('Go to Heading’s chord opens no outline over the covered document, and does once minimised', async () => {
    const { body, tabId } = await mountCovered();
    const goToHeading = { key: 'g', code: 'KeyG', ctrlKey: true } as const;
    fireEvent.keyDown(body, goToHeading);
    expect(screen.queryByTestId('heading-outline-p1')).toBeNull();
    act(() => restoreAll(tabId));
    fireEvent.keyDown(body, goToHeading);
    expect(await screen.findByTestId('heading-outline-p1')).toBeInTheDocument();
  });

  it('Ctrl+A still selects the document with nothing maximised (control)', async () => {
    m = await mountMarkdownPreview(DOC);
    const body = await screen.findByText('body one', {}, COLD);
    window.getSelection()?.removeAllRanges();
    fireEvent.keyDown(body, { key: 'a', code: 'KeyA', ctrlKey: true });
    expect(window.getSelection()?.toString() ?? '').toContain('body one');
  });
});
