/**
 * The monitor's toolbar (055 FR-004a, FR-055, FR-061), in two parts because the Tab order puts the filter
 * FIRST and the controls LAST (FR-068): `FilterField` and `ToolbarControls`.
 *
 * Every action is a themeable icon control with a hover title (FR-055): the metric choice, hide idle and
 * clear-filter are `IconButton`s; the capture interval is a select, which is a choice and not an action,
 * and carries a title all the same. There is no narrowing (FR-100): the filter, the drill-down and the
 * ordering are the ways to find something.
 */
import { useCallback, useRef, useState, type ReactElement } from 'react';
import { allowedIntervals } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { writeConfigPatch } from '../config/write-config.js';
import { FIGURE_ICON, FIGURE_LABEL, FIGURE_ORDER, type FigureId } from './figures.js';
import { HelpButton, HelpPanel } from './help-panel.js';
import { InfoHelper } from './info-helper.js';
import { setView, useNetworkUnavailable, useListView } from './monitor-session.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';

export function FilterField(): ReactElement {
  const view = useListView();
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <div className="monitor-filter" role="search">
      <input
        ref={input}
        type="text"
        className="monitor-filter__input"
        data-testid="monitor-filter"
        value={view.filterText}
        placeholder="Filter by name, command line or process id"
        aria-label="Filter by name, command line or process id"
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setView({ filterText: e.target.value })}
      />
      {view.filterText !== '' ? (
        <IconButton
          token="dismiss"
          title="Clear filter"
          testId="monitor-filter-clear"
          className="icon-button monitor-filter__clear"
          onClick={() => {
            setView({ filterText: '' });
            input.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The general "?" and the panel it opens (FR-093, FR-119). It ends the window's FIRST row (FR-121), right-aligned,
 * rather than the toolbar's. Closing the panel from the keyboard, or by pressing the button again, hands focus back.
 */
export function HelpControl(): ReactElement {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpButton = useRef<HTMLButtonElement | null>(null);
  const setHelpButton = useCallback((el: HTMLButtonElement | null): void => {
    helpButton.current = el;
  }, []);
  const closeHelp = useCallback((returnFocus: boolean): void => {
    setHelpOpen(false);
    if (returnFocus) helpButton.current?.focus();
  }, []);
  return (
    <>
      <HelpButton open={helpOpen} onToggle={() => (helpOpen ? closeHelp(true) : setHelpOpen(true))} nodeRef={setHelpButton} />
      {helpOpen ? <HelpPanel anchor={helpButton} onClose={closeHelp} /> : null}
    </>
  );
}

export function ToolbarControls(): ReactElement {
  const view = useListView();
  const settings = useResourceMonitorSettings();
  const networkUnavailable = useNetworkUnavailable();

  const intervals = allowedIntervals(settings.historyMinutes);
  // A stored value between the offered ones is still the value in force: show it rather than a lie.
  const offered = intervals.includes(settings.intervalSeconds)
    ? intervals
    : [...intervals, settings.intervalSeconds].sort((a, b) => a - b);

  return (
    <div className="monitor-controls" role="toolbar" aria-label="Monitor controls" data-testid="monitor-controls">
      {/* Each "?" hugs its subject (sixth feedback): the pair is one flex item, so the toolbar's gap is not between them. */}
      <span className="monitor-controls__subject">
        <span id="monitor-size-by" className="monitor-controls__label" data-testid="monitor-size-by-label">
          Order by
        </span>
        <InfoHelper topic="orderBy" />
      </span>
      {/* FR-099: the toolbar's Order by stays beside the column headers that set it too; Network is disabled
          with its header's reason while it is not measured (FR-113). */}
      <div className="monitor-controls__group" role="group" aria-labelledby="monitor-size-by">
        {FIGURE_ORDER.map((id: FigureId) => {
          const why = id === 'network' ? networkUnavailable : null;
          return (
            <IconButton
              key={id}
              token={FIGURE_ICON[id]}
              title={why ?? `Order by ${FIGURE_LABEL[id]}`}
              testId={`monitor-metric-${id}`}
              className="icon-button monitor-controls__button"
              ariaPressed={view.metric === id}
              disabled={why !== null}
              onClick={() => setView({ metric: id })}
            />
          );
        })}
      </div>

      <span className="monitor-controls__subject">
        <IconButton
          token="resourceHideIdle"
          title="Hide idle processes"
          testId="monitor-hide-idle"
          className="icon-button monitor-controls__button"
          ariaPressed={view.hideIdle}
          onClick={() => setView({ hideIdle: !view.hideIdle })}
        />
        <InfoHelper topic="hideIdle" />
      </span>

      {/* FR-105: on by default; on, a process that ends leaves the list at the next capture. */}
      <span className="monitor-controls__subject">
        <IconButton
          token="resourceHideEnded"
          title="Hide ended processes"
          testId="monitor-hide-ended"
          className="icon-button monitor-controls__button"
          ariaPressed={view.hideEnded}
          onClick={() => setView({ hideEnded: !view.hideEnded })}
        />
        <InfoHelper topic="hideEnded" />
      </span>

      <label htmlFor="monitor-interval" className="monitor-controls__label" data-testid="monitor-interval-label">
        Capture every
      </label>
      <span className="monitor-controls__subject">
      <select
        id="monitor-interval"
        className="monitor-controls__select"
        data-testid="monitor-interval"
        title="Capture every … seconds"
        value={String(settings.intervalSeconds)}
        onChange={(e) =>
          void writeConfigPatch({ kind: 'settings' }, [
            { path: ['resourceMonitor', 'captureIntervalSeconds'], value: Number(e.target.value) },
          ])
        }
      >
        {offered.map((seconds) => (
          <option key={seconds} value={String(seconds)}>
            {seconds} s
          </option>
        ))}
      </select>
      <InfoHelper topic="interval" />
      </span>
    </div>
  );
}
