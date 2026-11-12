/**
 * 067 T119-T123 (FR-110, FR-111, FR-112, FR-113, FR-114; research D21-D23) — the mouse-driven backend
 * the File Explorer tree runs on.
 *
 * The manager is a double: what is under test is what the backend asks of react-dnd and what it
 * dispatches at the page, not react-dnd. jsdom has no layout, so each target's rectangle is stated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTreeDropEffect } from '../../src/renderer/explorer/tree-drag-store.js';
import {
  bindTreePointerController,
  treePointerBackend,
  type TreePointerController,
} from '../../src/renderer/explorer/tree-pointer-backend.js';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}

interface Rig {
  actions: Record<string, ReturnType<typeof vi.fn>>;
  monitor: { canDragSource: ReturnType<typeof vi.fn>; isDragging: () => boolean; canDropOnTarget: ReturnType<typeof vi.fn> };
  controller: { [K in keyof TreePointerController]: ReturnType<typeof vi.fn> };
  source: HTMLElement;
  list: HTMLElement;
  folder: HTMLElement;
  outside: HTMLElement;
  teardown(): void;
}

let rig: Rig;

function build(): Rig {
  let dragging = false;
  const actions = {
    beginDrag: vi.fn(() => {
      dragging = true;
    }),
    publishDragSource: vi.fn(),
    hover: vi.fn(),
    drop: vi.fn(),
    endDrag: vi.fn(() => {
      dragging = false;
    }),
  };
  const monitor = { canDragSource: vi.fn(() => true), isDragging: () => dragging, canDropOnTarget: vi.fn(() => true) };
  const manager = { getActions: () => actions, getMonitor: () => monitor };
  const backend = treePointerBackend(manager as never, undefined as never, undefined as never);
  backend.setup();

  const list = document.body.appendChild(document.createElement('div'));
  list.getBoundingClientRect = () => rect(0, 100, 200, 300);
  const folder = list.appendChild(document.createElement('div'));
  folder.getBoundingClientRect = () => rect(0, 150, 200, 24);
  const source = list.appendChild(document.createElement('div'));
  source.getBoundingClientRect = () => rect(0, 200, 200, 24);
  // A row react-window renders past the bottom of the visible list.
  const overscan = list.appendChild(document.createElement('div'));
  overscan.getBoundingClientRect = () => rect(0, 420, 200, 24);
  const outside = document.body.appendChild(document.createElement('div'));
  outside.getBoundingClientRect = () => rect(300, 0, 200, 600);
  document.elementFromPoint = (x: number) => (x >= 300 ? outside : null);

  const controller = {
    effectFor: vi.fn((mods: { ctrl?: boolean }) => (mods.ctrl ? 'copy' : 'move')),
    begin: vi.fn(() => ['a.txt']),
    setCopy: vi.fn(),
    end: vi.fn(),
    handOver: vi.fn(),
    scrollElement: vi.fn(() => list),
    clearHover: vi.fn(),
  };
  const unbind = bindTreePointerController(controller as never);
  backend.connectDragSource('src', source);
  backend.connectDropTarget('list', list);
  backend.connectDropTarget('folder', folder);
  backend.connectDropTarget('overscan', overscan);
  return {
    actions,
    monitor,
    controller,
    source,
    list,
    folder,
    outside,
    teardown() {
      backend.teardown();
      unbind();
      list.remove();
      outside.remove();
      delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    },
  };
}

type Mods = { ctrlKey?: boolean; shiftKey?: boolean };
const mouse = (type: string, target: EventTarget, x: number, y: number, init: Mods & { buttons?: number } = {}): MouseEvent => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, ...init });
  target.dispatchEvent(ev);
  return ev;
};
const press = (x = 10, y = 210, init: Mods = {}): void => void mouse('mousedown', rig.source, x, y, init);
const moveTo = (x: number, y: number, init: Mods = {}): void => void mouse('mousemove', document.body, x, y, init);
const release = (x: number, y: number, init: Mods = {}): void => void mouse('mouseup', document.body, x, y, { ...init, buttons: 0 });
const key = (type: 'keydown' | 'keyup', k: string, init: Mods = {}): KeyboardEvent => {
  const ev = new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(ev);
  return ev;
};
const shown = (): string | undefined => document.documentElement.dataset.treeDrag;
/** Over the folder row. */
const ON_FOLDER: [number, number] = [20, 160];
const BODY_ONLY: [number, number] = [20, 450];

beforeEach(() => {
  rig = build();
});
afterEach(() => {
  rig.teardown();
  vi.useRealTimers();
});

