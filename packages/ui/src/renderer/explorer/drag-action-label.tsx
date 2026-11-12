import { useImperativeHandle, useRef, type ReactElement, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { clampToViewport } from '../common/clamp-to-viewport.js';

/** Clear of the pointer's own artwork. */
const OFFSET_PX = 14;

export interface DragActionLabelHandle {
  show(effect: 'copy' | 'move', x: number, y: number): void;
  hide(): void;
}

/**
 * Names what a drop will do, beside the pointer: Linux desktops do not change the pointer itself for a copy or a move.
 * Written to directly, because it follows every `dragover` and a render for each would be waste.
 */
export function DragActionLabel({ ref }: { ref: Ref<DragActionLabelHandle> }): ReactElement {
  const element = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      show(effect, x, y) {
        const el = element.current;
        if (!el) return;
        el.textContent = effect === 'copy' ? 'Copy' : 'Move';
        el.dataset.effect = effect;
        el.hidden = false;
        const { width, height } = el.getBoundingClientRect();
        const anchor = { left: x + OFFSET_PX, right: x + OFFSET_PX, top: y + OFFSET_PX, bottom: y + OFFSET_PX };
        const { left, top } = clampToViewport(anchor, { width, height }, { width: window.innerWidth, height: window.innerHeight });
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
      },
      hide() {
        if (element.current) element.current.hidden = true;
      },
    }),
    [],
  );
  return createPortal(<div ref={element} className="tree-drag-label" data-testid="tree-drag-label" aria-hidden="true" hidden />, document.body);
}
