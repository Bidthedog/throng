/**
 * 047 T049 (US3, FR-037, FR-038, contracts "Commands") — the `markdown.*` fold chords, mounted over a
 * real Markdown preview.
 *
 * Hosted on the PANEL's own body host (`bodyHostRef`), never window-level: the same `ChordEngine`
 * `editor/commands.ts` hosts per CodeMirror view (Principle VIII, `keybindings/chord-engine.ts`'s own
 * doc comment names this exact task), reading strokes with the same `strokeLabel` rule. Because the
 * engine is attached directly to the panel that received the keydown, "act on ... a focused preview's
 * view" (FR-037) falls out of WHERE the listener sits — no separate scope resolution is needed the way
 * `preview-commands.tsx`'s window-level listener needs one for single-stroke actions.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewProviderRegistry } from '@throng/core';
import { getPendingChord } from '../../src/renderer/editor/pending-chord.js';
import { __resetFoldStateStore } from '../../src/renderer/editor/fold-state-store.js';
import { COLD, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const DOC = '# One\n\nbody one\n\n## Two\n\nbody two\n';

let m: MountedPreviewWindow | undefined;

afterEach(() => {
  m?.unmount();
  m = undefined;
  __resetFoldStateStore();
});

/** `Ctrl+<first>` then, with Ctrl still held (FR-124), `Ctrl+<second>` — a complete two-stroke chord. */
function chord(host: HTMLElement, first: string, second: string): void {
  fireEvent.keyDown(host, { key: first, code: `Key${first.toUpperCase()}`, ctrlKey: true });
  fireEvent.keyDown(host, { key: second, code: `Key${second.toUpperCase()}`, ctrlKey: true });
}

describe('Ctrl+M,A / Ctrl+M,L act on the WHOLE document (contracts "Commands")', () => {
  it('Ctrl+M,A collapses every section; Ctrl+M,X is unbound; Ctrl+M,L expands them again', async () => {
    m = await mountMarkdownPreview(DOC);
    const bodyOne = await screen.findByText('body one', {}, COLD);
    const bodyTwo = screen.getByText('body two');
    const host = screen.getByTestId(`preview-body-${m.id}`);

    chord(host, 'm', 'a');
    await waitFor(() => expect(bodyOne).not.toBeVisible());
    expect(bodyTwo).not.toBeVisible();

    // Unbound by review (2026-09-28): Expand All stays on the menus, and the chord does nothing.
    chord(host, 'm', 'x');
    expect(bodyOne).not.toBeVisible();

    chord(host, 'm', 'l');
    await waitFor(() => expect(bodyOne).toBeVisible());
    expect(bodyTwo).toBeVisible();
  });
});

/*
 * jsdom lays out every element at (0,0): both headings tie at the viewport top, and
 * `computeCurrentHeadingSlug` (shared with the Go to Heading pop-down's own "current" sampling) keeps
 * the LAST one it sees at-or-before that point — so with these two headings it deterministically
 * resolves to "two", the same way a real scroll to the very top of a short document would.
 */
describe('Ctrl+M,S / Ctrl+M,M act on the section at the TOP OF THE VIEW (FR-037)', () => {
  it('Ctrl+M,S collapses it, Ctrl+M,E is unbound, Ctrl+M,M expands it — the OTHER section is untouched throughout', async () => {
    m = await mountMarkdownPreview(DOC);
    const bodyOne = await screen.findByText('body one', {}, COLD);
    const bodyTwo = screen.getByText('body two');
    const host = screen.getByTestId(`preview-body-${m.id}`);

    chord(host, 'm', 's');
    await waitFor(() => expect(bodyTwo).not.toBeVisible());
    expect(bodyOne).toBeVisible();

    // Unbound by review (2026-09-28): Expand This Section stays on the menus.
    chord(host, 'm', 'e');
    expect(bodyTwo).not.toBeVisible();

    chord(host, 'm', 'm');
    await waitFor(() => expect(bodyTwo).toBeVisible());
    expect(bodyOne).toBeVisible();
  });

  it('Ctrl+M,M toggles it', async () => {
    m = await mountMarkdownPreview(DOC);
    const bodyTwo = await screen.findByText('body two', {}, COLD);
    const host = screen.getByTestId(`preview-body-${m.id}`);

    chord(host, 'm', 'm');
    await waitFor(() => expect(bodyTwo).not.toBeVisible());

    chord(host, 'm', 'm');
    await waitFor(() => expect(bodyTwo).toBeVisible());
  });
});

describe('the pending indicator (FR-092), shared with the editor’s own', () => {
  it('shows after Ctrl+M alone, names the stroke, and clears once the chord completes', async () => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByText('body one', {}, COLD);
    const host = screen.getByTestId(`preview-body-${m.id}`);

    fireEvent.keyDown(host, { key: 'm', code: 'KeyM', ctrlKey: true });
    const shown = getPendingChord();
    expect(shown).not.toBeNull();
    expect(shown!.kind).toBe('pending');
    expect(shown!.keys).toBe('Ctrl+M');

    fireEvent.keyDown(host, { key: 'a', code: 'KeyA', ctrlKey: true });
    expect(getPendingChord()).toBeNull();
  });

  it('reports the completed chord as unbound when the second key matches nothing', async () => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByText('body one', {}, COLD);
    const host = screen.getByTestId(`preview-body-${m.id}`);

    fireEvent.keyDown(host, { key: 'm', code: 'KeyM', ctrlKey: true });
    fireEvent.keyDown(host, { key: 'z', code: 'KeyZ', ctrlKey: true });

    const shown = getPendingChord();
    expect(shown).not.toBeNull();
    expect(shown!.kind).toBe('unbound');
    expect(shown!.keys).toBe('Ctrl+M,Z');
  });
});

describe('absent for a non-Markdown provider', () => {
  it('Ctrl+M,A folds nothing and shows no indicator — the panel has no fold state to act on', async () => {
    const registry = createPreviewProviderRegistry([{ id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' }]);
    const FakeBody = ({ panelId, content }: { panelId: string; content: { kind: string; text?: string } }) =>
      createElement('div', { 'data-testid': `fake-body-${panelId}` }, content.kind === 'text' ? content.text : '');
    const views = { testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(FakeBody) } };
    m = await mountMarkdownPreview('hello', 'D:/proj/notes.prvtxt', {
      providers: { registry, views: views as never },
      providerId: 'testText',
    });
    const host = await screen.findByTestId(`fake-body-${m.id}`);
    const panelBody = host.closest('[data-testid^="preview-body-"]') as HTMLElement;

    chord(panelBody, 'm', 'a');

    expect(getPendingChord()).toBeNull();
  });
});