describe('starting a drag (FR-110)', () => {
  it('stays a click until the pointer is past the threshold', () => {
    press();
    moveTo(12, 211);
    release(12, 211);
    expect(rig.actions.beginDrag).not.toHaveBeenCalled();
  });

  it('begins on the row pressed once the pointer travels', () => {
    press();
    moveTo(10, 190);
    expect(rig.controller.begin).toHaveBeenCalledWith(rig.source);
    expect(rig.actions.beginDrag).toHaveBeenCalledOnce();
    expect(rig.actions.publishDragSource).toHaveBeenCalled();
  });

  it('does not take the press for itself', () => {
    const down = mouse('mousedown', rig.source, 10, 210);
    expect(down.defaultPrevented).toBe(false);
  });

  it('does not begin for a row react-dnd will not drag (a row in rename)', () => {
    rig.monitor.canDragSource.mockReturnValue(false);
    press();
    moveTo(10, 190);
    expect(rig.actions.beginDrag).not.toHaveBeenCalled();
    expect(rig.controller.begin).not.toHaveBeenCalled();
  });

  it('does not begin for a row that carries nothing (the root)', () => {
    rig.controller.begin.mockReturnValue(null);
    press();
    moveTo(10, 190);
    expect(rig.actions.beginDrag).not.toHaveBeenCalled();
  });

  it('ignores a press that began on a control inside the row', () => {
    const twisty = rig.source.appendChild(document.createElement('button'));
    mouse('mousedown', twisty, 10, 210);
    moveTo(10, 190);
    expect(rig.actions.beginDrag).not.toHaveBeenCalled();
  });
});

describe('the keys (FR-111)', () => {
  it('moves with no key held', () => {
    press();
    moveTo(...ON_FOLDER);
    expect(shown()).toBe('move');
  });

  it('copies when the copy key was held before the drag started', () => {
    press(10, 210, { ctrlKey: true });
    moveTo(...ON_FOLDER, { ctrlKey: true });
    expect(shown()).toBe('copy');
  });

  it('copies when the key goes down mid-drag, and moves again the moment it is released', () => {
    press();
    moveTo(...ON_FOLDER);
    key('keydown', 'Control', { ctrlKey: true });
    expect(shown()).toBe('copy');
    key('keyup', 'Control', { ctrlKey: false });
    expect(shown()).toBe('move');
  });

  it('drops with the effect showing at the release', () => {
    press();
    moveTo(...ON_FOLDER, { ctrlKey: true });
    release(...ON_FOLDER, { ctrlKey: true });
    expect(rig.controller.setCopy).toHaveBeenCalledWith(true);
    expect(rig.actions.drop).toHaveBeenCalledOnce();
    expect(rig.actions.endDrag).toHaveBeenCalledOnce();
    expect(rig.controller.end).toHaveBeenCalledOnce();
    expect(shown()).toBeUndefined();
  });

  it('moves on a drop with no key', () => {
    press();
    moveTo(...ON_FOLDER);
    release(...ON_FOLDER);
    expect(rig.controller.setCopy).toHaveBeenCalledWith(false);
  });
});

describe('hit-testing', () => {
  it('hands react-dnd the targets under the pointer, outermost first', () => {
    press();
    moveTo(...ON_FOLDER);
    expect(rig.actions.hover).toHaveBeenLastCalledWith(['list', 'folder'], { clientOffset: { x: 20, y: 160 } });
  });

  it('does not offer a row rendered past the visible end of the list', () => {
    press();
    moveTo(20, 430);
    expect(rig.actions.hover).toHaveBeenLastCalledWith([], expect.anything());
  });

  it('says not-allowed where the tree refuses the drop', () => {
    rig.monitor.canDropOnTarget.mockReturnValue(false);
    press();
    moveTo(...ON_FOLDER);
    expect(shown()).toBe('none');
    release(...ON_FOLDER);
    expect(rig.actions.drop).not.toHaveBeenCalled();
    expect(rig.actions.endDrag).toHaveBeenCalled();
  });
});

