/**
 * 054 T023 — a task-list checkbox in the preview toggles its marker in the source (FR-020 – FR-028,
 * research R4, contracts/preview-ipc-054.md).
 *
 * Layer: component — what the click and Space do is the body's DOM handling and the chrome's wiring to
 * `window.throng.preview.toggleTask`; the edit itself (open document, closed file, fidelity) is main's and
 * is proved at the integration layer. Here main is the bridge mock, and "the source changed" is main's
 * next content update, exactly as the relay delivers it.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLD, README, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const DOC = ['# Tasks', '', '- [ ] write the spec', '- [x] **ship** it', '', 'After.'].join('\n');

let pv: MountedPreviewWindow | undefined;

afterEach(() => {
  pv?.unmount();
  pv = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function mount(text = DOC, shown = 'write the spec'): Promise<{ id: string; boxes: () => HTMLInputElement[] }> {
  pv = await mountMarkdownPreview(text);
  await screen.findByText(shown, {}, COLD);
  const boxes = (): HTMLInputElement[] => [
    ...screen.getByTestId(`preview-markdown-${pv!.id}`).querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ];
  return { id: pv.id, boxes };
}

describe('click and Space ask main to toggle the marker (FR-022)', () => {
  it('a click sends the line, the state the reader saw and the item text, and prevents the native toggle', async () => {
    const { id, boxes } = await mount();
    const [first] = boxes();

    const notPrevented = fireEvent.click(first);

    expect(notPrevented).toBe(false);
    expect(first.checked).toBe(false);
    await waitFor(() =>
      expect(pv!.preview.toggleTask).toHaveBeenCalledWith({
        panelId: id,
        filePath: README,
        line: 2,
        expectChecked: false,
        itemText: 'write the spec',
      }),
    );
  });

  it('the item text is the SOURCE after the marker, so a formatted item is fingerprinted as written', async () => {
    const { boxes } = await mount();
    fireEvent.click(boxes()[1]);
    await waitFor(() =>
      expect(pv!.preview.toggleTask).toHaveBeenCalledWith(
        expect.objectContaining({ line: 3, expectChecked: true, itemText: '**ship** it' }),
      ),
    );
  });

  it('Space on a focused checkbox does the same, and its default is prevented', async () => {
    const { boxes } = await mount();
    const [first] = boxes();
    first.focus();

    const notPrevented = fireEvent.keyDown(first, { key: ' ', code: 'Space' });

    expect(notPrevented).toBe(false);
    await waitFor(() => expect(pv!.preview.toggleTask).toHaveBeenCalledTimes(1));
    expect(pv!.preview.toggleTask).toHaveBeenCalledWith(expect.objectContaining({ line: 2, expectChecked: false }));
  });

  it('a raw HTML checkbox the document wrote is not a task: nothing is asked of main', async () => {
    const { boxes } = await mount('- [ ] real\n\n<input type="checkbox">', 'real');
    const raw = boxes()[1];
    expect(raw.disabled).toBe(true);
    fireEvent.click(raw);
    await act(() => Promise.resolve());
    expect(pv!.preview.toggleTask).not.toHaveBeenCalled();
  });
});

describe('every other input still changes nothing (044 FR-020, otherwise intact)', () => {
  it('typing, Enter, paste and drop on a task box ask nothing of main and leave it as it was', async () => {
    const { boxes } = await mount();
    const [first] = boxes();
    first.focus();
    for (const key of ['x', 'Enter', 'Backspace']) fireEvent.keyDown(first, { key });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    first.dispatchEvent(paste);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    first.dispatchEvent(drop);
    await act(() => Promise.resolve());

    expect(paste.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
    expect(first.checked).toBe(false);
    expect(pv!.preview.toggleTask).not.toHaveBeenCalled();
  });
});

describe('the outcome (FR-026, FR-028)', () => {
  it('a refusal raises ONE notice on the preview and the box keeps its previous state', async () => {
    const { id, boxes } = await mount();
    pv!.preview.toggleTask.mockResolvedValue({ ok: false, reason: 'readOnly' });

    fireEvent.click(boxes()[0]);
    const notice = await screen.findByTestId(`preview-task-notice-${id}`);
    expect(notice).toHaveTextContent(/read-only/);
    expect(boxes()[0].checked).toBe(false);

    fireEvent.click(boxes()[0]);
    await waitFor(() => expect(pv!.preview.toggleTask).toHaveBeenCalledTimes(2));
    await act(() => Promise.resolve());
    expect(screen.getAllByTestId(`preview-task-notice-${id}`)).toHaveLength(1);
  });

  it('the notice names a refusal for the item having moved without exposing the reason code', async () => {
    const { id, boxes } = await mount();
    pv!.preview.toggleTask.mockResolvedValue({ ok: false, reason: 'ambiguous' });
    fireEvent.click(boxes()[0]);
    const notice = await screen.findByTestId(`preview-task-notice-${id}`);
    expect(notice.textContent).not.toMatch(/ambiguous/);
    expect(notice).toHaveTextContent(/task/i);
  });

  it('after a successful toggle the re-render shows the new state and keeps the scroll position', async () => {
    // The host's viewport starts at y 100; every source line is 20px tall (as the other preview tests supply it).
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
      const scroller = document.querySelector<HTMLElement>('.preview-panel__body');
      if (this === scroller) return { top: 100, height: 400, left: 0, width: 400 } as DOMRect;
      const line = Number(this.getAttribute('data-source-line'));
      return { top: 100 + line * 20 - (scroller?.scrollTop ?? 0), height: 40, left: 0, width: 400 } as DOMRect;
    });
    const long = [...Array.from({ length: 40 }, (_, i) => `P${i}\n`), '- [ ] late task'].join('\n');
    const { id, boxes } = await mount(long, 'late task');
    const host = screen.getByTestId(`preview-body-${id}`);
    host.scrollTop = 300;

    fireEvent.click(boxes()[0]);
    await waitFor(() => expect(pv!.preview.toggleTask).toHaveBeenCalledTimes(1));
    // Main applied the edit; the relay brings the new text, as it does for any edit.
    pv!.push(previewUpdate({ panelId: id, revision: 2, content: { kind: 'text', text: long.replace('[ ]', '[x]') } }));

    await waitFor(() => expect(boxes()[0].checked).toBe(true));
    expect(host.scrollTop).toBe(300);
  });
});
