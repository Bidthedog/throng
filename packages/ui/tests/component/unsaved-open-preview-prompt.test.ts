/**
 * 073 FR-033b — the unsaved-on-open prompt a CSV Preview Editor raises is the editor's own dialog (one request store,
 * one `choose` mechanism), with its third choice worded for a preview: "Open in new preview" in place of "Open in new
 * editor". The choices are Save & open, Discard & open, Open in new preview and Cancel, and dismissal is Cancel.
 *
 * Layer: component — the dialog's labels and the choice it resolves with need the real dialog and its `ConfirmProvider`.
 * Which choice does what is `open-preview.test.ts`'s (renderer) and `preview-csv-reuse.integration.test.ts`'s (main).
 */
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { UnsavedOpenDialog } from '../../src/renderer/editor/unsaved-open-dialog.js';
import { promptUnsavedOpen, type UnsavedOpenChoice } from '../../src/renderer/editor/unsaved-open-store.js';

function mount(): void {
  render(createElement(ConfirmProvider, null, createElement(UnsavedOpenDialog)));
}

let asked: Promise<UnsavedOpenChoice> | undefined;
const ask = (opts?: { newLabel?: string }): void => {
  act(() => {
    asked = promptUnsavedOpen('b.csv', 'a.csv', opts);
  });
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('the unsaved-on-open prompt for a preview (FR-033b)', () => {
  it('words the third choice for a preview, and names both the panel and the arriving file', async () => {
    mount();
    ask({ newLabel: 'Open in new preview' });
    const dialog = await screen.findByTestId('unsaved-open-dialog');
    expect(dialog.textContent).toContain('a.csv');
    expect(dialog.textContent).toContain('b.csv');
    expect(screen.getByTestId('unsaved-open-new').textContent).toBe('Open in new preview');
    expect(screen.getByTestId('unsaved-open-save').textContent).toBe('Save & open');
    expect(screen.getByTestId('unsaved-open-discard').textContent).toBe('Discard & open');
    expect(screen.getByTestId('unsaved-open-cancel').textContent).toBe('Cancel');
    fireEvent.click(screen.getByTestId('unsaved-open-cancel'));
    await asked;
  });

  it('keeps the editor\'s own wording when no label is given', async () => {
    mount();
    ask();
    await screen.findByTestId('unsaved-open-dialog');
    expect(screen.getByTestId('unsaved-open-new').textContent).toBe('Open in new editor');
    fireEvent.click(screen.getByTestId('unsaved-open-cancel'));
    await asked;
  });

  for (const [testId, choice] of [
    ['unsaved-open-save', 'save'],
    ['unsaved-open-discard', 'discard'],
    ['unsaved-open-new', 'new'],
    ['unsaved-open-cancel', 'cancel'],
  ] as const) {
    it(`${testId} resolves ${choice}`, async () => {
      mount();
      ask({ newLabel: 'Open in new preview' });
      await screen.findByTestId('unsaved-open-dialog');
      fireEvent.click(screen.getByTestId(testId));
      await waitFor(async () => expect(await asked).toBe(choice));
    });
  }
});