describe('cancelling (FR-113)', () => {
  it('Esc ends the drag with nothing dropped, and is not passed on', () => {
    press();
    moveTo(...ON_FOLDER);
    const esc = key('keydown', 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(rig.actions.drop).not.toHaveBeenCalled();
    expect(rig.actions.endDrag).toHaveBeenCalledOnce();
    expect(rig.controller.end).toHaveBeenCalledOnce();
    expect(shown()).toBeUndefined();
    moveTo(...ON_FOLDER);
    release(...ON_FOLDER);
    expect(rig.actions.drop).not.toHaveBeenCalled();
    expect(rig.actions.beginDrag).toHaveBeenCalledOnce();
  });

  it('a lost window cancels too', () => {
    press();
    moveTo(...ON_FOLDER);
    window.dispatchEvent(new Event('blur'));
    expect(rig.actions.drop).not.toHaveBeenCalled();
    expect(rig.actions.endDrag).toHaveBeenCalledOnce();
  });
});

describe('the click that ends a drag', () => {
  const clicks = (): number => {
    const spy = vi.fn();
    rig.source.addEventListener('click', spy);
    mouse('click', rig.source, 10, 210);
    return spy.mock.calls.length;
  };

  it('is swallowed after a drop', () => {
    press();
    moveTo(...ON_FOLDER);
    release(...ON_FOLDER);
    expect(clicks()).toBe(0);
  });

  it('is swallowed after Esc, when the button is released later', () => {
    press();
    moveTo(...ON_FOLDER);
    key('keydown', 'Escape');
    release(...ON_FOLDER);
    expect(clicks()).toBe(0);
  });

  it('is not swallowed after a plain click', async () => {
    press();
    release(10, 210);
    expect(clicks()).toBe(1);
  });

  it('stops text selection while it runs', () => {
    press();
    moveTo(...ON_FOLDER);
    const ev = new Event('selectstart', { bubbles: true, cancelable: true });
    rig.source.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('over a target outside the tree (D22)', () => {
  const seen = (): string[] => {
    const types: string[] = [];
    for (const t of ['dragenter', 'dragover', 'dragleave', 'drop'])
      rig.outside.addEventListener(t, (e) => {
        types.push(t);
        if (t === 'dragover' && claim) setTreeDropEffect(claim);
        expect((e as unknown as { dataTransfer: { types: string[] } }).dataTransfer.types).not.toContain('Files');
      });
    return types;
  };
  let claim: 'copy' | 'none' | null = null;
  beforeEach(() => {
    claim = null;
  });

  it('enters, then hovers, the element under the pointer, and shows what it chose', () => {
    claim = 'copy';
    const types = seen();
    press();
    moveTo(350, 100);
    expect(types).toEqual(['dragenter', 'dragover']);
    expect(shown()).toBe('copy');
    moveTo(351, 100);
    expect(types).toEqual(['dragenter', 'dragover', 'dragover']);
  });

  it('shows not-allowed where nothing claims the drag', () => {
    seen();
    press();
    moveTo(350, 100);
    expect(shown()).toBe('none');
  });

  it('delivers the drop where it was accepted', () => {
    claim = 'copy';
    const types = seen();
    press();
    moveTo(350, 100);
    release(350, 100);
    expect(types).toContain('drop');
    expect(rig.actions.drop).not.toHaveBeenCalled();
    expect(rig.actions.endDrag).toHaveBeenCalledOnce();
  });

  it('delivers no drop where it was refused', () => {
    claim = 'none';
    const types = seen();
    press();
    moveTo(350, 100);
    release(350, 100);
    expect(types).not.toContain('drop');
  });

  it('leaves the element when the pointer returns to the tree', () => {
    claim = 'copy';
    const types = seen();
    press();
    moveTo(350, 100);
    moveTo(...ON_FOLDER);
    expect(types).toEqual(['dragenter', 'dragover', 'dragleave']);
    expect(shown()).toBe('move');
  });
});

describe('edge scroll (FR-113)', () => {
  beforeEach(() => vi.useFakeTimers());

  it('scrolls the tree up near its top edge, while the pointer rests', () => {
    rig.list.scrollTop = 100;
    press();
    moveTo(20, 110);
    vi.advanceTimersByTime(100);
    expect(rig.list.scrollTop).toBeLessThan(100);
  });

  it('scrolls the tree down near its bottom edge, faster the closer the pointer is', () => {
    press();
    moveTo(20, 380);
    vi.advanceTimersByTime(100);
    const slow = rig.list.scrollTop;
    expect(slow).toBeGreaterThan(0);
    rig.list.scrollTop = 0;
    moveTo(20, 398);
    vi.advanceTimersByTime(100);
    expect(rig.list.scrollTop).toBeGreaterThan(slow);
  });

  it('does not scroll from the middle, and stops on the release', () => {
    press();
    moveTo(20, 250);
    vi.advanceTimersByTime(100);
    expect(rig.list.scrollTop).toBe(0);
    moveTo(20, 390);
    release(20, 390);
    const at = rig.list.scrollTop;
    vi.advanceTimersByTime(100);
    expect(rig.list.scrollTop).toBe(at);
  });
});

describe('leaving the window (FR-114)', () => {
  it('hands the dragged paths to the OS, and drops nothing in the tree', () => {
    press();
    moveTo(...ON_FOLDER);
    moveTo(-5, 160);
    expect(rig.controller.handOver).toHaveBeenCalledWith(['a.txt']);
    expect(rig.actions.drop).not.toHaveBeenCalled();
    expect(rig.actions.endDrag).toHaveBeenCalledOnce();
    expect(shown()).toBeUndefined();
  });

  it('does not hand over when the document reports a leave away from the window edge', () => {
    press();
    moveTo(...BODY_ONLY);
    document.body.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, buttons: 1, clientX: 500, clientY: 300, relatedTarget: null }));
    expect(rig.controller.handOver).not.toHaveBeenCalled();
  });

  it('does not hand over a drag whose button was released outside the window', () => {
    press();
    moveTo(...ON_FOLDER);
    release(-5, 160);
    expect(rig.controller.handOver).not.toHaveBeenCalled();
    expect(rig.actions.drop).not.toHaveBeenCalled();
    expect(rig.actions.endDrag).toHaveBeenCalledOnce();
  });

  it('hands over once', () => {
    press();
    moveTo(...ON_FOLDER);
    moveTo(-5, 160);
    moveTo(-9, 160);
    expect(rig.controller.handOver).toHaveBeenCalledOnce();
  });

  it('hands over when the pointer leaves the document with the button held', () => {
    press();
    moveTo(...BODY_ONLY);
    document.body.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, buttons: 1, relatedTarget: null }));
    expect(rig.controller.handOver).toHaveBeenCalledOnce();
  });
});
