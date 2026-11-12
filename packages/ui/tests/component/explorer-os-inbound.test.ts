/**
 * 067 T023 (FR-004, FR-005a, FR-014; research D5) — files dragged in from the OS onto the tree.
 *
 * Window-level `dragover` / `drop` listeners sit beside the tree's existing ones and handle `Files`
 * drags only. A row under the pointer is the folder target (a file row gives its parent). The effect
 * comes from the live modifiers (default copy; the tree's configured move modifier moves) and is shown
 * through `dropEffect`; a place that cannot receive the drop says `none` so the OS shows the
 * not-allowed pointer. The tree's own drags are untouched.
 *
 * jsdom has no DataTransfer, so each event carries a hand-made one; `getPathForFile` is the preload's
 * seam and is a double here (the real extraction is exactly what no test below this layer can reach).
 */
import { act, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installResizeObserver,
  mountExplorer,
  standardHost,
  uninstallResizeObserver,
  type MountedExplorer,
} from './helpers/explorer-harness.js';

beforeAll(installResizeObserver);
afterAll(uninstallResizeObserver);
beforeEach(() => {
  localStorage.clear();
  entered = false;
  unexpected.length = 0;
  // react-dnd refuses a second backend while the first still claims the window; a native drag started by
  // hand can leave that claim behind when its tree unmounts mid-gesture, so each test starts without it.
  Reflect.deleteProperty(window, '__isReactDndBackendSetUp');
  window.addEventListener('error', onWindowError);
});
afterEach(() => {
  window.removeEventListener('error', onWindowError);
  vi.restoreAllMocks();
  expect(unexpected, 'errors other than react-dnd reacting to a synthetic native drag').toEqual([]);
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

/*
 * react-dnd's HTML5 backend reacts to a native `Files` drag it did not see start (these events are
 * dispatched by hand): on a later animation frame it hovers targets the test never entered. That is the
 * backend's bookkeeping about a drag nobody is performing, and nothing below asserts on it. Vitest turns
 * any window error into a failure unless a listener exists, so one exists here, and it lets through
 * nothing but those messages.
 */
const DND_NOISE = /Invariant Violation|Cannot have two HTML5 backends|targetIds|while not dragging/;
const unexpected: string[] = [];
function onWindowError(e: ErrorEvent): void {
  const message = e.error instanceof Error ? e.error.message : String(e.message);
  e.preventDefault();
  if (!DND_NOISE.test(message)) unexpected.push(message);
}

const osPath = (f: File): string => (f.name.startsWith('virtual') ? '' : `/outside/${f.name}`);

async function mount(): Promise<MountedExplorer> {
  const m = await mountExplorer(standardHost, {
    extraBridge: { editor: { isOpen: () => Promise.resolve(false), getPathForFile: osPath } },
  });
  await waitFor(() => expect(row(m, 'Docs')).toBeTruthy());
  return m;
}

const row = (m: MountedExplorer, rel: string): HTMLElement =>
  m.tree.querySelector<HTMLElement>(`.tree-row[data-rel-path="${rel}"]`)!;
const highlighted = (m: MountedExplorer): string[] =>
  [...m.tree.querySelectorAll<HTMLElement>('.tree-row--drop-target')].map((r) => r.dataset.relPath!);

interface FakeDataTransfer {
  types: string[];
  files: File[];
  dropEffect: string;
  effectAllowed: string;
}

/** A browser fires `dragenter` before the first `dragover`; react-dnd's backend throws without it. */
let entered = false;

function drag(
  type: 'dragover' | 'drop' | 'dragleave' | 'dragend',
  target: Element,
  opts: { ctrl?: boolean; shift?: boolean; files?: File[]; types?: string[]; allowed?: string } = {},
): { ev: MouseEvent; dt: FakeDataTransfer } {
  if (!entered && (type === 'dragover' || type === 'drop')) {
    entered = true;
    drag('dragenter' as 'dragover', target, opts);
  }
  if (type === 'drop' || type === 'dragend') entered = false;
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ctrlKey: opts.ctrl === true,
    shiftKey: opts.shift === true,
  });
  const dt: FakeDataTransfer = {
    types: opts.types ?? ['Files'],
    files: opts.files ?? [new File(['x'], 'report.pdf')],
    dropEffect: 'none',
    effectAllowed: opts.allowed ?? 'all',
  };
  Object.defineProperty(ev, 'dataTransfer', { value: dt });
  act(() => {
    target.dispatchEvent(ev);
  });
  return { ev, dt };
}

