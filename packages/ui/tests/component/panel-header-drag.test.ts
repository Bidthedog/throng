/**
 * #406 — a press that begins on a panel title's CONTROL never starts a panel drag.
 *
 * The header is dnd-kit's drag handle, under the PointerSensor and 4 px activation `tab-group.tsx`
 * gives it. A press on **+** or **X** that moved slightly before release started a panel drag instead
 * of (or as well as) the control's own action. Back and Forward already stop it
 * (`back-forward-buttons.test.ts`); this covers the rest of the title's controls.
 *
 * Only INTERACTIVE elements are excluded. The type icon is a label, not a control, so it stays part
 * of the handle (the maintainer's ruling on #406) and is asserted as a drag source beside the title.
 *
 * The control first: a press on the TITLE text or the type icon and a 20 px move does start a drag,
 * so the absence below is not an absence of any drag at all.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { afterEach, expect, it, vi } from 'vitest';
import { createPreviewProviderRegistry } from '@throng/core';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const FILE = 'D:/proj/notes.prvtxt';
const registry = createPreviewProviderRegistry([
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
]);
function FakeBody({ panelId, content }: PreviewBodyProps): ReactElement {
  return createElement('div', { 'data-testid': `fake-body-${panelId}` }, content.kind === 'text' ? content.text : '');
}
const views: Record<string, PreviewProviderView> = {
  testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(FakeBody) },
};

let pv: MountedPreviewWindow | undefined;

afterEach(() => {
  pv?.unmount();
  pv = undefined;
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

it('a press on the title’s controls never starts the panel drag; the title and type icon do (#406)', async () => {
  const onDragStart = vi.fn();
  function DragHost({ children }: { children: ReactNode }): ReactElement {
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
    return createElement(DndContext, { sensors, onDragStart }, children);
  }
  pv = await mountMarkdownPreview('hello', FILE, {
    providers: { registry, views },
    providerId: 'testText',
    wrap: (children) => createElement(DragHost, null, children),
  });
  const id = pv.id;
  await screen.findByTestId(`fake-body-${id}`);

  const drag = (from: HTMLElement): void => {
    fireEvent.pointerDown(from, { isPrimary: true, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 30, clientY: 10 });
    fireEvent.pointerUp(document, { isPrimary: true, clientX: 30, clientY: 10 });
  };

  drag(screen.getByTestId(`panel-title-${id}`));
  await waitFor(() => expect(onDragStart).toHaveBeenCalledTimes(1));
  drag(screen.getByTestId(`panel-kind-${id}`));
  await waitFor(() => expect(onDragStart).toHaveBeenCalledTimes(2));

  const started: string[] = [];
  for (const testId of [`panel-add-${id}`, `panel-close-${id}`]) {
    const before = onDragStart.mock.calls.length;
    drag(screen.getByTestId(testId));
    await new Promise((r) => setTimeout(r, 20));
    if (onDragStart.mock.calls.length > before) started.push(testId);
  }

  expect(started, 'a press on these started a panel drag').toEqual([]);
});
