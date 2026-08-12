import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { DaemonState, DaemonStatus } from '@throng/core';
import { Icon } from '../common/icon.js';
import { useNotify } from '../common/notification.js';

/**
 * 029 / #182 — the daemon's state in the status bar, and the way to fix it.
 *
 * ══ WHY THE INDICATOR IS ALSO THE CONTROL ══
 *
 * The notice that announces a stopped daemon is transient. Putting the restart on it would mean the
 * action vanishes the moment the user dismisses it, leaving them no way back except to provoke
 * another failure. So the notice REPORTS and the status bar ACTS — one control, always present,
 * where the user is already looking once they suspect something is wrong.
 *
 * This is the only route to a restart, which is safe because the status bar renders unconditionally:
 * `editor.showStatusBar` / `terminals.showStatusBar` are per-panel settings and do not hide it. If a
 * global hide is ever added, this becomes a last-route problem and needs a second home.
 */

/** Nothing is drawn while the daemon is healthy — a status bar that always shouts says nothing. */
const SILENT: DaemonStatus = 'running';

const LABEL: Record<Exclude<DaemonStatus, 'running'>, string> = {
  reconnecting: 'Daemon reconnecting…',
  stopped: 'Daemon stopped — click to restart',
  restarting: 'Restarting daemon…',
};

export function DaemonIndicator(): ReactElement | null {
  const [state, setState] = useState<DaemonState | null>(null);
  const { notify } = useNotify();

  useEffect(() => {
    const api = window.throng?.daemon;
    if (!api) return;
    void api.state().then((s) => setState(s as DaemonState));
    return api.onState((s) => setState(s as DaemonState));
  }, []);

  /*
   * FR-007 — say it ONCE, when it becomes true.
   *
   * Keyed on entering `stopped`, not on rendering while stopped, so a re-render for any other reason
   * cannot re-announce it. `reconnecting` is deliberately silent: a blip the user never noticed is
   * not news, and announcing every daemon restart during development is how a notice gets ignored.
   */
  const status = state?.status;
  useEffect(() => {
    if (status !== 'stopped') return;
    notify({
      severity: 'error',
      /*
       * NO SUBJECT (030 FR-019/FR-027). The subject is throng's DAEMON, which the closed union does
       * not name — and does not need to: this notice carries an explicit `title` that names it,
       * and a title wins the heading outright. There is exactly one daemon, so "which one?" — the
       * question a subject answers — cannot be asked about it.
       */
      subject: { kind: 'none' },
      title: 'throng’s daemon has stopped',
      message:
        'Terminals will not respond and changes will not be saved until it restarts. Use the daemon indicator in the status bar to restart it.',
      testId: 'daemon-error',
      causeKey: 'daemon-stopped:throng',
    });
  }, [status, notify]);

  const onRestart = useCallback(async () => {
    const res = await window.throng?.daemon?.restart();
    // FR-009 — the user is told whether it worked. A restart that silently failed would leave them
    // clicking a control that appears to do nothing.
    if (res && !res.ok) {
      notify({
        severity: 'error',
        // No subject, for the reason above: the daemon is not a member of the union, and this
        // notice's own title names it.
        subject: { kind: 'none' },
        title: 'Could not restart the daemon',
        message: res.error ?? 'throng could not restart its daemon.',
        testId: 'daemon-error',
      });
    }
  }, [notify]);

  if (!state || state.status === SILENT) return null;
  // Narrowed by the guard above — `running` is the one status with no label, by design.
  const label = LABEL[state.status as Exclude<DaemonStatus, 'running'>];

  return (
    <button
      type="button"
      className="throng-status-bar__daemon"
      data-testid="status-daemon"
      data-status={state.status}
      title={label}
      aria-label={label}
      // FR-009b: a restart already in flight cannot be triggered a second time.
      disabled={state.status === 'restarting'}
      onClick={() => void onRestart()}
    >
      {/*
        Always the RETRY glyph, in every state, because that is what this control DOES: restart the
        daemon. There is no `error` token in the registry, and inventing one would mean touching the
        theme copy and every shipped icon pack for a decoration. The state is already carried by the
        hover title and by `data-status`, which is what styling keys off.
      */}
      <Icon token="retry" />
    </button>
  );
}
