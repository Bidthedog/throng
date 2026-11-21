import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { formatGrouped } from '@throng/core';
import { useAnchoredPosition } from '../common/use-anchored-position.js';

/**
 * #695, 077 FR-027 — the Projects pane's one popover per row: the project's full name, its ID, its full
 * path, its tab and panel counts and how to rename it, once the pointer has rested on the row for
 * `projects.popoverDelayMs`. It replaces the row's separate native tooltips.
 *
 * The same pattern as the File Explorer's (069 FR-059, `tree-node.tsx`): it arms from the pointer MOVING
 * and never while `body[data-window-blurred]` is set (021 FR-035), and any press, wheel or menu on the
 * row puts it away until the pointer leaves. The move handle, the action buttons and the attention mark
 * keep their own tooltips and popover, so resting on them does not open this one.
 */
const OWN_TOOLTIP = '.project-item__grip, .project-item__controls, .throng-attention-mark';

export interface ShownProjectPopover {
  projectId: string;
  anchor: HTMLElement;
}

export interface ProjectRowPopoverHandlers {
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onWheel: () => void;
  onContextMenu: () => void;
}

export function useProjectRowPopover(
  delayMs: number,
  enabled: boolean,
): { shown: ShownProjectPopover | null; handlersFor: (projectId: string) => ProjectRowPopoverHandlers } {
  const [shown, setShown] = useState<ShownProjectPopover | null>(null);
  const timer = useRef<{ projectId: string; handle: ReturnType<typeof setTimeout> } | null>(null);
  // The row a press, wheel or menu put the popover away on, until the pointer leaves it.
  const suppressed = useRef<string | null>(null);

  const cancel = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current.handle);
    timer.current = null;
  }, []);
  const hide = useCallback((): void => {
    cancel();
    setShown(null);
  }, [cancel]);

  useEffect(() => {
    if (!enabled) hide();
  }, [enabled, hide]);
  useEffect(() => {
    const onBlur = (): void => hide();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [hide]);
  useEffect(() => cancel, [cancel]);

  const handlersFor = (projectId: string): ProjectRowPopoverHandlers => ({
    onPointerMove: (e) => {
      if (!enabled) return;
      if ((e.target as Element | null)?.closest?.(OWN_TOOLTIP)) {
        hide();
        return;
      }
      if (suppressed.current === projectId) return;
      if (document.body.hasAttribute('data-window-blurred')) return;
      if (shown?.projectId === projectId || timer.current?.projectId === projectId) return;
      cancel();
      const anchor = e.currentTarget;
      if (delayMs <= 0) {
        setShown({ projectId, anchor });
        return;
      }
      timer.current = {
        projectId,
        handle: setTimeout(() => {
          timer.current = null;
          if (!document.body.hasAttribute('data-window-blurred')) setShown({ projectId, anchor });
        }, delayMs),
      };
    },
    onPointerLeave: () => {
      if (suppressed.current === projectId) suppressed.current = null;
      if (timer.current?.projectId === projectId) cancel();
      setShown((s) => (s?.projectId === projectId ? null : s));
    },
    onPointerDown: () => {
      suppressed.current = projectId;
      hide();
    },
    onWheel: () => {
      suppressed.current = projectId;
      hide();
    },
    onContextMenu: () => {
      suppressed.current = projectId;
      hide();
    },
  });

  return { shown, handlersFor };
}

export interface ProjectRowPopoverProps {
  projectId: string;
  name: string;
  path: string;
  tabs: number;
  panels: number;
  /** The row to anchor against. `null` renders nothing. */
  anchor: HTMLElement | null;
}

export function ProjectRowPopover({ projectId, name, path, tabs, panels, anchor }: ProjectRowPopoverProps): ReactElement | null {
  const counts = `${formatGrouped(tabs)} tab${tabs === 1 ? '' : 's'}, ${formatGrouped(panels)} panel${panels === 1 ? '' : 's'}`;
  const { ref, pos } = useAnchoredPosition<HTMLDivElement>(anchor, `${name}\n${projectId}\n${path}\n${counts}`);
  if (!anchor) return null;
  return createPortal(
    <div
      ref={ref}
      className="throng-popup project-popover"
      data-testid="project-popover"
      data-project-id={projectId}
      role="tooltip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div className="project-popover__name" data-testid="project-popover-name">
        {name}
      </div>
      <div className="project-popover__detail" data-testid="project-popover-id">
        ID: {projectId}
      </div>
      <div className="project-popover__path" data-testid="project-popover-path">
        {path}
      </div>
      <div className="project-popover__detail" data-testid="project-popover-counts">
        {counts}
      </div>
      <div className="project-popover__hint">Double-click to rename</div>
    </div>,
    document.body,
  );
}
