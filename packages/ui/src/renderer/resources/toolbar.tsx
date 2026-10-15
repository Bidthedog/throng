/**
 * The monitor's toolbar (055 FR-004a, FR-055, FR-061), in two parts because the Tab order puts the filter
 * FIRST and the controls LAST (FR-068): `FilterField` and `ToolbarControls`.
 *
 * Every action is a themeable icon control with a hover title (FR-055): the metric choice, hide idle and
 * clear-filter are `IconButton`s; narrowing and the capture interval are selects, which are choices and
 * not actions, and carry titles all the same.
 */
import { useCallback, useRef, useState, type ReactElement } from 'react';
import { allowedIntervals, type ResourceNode } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { writeConfigPatch } from '../config/write-config.js';
import { FIGURE_ICON, FIGURE_LABEL, FIGURE_ORDER, type FigureId } from './figures.js';
import { HelpButton, HelpPanel } from './help-panel.js';
import { focusOn, setSelection, setView, useSession, useView } from './monitor-session.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';

export function FilterField(): ReactElement {
  const view = useView();
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

const COMPONENT_OPTIONS: readonly { id: string; label: string }[] = [
  { id: 'c:ui', label: 'UI' },
  { id: 'c:daemon', label: 'Daemon' },
  { id: 'c:helpers', label: 'Helpers' },
  { id: 'c:projects', label: 'Projects' },
];

function projectOptions(tree: ResourceNode | null): { id: string; label: string }[] {
  const projects = tree?.children.find((c) => c.id === 'c:projects');
  return (projects?.children ?? []).filter((c) => c.kind === 'project').map((p) => ({ id: p.id, label: p.label }));
}

/** Where drilling to a narrowed node puts the focus: a project sits under the Projects component. */
function pathTo(id: string | null): string[] {
  if (id === null) return ['root'];
  return id.startsWith('p:') ? ['root', 'c:projects', id] : ['root', id];
}

export function ToolbarControls(): ReactElement {
  const view = useView();
  const { tree } = useSession();
  const settings = useResourceMonitorSettings();

  // The help panel (FR-093). Closing it from the keyboard, or by pressing its button again, hands focus back.
  const [helpOpen, setHelpOpen] = useState(false);
  const helpButton = useRef<HTMLButtonElement | null>(null);
  const setHelpButton = useCallback((el: HTMLButtonElement | null): void => {
    helpButton.current = el;
  }, []);
  const closeHelp = useCallback((returnFocus: boolean): void => {
    setHelpOpen(false);
    if (returnFocus) helpButton.current?.focus();
  }, []);

  const intervals = allowedIntervals(settings.historyMinutes);
  // A stored value between the offered ones is still the value in force: show it rather than a lie.
  const offered = intervals.includes(settings.intervalSeconds)
    ? intervals
    : [...intervals, settings.intervalSeconds].sort((a, b) => a - b);

  return (
    <>
    <div className="monitor-controls" role="toolbar" aria-label="Monitor controls" data-testid="monitor-controls">
      <select
        className="monitor-controls__select"
        data-testid="monitor-narrow"
        title="Narrow to a component or a project"
        aria-label="Narrow to a component or a project"
        value={view.narrowTo ?? ''}
        onChange={(e) => {
          const id = e.target.value === '' ? null : e.target.value;
          setView({ narrowTo: id });
          focusOn(pathTo(id));
          setSelection(null);
        }}
      >
        <option value="">Everything</option>
        {COMPONENT_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        {projectOptions(tree).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>

      <span id="monitor-size-by" className="monitor-controls__label" data-testid="monitor-size-by-label">
        Size by
      </span>
      <div className="monitor-controls__group" role="group" aria-labelledby="monitor-size-by">
        {FIGURE_ORDER.map((id: FigureId) => (
          <IconButton
            key={id}
            token={FIGURE_ICON[id]}
            title={`Show by ${FIGURE_LABEL[id]}`}
            testId={`monitor-metric-${id}`}
            className="icon-button monitor-controls__button"
            ariaPressed={view.metric === id}
            onClick={() => setView({ metric: id })}
          />
        ))}
      </div>

      <IconButton
        token="resourceHideIdle"
        title="Hide idle processes"
        testId="monitor-hide-idle"
        className="icon-button monitor-controls__button"
        ariaPressed={view.hideIdle}
        onClick={() => setView({ hideIdle: !view.hideIdle })}
      />

      <label htmlFor="monitor-interval" className="monitor-controls__label" data-testid="monitor-interval-label">
        Capture every
      </label>
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

      <HelpButton open={helpOpen} onToggle={() => (helpOpen ? closeHelp(true) : setHelpOpen(true))} nodeRef={setHelpButton} />
    </div>
      {/* Outside the toolbar: a dialog is not a control of it. */}
      {helpOpen ? <HelpPanel anchor={helpButton} onClose={closeHelp} /> : null}
    </>
  );
}
