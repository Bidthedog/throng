/**
 * 067 T087 (FR-069 to FR-073, FR-069a) — Save and Save As in an editor panel's title bar.
 *
 * Right-aligned, left of the common panel icons, with a separator between the two groups. Other
 * panels show neither the icons nor the separator. Each calls the same action as the chord and the
 * menu item (there is no second save path), carries the live binding in its tooltip, and is disabled
 * exactly when its menu item is, with the reason in the tooltip. Save As hides first when the title
 * bar is narrow, then Save, then the separator; widening restores them.
 *
 * jsdom has no layout, so the width the header reports is driven through a ResizeObserver double.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, firstBinding } from '@throng/core';
import { getEditorState, removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { getEditorActions } from '../../src/renderer/editor/editor-actions.js';
import { __resetDirtyCloseStore } from '../../src/renderer/editor/dirty-close-store.js';
import { mountEditor } from './helpers/mount-editor.js';
import { mountMarkdownPreview } from './helpers/mount-preview-panel.js';

const PANEL = 'p-ed';

/** Every ResizeObserver the tree creates, so a test can resize whichever one watches the header. */
const observers: { cb: ResizeObserverCallback; targets: Element[] }[] = [];
class FakeResizeObserver implements ResizeObserver {
  private readonly entry: { cb: ResizeObserverCallback; targets: Element[] };
  constructor(cb: ResizeObserverCallback) {
    this.entry = { cb, targets: [] };
    observers.push(this.entry);
  }
  observe(target: Element): void {
    this.entry.targets.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    this.entry.targets = [];
  }
}

/** Report `width` as the header's width to whoever observes it. */
function resizeHeader(width: number): void {
  const header = screen.getByTestId(`panel-handle-${PANEL}`);
  act(() => {
    for (const o of observers) {
      const watching = o.targets.filter((t) => t === header || t.contains(header) || header.contains(t));
      if (watching.length === 0) continue;
      o.cb(
        watching.map(
          (target) =>
            ({
              target,
              contentRect: { width, height: 24, top: 0, left: 0, right: width, bottom: 24, x: 0, y: 0 },
            }) as unknown as ResizeObserverEntry,
        ),
        {} as ResizeObserver,
      );
    }
  });
}

beforeEach(() => {
  observers.length = 0;
  globalThis.ResizeObserver = FakeResizeObserver;
});
afterEach(() => {
  __resetDirtyCloseStore();
  removeEditorState(PANEL);
  Reflect.deleteProperty(window, 'throng');
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
  document.body.replaceChildren();
});

const save = (): HTMLElement => screen.getByTestId(`panel-save-${PANEL}`);
const saveAs = (): HTMLElement | null => screen.queryByTestId(`panel-save-as-${PANEL}`);
const sep = (): HTMLElement | null => screen.queryByTestId(`panel-save-separator-${PANEL}`);

async function mountWithHeader(): Promise<ReturnType<typeof mountEditor>> {
  const h = mountEditor({
    panelId: PANEL,
    doc: { text: 'body\n', version: 1, absPath: 'C:/proj/note.txt' },
    withHeader: true,
  });
  await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe('C:/proj/note.txt'));
  await screen.findByTestId(`panel-handle-${PANEL}`);
  return h;
}

describe('an editor panel (FR-069, FR-070)', () => {
  it('shows Save then Save As then a separator, before the common icons, with the themed save tokens', async () => {
    await mountWithHeader();
    const actions = save().parentElement!;
    const order = [...actions.children].map((c) => c.getAttribute('data-testid'));
    expect(order.indexOf(`panel-save-${PANEL}`)).toBeLessThan(order.indexOf(`panel-save-as-${PANEL}`));
    expect(order.indexOf(`panel-save-as-${PANEL}`)).toBeLessThan(order.indexOf(`panel-save-separator-${PANEL}`));
    expect(order.indexOf(`panel-save-separator-${PANEL}`)).toBeLessThan(order.indexOf(`panel-maximise-${PANEL}`));
    expect(save().querySelector('.icon')?.textContent).toBe('🖪');
    expect(saveAs()!.querySelector('.icon')?.textContent).toBe('🖫');
    expect(sep()!.getAttribute('role')).toBe('separator');
  });

  it('names each action with its live binding, as an accessible name and a tooltip', async () => {
    await mountWithHeader();
    const saveChord = firstBinding(DEFAULT_KEYBINDINGS, 'editor.save');
    const saveAsChord = firstBinding(DEFAULT_KEYBINDINGS, 'editor.saveAs');
    expect(save().getAttribute('title')).toBe(`Save (${saveChord})`);
    expect(save().getAttribute('aria-label')).toBe(save().getAttribute('title'));
    expect(saveAs()!.getAttribute('title')).toBe(`Save As (${saveAsChord})`);
  });

  it('is reachable by keyboard: both are real, tabbable buttons', async () => {
    await mountWithHeader();
    expect(save().tagName).toBe('BUTTON');
    expect(save().getAttribute('tabindex')).not.toBe('-1');
    expect(saveAs()!.tagName).toBe('BUTTON');
  });
});

