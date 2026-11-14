import { type ReactElement, type ReactNode } from 'react';

/**
 * A collapsed side pane's strip (068 FR-069): the rotated label, and whatever else the strip carries. A click anywhere
 * on it shows the pane, as the pane's show control does — that control stays the keyboard route and the only tab stop,
 * and it sits above the strip rather than in it, so one click is never two. Its hover (FR-070, FR-082) is the PANE's, so the strip and the
 * show control are one target: `app.tsx` puts `useCollapsedHover` on the pane element.
 */
export function CollapsedRail({
  testId,
  label,
  onShow,
  children,
}: {
  testId: string;
  label: string;
  onShow: () => void;
  children?: ReactNode;
}): ReactElement {
  return (
    <div className="pane-rail" data-testid={testId} onClick={onShow}>
      <span className="pane-rail__label">{label}</span>
      {children}
    </div>
  );
}
