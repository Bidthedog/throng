import { type ReactElement } from 'react';

/**
 * A crisp chevron icon used by the pane collapse/expand controls. The direction
 * encodes the action: a control points the way the pane will move (FR-007).
 */
export function Chevron({ dir, size = 14 }: { dir: 'left' | 'right'; size?: number }): ReactElement {
  const d = dir === 'left' ? 'M15 5 L8 12 L15 19' : 'M9 5 L16 12 L9 19';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