describe('the label beside the pointer naming what a drop will do', () => {
  const label = (): HTMLElement => screen.getByTestId('tree-drag-label');

  it('names a file dragged in from the OS, and goes on the drop', async () => {
    const m = await mount();
    drag('dragover', row(m, 'Docs'));
    expect(label()).toHaveTextContent('Copy');
    drag('dragover', row(m, 'Docs'), { shift: true });
    expect(label()).toHaveTextContent('Move');
    drag('drop', row(m, 'Docs'));
    expect(label()).not.toBeVisible();
  });

  it('goes when a file from the OS moves off the tree', async () => {
    const m = await mount();
    drag('dragover', row(m, 'Docs'));
    drag('dragover', document.body);
    expect(label()).not.toBeVisible();
  });

  it('stays away from a web drag that is not a file from the OS (a tree drag shows the pointer instead, FR-112)', async () => {
    const m = await mount();
    drag('dragover', row(m, 'Docs'), { types: ['application/x-throng-tree-row'] });
    expect(label()).not.toBeVisible();
  });

  it('never takes the pointer, or the drop would land on it', async () => {
    await mount();
    expect(label()).toHaveClass('tree-drag-label');
  });
});

describe('an OS file drag over the tree (FR-004, FR-005a)', () => {
  it('claims the drag over a folder row, shows a copy by default and highlights that folder', async () => {
    const m = await mount();
    const { ev, dt } = drag('dragover', row(m, 'Docs'));
    expect(ev.defaultPrevented).toBe(true);
    expect(dt.dropEffect).toBe('copy');
    expect(highlighted(m)).toEqual(['Docs']);
  });

  it("follows the live modifiers: the configured move key moves, the copy key copies", async () => {
    const m = await mount();
    expect(drag('dragover', row(m, 'Docs'), { shift: true }).dt.dropEffect).toBe('move');
    expect(drag('dragover', row(m, 'Docs'), { ctrl: true }).dt.dropEffect).toBe('copy');
    expect(drag('dragover', row(m, 'Docs'), {}).dt.dropEffect).toBe('copy');
  });

  describe('on Linux, where the file manager sends no modifier but narrows what it offers', () => {
    beforeEach(() => {
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
    });

    it('shows a move while the OS offers one, and a copy once it stops', async () => {
      const m = await mount();
      expect(drag('dragover', row(m, 'Docs'), { allowed: 'copyMove' }).dt.dropEffect).toBe('move');
      expect(drag('dragover', row(m, 'Docs'), { allowed: 'copy' }).dt.dropEffect).toBe('copy');
    });

    it('moves on the drop when the last hover offered a move', async () => {
      const m = await mount();
      drag('dragover', row(m, 'Docs'), { allowed: 'copyMove' });
      drag('drop', row(m, 'Docs'), { allowed: 'copyMove' });
      await waitFor(() => expect(m.transfer.api.dropInbound).toHaveBeenCalledWith(['/outside/report.pdf'], 'Docs', 'cut'));
    });

    it('copies when the OS offers everything, which says nothing about a key', async () => {
      const m = await mount();
      expect(drag('dragover', row(m, 'Docs'), { allowed: 'all' }).dt.dropEffect).toBe('copy');
    });
  });

  it('ignores what the OS offers elsewhere, where a plain drag can offer a move', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const m = await mount();
    expect(drag('dragover', row(m, 'Docs'), { allowed: 'copyMove' }).dt.dropEffect).toBe('copy');
  });

  it('targets the PARENT folder when the pointer is over a file row', async () => {
    const m = await mount();
    drag('dragover', row(m, 'a.txt'));
    // a.txt sits at the root, so the root row is the target.
    expect(highlighted(m)).toEqual(['']);
  });

  it('shows the not-allowed pointer where the tree cannot receive a drop', async () => {
    const m = await mount();
    const { dt } = drag('dragover', screen.getByTestId('explorer-toolbar'));
    expect(dt.dropEffect).toBe('none');
    expect(highlighted(m)).toEqual([]);
  });

  it('drops the extracted absolute paths on the folder, as a copy by default', async () => {
    const m = await mount();
    const a = new File(['x'], 'one.png');
    const b = new File(['y'], 'two.png');
    const { ev } = drag('drop', row(m, 'Docs'), { files: [a, b] });
    expect(ev.defaultPrevented).toBe(true);
    await waitFor(() => expect(m.transfer.api.dropInbound).toHaveBeenCalledTimes(1));
    expect(m.transfer.api.dropInbound).toHaveBeenCalledWith(['/outside/one.png', '/outside/two.png'], 'Docs', 'copy');
    expect(highlighted(m)).toEqual([]);
  });

  it('drops as a move with the move modifier held', async () => {
    const m = await mount();
    drag('drop', row(m, 'a.txt'), { shift: true });
    await waitFor(() => expect(m.transfer.api.dropInbound).toHaveBeenCalled());
    expect(m.transfer.api.dropInbound).toHaveBeenCalledWith(['/outside/report.pdf'], '', 'cut');
  });

  it('raises ONE notice and sends nothing when no dropped item yields a path', async () => {
    const m = await mount();
    drag('drop', row(m, 'Docs'), { files: [new File(['x'], 'virtual-attachment.eml')] });
    await waitFor(() => expect(document.querySelectorAll('[data-testid="notices"] .notice')).toHaveLength(1));
    expect(m.transfer.api.dropInbound).not.toHaveBeenCalled();
  });

  it('drops only the items that yield a path when some do not', async () => {
    const m = await mount();
    drag('drop', row(m, 'Docs'), { files: [new File(['x'], 'ok.txt'), new File(['x'], 'virtual.eml')] });
    await waitFor(() => expect(m.transfer.api.dropInbound).toHaveBeenCalled());
    expect(m.transfer.api.dropInbound).toHaveBeenCalledWith(['/outside/ok.txt'], 'Docs', 'copy');
  });

  it('clears the highlight when the drag leaves the window or ends', async () => {
    const m = await mount();
    drag('dragover', row(m, 'Docs'));
    expect(highlighted(m)).toEqual(['Docs']);
    drag('dragend', document.body);
    expect(highlighted(m)).toEqual([]);
  });

  // dragend never fires for a drag that began in another program, so leaving the window is the only signal.
  it('clears the highlight when an OS drag leaves the window without dropping (no dragend ever comes)', async () => {
    const m = await mount();
    drag('dragover', row(m, 'Docs'));
    expect(highlighted(m)).toEqual(['Docs']);
    // Crossing from one element to another inside the window keeps it.
    const inside = new MouseEvent('dragleave', { bubbles: true, relatedTarget: row(m, 'Docs') });
    act(() => {
      document.body.dispatchEvent(inside);
    });
    expect(highlighted(m)).toEqual(['Docs']);
    // relatedTarget null: the pointer left the window.
    const out = new MouseEvent('dragleave', { bubbles: true, relatedTarget: null });
    act(() => {
      document.body.dispatchEvent(out);
    });
    expect(highlighted(m)).toEqual([]);
  });
});

describe("the tree's own drags are untouched (FR-014)", () => {
  it('does not claim, highlight or drop a drag that is not a Files drag', async () => {
    const m = await mount();
    drag('dragover', row(m, 'Docs'), { types: ['application/x-throng'] });
    expect(highlighted(m)).toEqual([]);
    drag('drop', row(m, 'Docs'), { types: ['application/x-throng'], files: [] });
    expect(m.transfer.api.dropInbound).not.toHaveBeenCalled();
  });
});
