/**
 * 057 FR-097, FR-098 — the popover a project row's mark and a category header's mark open on hover or
 * keyboard focus, in place of a native tooltip. FR-119 lays each entry out as its icon and "Tab - Title",
 * then the notification's one line (FR-117) beneath, with a rule between entries and between projects.
 *
 * A native tooltip is one flat run of text, so "which panels in this project need me, and why?" came
 * back as a wall of `title — project: reason (kind)` sentences. This is the tab hover popover's answer
 * (`workspace/tab-popover.tsx`, 031 FR-051) applied to marks: one line per marked panel, each with its
 * kind's icon, the panel's name and the reason; on a category header the lines sit beneath the name of
 * the project they belong to (FR-098).
 *
 * ══ IT IS A FLOATING SURFACE, SO IT FLIPS AND CLAMPS ══
 *
 * Registered in `floating-surfaces.test.ts` (018 / FR-013), and built the way the tab popover is: portaled
 * to `document.body` (the project list scrolls and clips), placed by the shared {@link clampToViewport},
 * measured in a layout effect and held invisible until it has been placed, and `pointer-events: none` so
 * it can never swallow a click meant for the row under it nor strand a hover of its own.
 *
 * ══ ORDER ══
 *
 * "Layout order where known": a project whose layout is loaded and open in this window lists its panels
 * in the order the layout holds them (tab by tab, depth first). A project that is not loaded has no layout
 * to read, so its panels are listed in the order they were raised — the only order main knows.
 *
 * It subscribes to the whole mark set rather than a value-compared key (`use-attention.ts`) because it
 * mounts only while one holder is hovered or focused: one instance at a time, so there is no strip of
 * 200 subscribers for the key to protect.
 */
import { useMemo, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { notificationText, type AttentionMark } from '@throng/core';
import { groupMarksByProject } from './mark-order.js';
import { useAnchoredPosition } from '../common/use-anchored-position.js';
import { useWorkspaceOptional } from '../state/workspace-store.js';
import { useAttentionMarks } from './use-attention.js';

export interface AttentionPopoverProps {
  /** The mark to anchor against. `null` renders nothing. */
  anchor: HTMLElement | null;
  /**
   * The projects whose marked panels are listed — in list order, which is the order of the groups. May be
   * left out when `panelIds` names the panels, in which case the projects are those the marks name.
   */
  projectIds?: readonly string[];
  /**
   * Only these panels' marks (FR-104: the tab strip's overflow control lists the panels on its hidden
   * tabs), in addition to any `projectIds` restriction.
   */
  panelIds?: readonly string[];
  /** One group per marked project, headed by its name (a category header), or one flat list (a project row). */
  grouped: boolean;
}

/** FR-119 — "Tab - Title"; the title alone when the mark does not know its tab. */
function lineName(mark: AttentionMark): string {
  return mark.tabTitle === '' ? mark.panelTitle : `${mark.tabTitle} - ${mark.panelTitle}`;
}

function AttentionLine({ mark }: { mark: AttentionMark }): ReactElement {
  return (
    <li
      className="attention-popover__line"
      data-testid={`attention-popover-line-${mark.panelId}`}
      data-panel-id={mark.panelId}
      data-kind={mark.kind}
    >
      {/* FR-119: the icon and name on one row, the description on its own row, indented beneath. */}
      <span className="attention-popover__head" data-testid="attention-popover-head">
        {/* FR-135 (round 13): the mark's own circle, the same for both kinds; the reason below names a failure. */}
        <span className="attention-popover__icon" aria-hidden="true" />
        <span className="attention-popover__name" data-testid="attention-popover-name">
          {lineName(mark)}
        </span>
      </span>
      <span className="attention-popover__reason" data-testid="attention-popover-reason">
        {notificationText(mark)}
      </span>
    </li>
  );
}

export function AttentionPopover({ anchor, projectIds, panelIds, grouped }: AttentionPopoverProps): ReactElement | null {
  const everything = useAttentionMarks();
  const workspace = useWorkspaceOptional();
  const layout = workspace?.layout ?? null;

  const all = useMemo(() => {
    if (panelIds === undefined) return everything;
    const wanted = new Set(panelIds);
    return everything.filter((m) => wanted.has(m.panelId));
  }, [everything, panelIds]);

  // Layout order where this window holds the project's layout, else raise order (mark-order.ts).
  const groups = useMemo(
    () => groupMarksByProject(all, projectIds ?? [...new Set(all.map((m) => m.projectId))], layout),
    [all, projectIds, layout],
  );

  /** The content as one value the placement depends on: a line added while open changes the size. */
  const contents = groups.map((g) => `${g.projectId}\n${g.marks.map((m) => `${m.panelId}${lineName(m)}${notificationText(m)}`).join('\n')}`).join('\n\n');
  const { ref, pos } = useAnchoredPosition<HTMLDivElement>(anchor, contents);

  if (!anchor || groups.length === 0) return null;

  return createPortal(
    <div
      ref={ref}
      className="attention-popover"
      data-testid="attention-popover"
      role="tooltip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      {grouped ? (
        groups.map((g) => (
          <div
            key={g.projectId}
            className="attention-popover__group"
            data-testid={`attention-popover-group-${g.projectId}`}
            data-project-id={g.projectId}
          >
            <div className="attention-popover__project" data-testid="attention-popover-project-name">
              {g.projectName}
            </div>
            <ul className="attention-popover__lines">
              {g.marks.map((m) => (
                <AttentionLine key={m.panelId} mark={m} />
              ))}
            </ul>
          </div>
        ))
      ) : (
        <ul className="attention-popover__lines attention-popover__lines--flat">
          {groups.flatMap((g) => g.marks).map((m) => (
            <AttentionLine key={m.panelId} mark={m} />
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}
