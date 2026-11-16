import { type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';

import { RotatedIcon } from '../common/rotated-icon.js';

/** The edge a pane or panel collapses toward: the side panes to theirs, the bottom-of-pane panels down. */
export type CollapseEdge = 'left' | 'right' | 'bottom';

/**
 * How far to turn the art for each edge (069 FR-040). `minimisePanel` points DOWN to a line and
 * `restorePanel` points UP from one, so at 0° both suit a panel at the bottom of its pane. Turned 90°
 * clockwise both sit on a line at the left edge; turned -90° on a line at the right.
 */
const EDGE_ROTATION: Record<CollapseEdge, number> = { bottom: 0, left: 90, right: -90 };

/**
 * The icon of every collapse / restore control (069 FR-040, superseding 068 FR-058's chevron): the
 * minimise art while open, the restore art while collapsed, turned to face the control's edge. The
 * action is named by the control's hover title and accessible name; the icon is decorative.
 */
export function CollapseIcon({
  edge,
  collapsed,
  size = 14,
}: {
  edge: CollapseEdge;
  collapsed: boolean;
  size?: number;
}): ReactElement {
  return (
    <RotatedIcon token={collapsed ? 'restorePanel' : 'minimisePanel'} degrees={EDGE_ROTATION[edge]} size={size} />
  );
}

/**
 * The minimise / restore control of a bottom-of-pane panel (068 FR-058, 069 FR-040), its icon centred
 * in the button.
 */
export function MinimisePanelButton({
  minimised,
  title,
  testId,
  onClick,
}: {
  minimised: boolean;
  title: string;
  testId: string;
  onClick: (event: ReactMouseEvent) => void;
}): ReactElement {
  return (
    <button
      type="button"
      className="panel__action panel__action--icon panel__action--neutral panel__action--collapse"
      data-testid={testId}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <CollapseIcon edge="bottom" collapsed={minimised} />
    </button>
  );
}
