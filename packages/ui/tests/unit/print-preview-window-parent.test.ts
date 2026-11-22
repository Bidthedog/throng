/**
 * Print Preview's parent (maintainer, 2026-11-22: "Double clicking the title bar of the print preview should
 * maximise / restore the window").
 *
 * A double-click on a frameless window's drag region is the operating system's: Chromium asks the window manager to
 * maximise, and Mutter refuses for a transient (parented) window (`window-maximise.ts`). Where Print Preview's
 * modality is emulated (Linux), nothing needs the parent, so the window has none and the double-click maximises it;
 * closing the window it serves still closes it. Native modality keeps the parent.
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const created: Array<{ options: Record<string, unknown>; win: FakeWindow }> = [];

class FakeWindow extends EventEmitter {
  destroyed = false;
  webContents = { send: vi.fn() };
  constructor(options: Record<string, unknown> = {}) {
    super();
    created.push({ options, win: this });
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  close(): void {
    this.destroyed = true;
    this.emit('close');
    this.emit('closed');
  }
  focus(): void {}
  loadFile(): Promise<void> {
    return Promise.resolve();
  }
}

vi.mock('electron', () => ({ BrowserWindow: FakeWindow }));
vi.mock('../../src/main/app-icon.js', () => ({ appIcon: () => undefined }));
vi.mock('../../src/main/window-open-guard.js', () => ({ denyRendererWindows: () => undefined }));
vi.mock('../../src/main/reveal-when-painted.js', () => ({ revealWhenPainted: () => undefined }));
vi.mock('../../src/main/window-controls-ipc.js', () => ({ wireWindowMaximizeEvents: () => undefined }));
vi.mock('../../src/main/window-placement.js', () => ({ placeOverParent: () => ({}) }));

const { openPrintPreviewWindow } = await import('../../src/main/print-preview-window.js');

const deps = (emulateModal: boolean) => ({
  indexHtml: 'index.html',
  preloadPath: 'preload.js',
  shellIntegration: {} as never,
  emulateModal,
});

beforeEach(() => {
  created.length = 0;
});

describe('Print Preview and the window it serves', () => {
  it('with modality emulated, has no parent, so the window manager maximises it on a title-bar double-click', () => {
    const owner = new FakeWindow();
    openPrintPreviewWindow(owner, 'job', deps(true));
    const preview = created[1]!;
    expect(preview.options.parent).toBeUndefined();
    expect(preview.options.modal).toBeUndefined();
  });

  it('with modality emulated, closes when the window it serves closes', () => {
    const owner = new FakeWindow();
    openPrintPreviewWindow(owner, 'job', deps(true));
    const preview = created[1]!.win;
    owner.close();
    expect(preview.isDestroyed()).toBe(true);
  });

  it('with native modality, is the modal child of the window it serves', () => {
    const owner = new FakeWindow();
    openPrintPreviewWindow(owner, 'job', deps(false));
    expect(created[1]!.options).toMatchObject({ parent: owner, modal: true });
  });
});
