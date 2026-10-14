/**
 * 054 US2 (MT-02) — ticking a task box must not redraw the document the reader is looking at.
 *
 * Layer: component — the symptom is which DOM nodes survive a revision, and that needs the real Markdown
 * body inside the real panel chrome (jsdom, no app, no daemon). Nothing cheaper holds a rendered tree; an
 * E2E would only add a window, and "the table flashed" is already visible here as "the table is a different
 * element".
 *
 * Reported: "In previews, when I tick a task checkbox, I see the page refresh — all links and tables flash,
 * and tables resize quickly in place." A toggle changes ONE character of the source; every other block of
 * the document is byte-identical, so a reader should see only the box change.
 */
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COLD, mountMarkdownPreview, previewUpdate, README } from './helpers/mount-preview-panel.js';

const BEFORE = ['- [ ] write the spec', '', 'See [the docs](https://example.com/docs) for more.', '', '| name | size |', '| ---- | ---- |', '| one  | 1    |', '| two  | 2    |', ''].join('\n');
const AFTER = BEFORE.replace('- [ ] write the spec', '- [x] write the spec');

describe('a revision that only ticks a task box (054 US2)', () => {
  it('leaves the unchanged link and table as the very same elements, so nothing flashes or re-measures', async () => {
    const mounted = await mountMarkdownPreview(BEFORE);
    const body = await waitFor(
      () => {
        const el = document.querySelector<HTMLElement>(`[data-testid="preview-markdown-${mounted.id}"]`);
        expect(el).toBeTruthy();
        expect(el!.querySelector('a')).toBeTruthy();
        expect(el!.querySelector('table')).toBeTruthy();
        return el!;
      },
      COLD,
    );
    const link = body.querySelector('a')!;
    const table = body.querySelector('table')!;
    const box = body.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(false);

    // What main pushes after the toggle: same file, same navigation, a new revision, one character different.
    mounted.push(previewUpdate({ panelId: mounted.id, filePath: README, revision: 2, content: { kind: 'text', text: AFTER } }));

    // The new state is on screen…
    await waitFor(() => expect(body.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true), COLD);

    // …and the rest of the document was not rebuilt to show it.
    expect(body.querySelector('a')).toBe(link);
    expect(body.querySelector('table')).toBe(table);
    expect(link.isConnected).toBe(true);
    expect(table.isConnected).toBe(true);
  });
});
