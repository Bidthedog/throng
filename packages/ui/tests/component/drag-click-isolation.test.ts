import { DndContext, PointerSensor, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

/**
 * A drag in one test must not swallow a click in the next.
 *
 * Layer: component — the leak is between tests sharing one jsdom document, which is this layer's own
 * harness (`setup.ts`); nothing above it shares a document between tests.
 *
 * dnd-kit stops every click at the document for 50 ms after a drag ends. `projects-panel-category-reorder`'s
 * chevron click landed inside that window on Linux CI, where the tests before it ran in 33 ms, and failed
 * with the click never reaching React. The second test here clicks straight after the first one's drop,
 * so it fails every time the suppressor is allowed to outlive the test that started it.
 *
 * The two tests are ORDER-DEPENDENT on purpose: the second is the observation, the first the cause.
 */

function Draggable(): ReactElement {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: 'only' });
  return createElement('div', { ref: setNodeRef, 'data-testid': 'draggable', ...listeners, ...attributes }, 'drag me');
}

function Harness(): ReactElement {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  return createElement(DndContext, { sensors }, createElement(Draggable));
}

describe('a drag does not leak its click suppressor into the next test', () => {
  it('cause: a real pointer drag activates and ends', () => {
    render(createElement(Harness));
    const el = screen.getByTestId('draggable');
    fireEvent.pointerDown(el, { isPrimary: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 40 }); // past the 4px activation
    fireEvent.pointerUp(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 40 });

    // Inside the test that dragged, the suppressor is dnd-kit's intended behaviour: the click that ends a
    // drag must not activate what it was dropped on. This confirms the first test really armed it.
    const target = document.createElement('button');
    let clicked = false;
    target.addEventListener('click', () => {
      clicked = true;
    });
    document.body.appendChild(target);
    target.click();
    target.remove();
    expect(clicked, 'the drag must have armed dnd-kit’s click suppressor, or the next test proves nothing').toBe(false);
  });

  it('observation: the next test’s first click reaches its target', () => {
    const target = document.createElement('button');
    let clicked = false;
    target.addEventListener('click', () => {
      clicked = true;
    });
    document.body.appendChild(target);
    target.click();
    target.remove();
    expect(clicked, 'a click straight after another test’s drop was stopped at the document').toBe(true);
  });
});