describe('a panel that is not an editor (FR-070)', () => {
  it('shows no save icons and no extra separator', async () => {
    const m = await mountMarkdownPreview('hello', 'D:/proj/notes.md', {});
    await screen.findByTestId(`panel-handle-${m.id}`);
    expect(screen.queryByTestId(`panel-save-${m.id}`)).toBeNull();
    expect(screen.queryByTestId(`panel-save-as-${m.id}`)).toBeNull();
    expect(screen.queryByTestId(`panel-save-separator-${m.id}`)).toBeNull();
    m.unmount();
  });
});

describe('what they do (FR-071)', () => {
  it('Save runs the same editor action the chord and the menu run', async () => {
    await mountWithHeader();
    const actions = getEditorActions(PANEL)!;
    const spy = vi.spyOn(actions, 'save').mockResolvedValue(undefined as never);
    fireEvent.click(save());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('Save As runs the same editor action', async () => {
    await mountWithHeader();
    const actions = getEditorActions(PANEL)!;
    const spy = vi.spyOn(actions, 'saveAs').mockResolvedValue(undefined as never);
    fireEvent.click(saveAs()!);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('disabled exactly as the menu is (FR-073)', () => {
  it('Save is disabled with the reason in its tooltip when the file moved to another project; Save As stays', async () => {
    const h = await mountWithHeader();
    act(() => h.pushSync({ movedTo: 'D:/other/note.txt', movedOut: true }));
    await waitFor(() => expect(save()).toBeDisabled());
    expect(save().getAttribute('title')).toMatch(/moved to another project/i);
    expect(save().getAttribute('title')).toMatch(/Save As/);
    expect(saveAs()).not.toBeDisabled();

    // The menu agrees: Save greyed, Save As live.
    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${PANEL}`));
    expect(await screen.findByTestId('menu-item-Save')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('menu-item-Save As…')).not.toHaveAttribute('aria-disabled', 'true');
  });
});

describe('a narrow title bar (FR-069a)', () => {
  it('hides Save As first, then Save and the separator, and widening restores them', async () => {
    await mountWithHeader();

    resizeHeader(1000);
    expect(saveAs()).not.toBeNull();

    resizeHeader(330);
    await waitFor(() => expect(saveAs()).toBeNull());
    expect(screen.queryByTestId(`panel-save-${PANEL}`)).not.toBeNull();
    expect(sep()).not.toBeNull();

    resizeHeader(200);
    await waitFor(() => expect(screen.queryByTestId(`panel-save-${PANEL}`)).toBeNull());
    expect(sep()).toBeNull();

    resizeHeader(1000);
    await waitFor(() => expect(saveAs()).not.toBeNull());
    expect(screen.queryByTestId(`panel-save-${PANEL}`)).not.toBeNull();
    expect(sep()).not.toBeNull();
  });

  it('keeps both actions on the panel menu however narrow it is', async () => {
    await mountWithHeader();
    resizeHeader(200);
    await waitFor(() => expect(screen.queryByTestId(`panel-save-${PANEL}`)).toBeNull());
    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${PANEL}`));
    expect(await screen.findByTestId('menu-item-Save')).toBeTruthy();
    expect(screen.getByTestId('menu-item-Save As…')).toBeTruthy();
  });
});
