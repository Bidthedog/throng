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
import type { CSSProperties, ReactElement } from 'react';
import { Breakdown } from './breakdown.js';
import { ColumnDivider } from './column-divider.js';
import { DetailPane } from './detail-pane.js';
import { HeldFolders } from './held-folders.js';
import { MonitorLocation } from './monitor-location.js';
import { MonitorNotice } from './monitor-notice.js';
import { useSplitRatio } from './monitor-session.js';
import { NodeActionsProvider } from './node-actions.js';
import { FilterField, ToolbarControls } from './toolbar.js';

export default function MonitorBody(): ReactElement {
  const splitRatio = useSplitRatio();
  const left = Math.round(splitRatio * 100);
  return (
    <NodeActionsProvider>
      <div className="monitor-body" data-testid="monitor-body">
        <div className="monitor-body__header" data-testid="monitor-body-header">
          <div className="monitor-body__filter" data-region="filter">
            <FilterField />
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
