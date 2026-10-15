/**
 * The Resource Monitor's body (055 US2): everything the window draws once the first frame is in, in two
 * columns (FR-096, FR-097). Loaded lazily by the shell, so it stays out of startup (research R10).
 *
 * ══ TWO COLUMNS ══
 *
 * The LEFT column holds the lists — the filter and the list controls, the breadcrumb and Back, the column
 * names and the rows (Components and Projects at the top, the drilled level's children below). The RIGHT
 * column holds everything about the selected item, or the level shown when nothing is selected
 * (`detail-pane.tsx`): no selection detail appears anywhere else. Each scrolls on its own.
 *
 * ══ THE TAB ORDER IS THE SPEC'S, NOT THE EYE'S (FR-068) ══
 *
 * Tab moves filter → breakdown → detail → controls (→ the window's own controls, which the shell puts
 * last). The DOM is in that order; the stylesheet's grid areas put the filter and the controls at the top of
 * the left column and the detail down the whole right. Each region is one or a few Tab stops — the
 * breakdown is a single roving stop — and carries `data-region` so a test can say which region Tab is in
 * without naming its controls.
 *
 * The one notice a failed action raises sits between the filter and the breakdown, inline, where its
 * Dismiss control is in the Tab order beside what it is about (030).
 */
import type { ReactElement } from 'react';
import { Breakdown } from './breakdown.js';
import { DetailPane } from './detail-pane.js';
import { HeldFolders } from './held-folders.js';
import { MonitorNotice } from './monitor-notice.js';
import { NodeActionsProvider } from './node-actions.js';
import { FilterField, ToolbarControls } from './toolbar.js';

export default function MonitorBody(): ReactElement {
  return (
    <NodeActionsProvider>
      <div className="monitor-body" data-testid="monitor-body">
        <div className="monitor-body__filter" data-region="filter">
          <FilterField />
        </div>
        <div className="monitor-body__notice">
          <MonitorNotice />
        </div>
        <div className="monitor-body__breakdown" data-region="breakdown" data-column="left">
          <Breakdown />
          <HeldFolders />
        </div>
        <div className="monitor-body__detail" data-region="detail" data-column="right">
          <DetailPane />
        </div>
        <div className="monitor-body__controls" data-region="controls">
          <ToolbarControls />
        </div>
      </div>
    </NodeActionsProvider>
  );
}
