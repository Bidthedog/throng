/**
 * The Resource Monitor's body (055 US2): everything the window draws once the first frame is in. Loaded
 * lazily by the shell, so it stays out of startup (research R10).
 *
 * ══ A HEADER OVER TWO COLUMNS (FR-112, FR-096, FR-097) ══
 *
 * The HEADER spans the window: the filter, the toolbar, and Back with the breadcrumb, ruled off from what is
 * below and never scrolling with it. The one notice a failed action raises sits at its foot, inline, where
 * its Dismiss control is in the Tab order beside what it is about (030).
 *
 * Below it, the LEFT column holds the list — what the rows are ordered by, the column names, the rows — and
 * the RIGHT column everything about the selected item, or the level shown when nothing is selected
 * (`detail-pane.tsx`). Each scrolls on its own. Between them is the divider (FR-111).
 *
 * ══ THE TAB ORDER (FR-112) ══
 *
 * filter → toolbar → breadcrumb → left list → divider → right column (→ the window's own controls, which
 * the shell puts last). The DOM is in that order. Each region carries `data-region` so a test can say which
 * region Tab is in without naming its controls.
 */
import { useLayoutEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import { Breakdown } from './breakdown.js';
import { ColumnDivider } from './column-divider.js';
import { DetailPane } from './detail-pane.js';
import { HeldFolders } from './held-folders.js';
import { MonitorLocation } from './monitor-location.js';
import { MonitorNotice } from './monitor-notice.js';
import { isSplitChosen, setOpeningSplit, useSplitRatio } from './monitor-session.js';
import { NodeActionsProvider } from './node-actions.js';
import { Liveness } from './liveness.js';
import { FilterField, HelpControl, ToolbarControls } from './toolbar.js';
import { openingSplitRatio } from './use-column-fit.js';

export default function MonitorBody(): ReactElement {
  const splitRatio = useSplitRatio();
  const left = Math.round(splitRatio * 100);
  const columns = useRef<HTMLDivElement | null>(null);

  // FR-116: with no restored position, open where the left column shows every figure column. Measured once,
  // before the first paint, so the columns never visibly move; a drag or a restore is never overridden.
  useLayoutEffect(() => {
    if (isSplitChosen()) return;
    const width = columns.current?.clientWidth ?? 0;
    if (width > 0) setOpeningSplit(openingSplitRatio(width));
  }, []);

  return (
    <NodeActionsProvider>
      <div className="monitor-body" data-testid="monitor-body">
        <div className="monitor-body__header" data-testid="monitor-body-header">
          {/* The first row (FR-121): <filter> | Updated … (n s ago) | ? — the general help ends it, right-aligned. */}
          <div className="monitor-body__top" data-testid="monitor-body-top">
            <div className="monitor-body__filter" data-region="filter">
              <FilterField />
            </div>
            <div className="monitor-body__updated">
              <Liveness />
            </div>
            <div className="monitor-body__help" data-region="help">
              <HelpControl />
            </div>
          </div>
          <div className="monitor-body__controls" data-region="controls">
            <ToolbarControls />
          </div>
          <div className="monitor-body__location" data-region="breadcrumb">
            <MonitorLocation />
          </div>
          <div className="monitor-body__notice">
            <MonitorNotice />
          </div>
        </div>
        <div
          ref={columns}
          className="monitor-body__columns"
          data-testid="monitor-body-columns"
          style={{ '--monitor-split-left': `${left}fr`, '--monitor-split-right': `${100 - left}fr` } as CSSProperties}
        >
          <div className="monitor-body__breakdown" data-region="breakdown" data-column="left">
            <Breakdown />
            <HeldFolders />
          </div>
          <div className="monitor-body__divider" data-region="divider">
            <ColumnDivider />
          </div>
          <div className="monitor-body__detail" data-region="detail" data-column="right">
            <DetailPane />
          </div>
        </div>
      </div>
    </NodeActionsProvider>
  );
}
