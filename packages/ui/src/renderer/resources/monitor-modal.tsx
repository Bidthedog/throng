/**
 * The Resource Monitor modal's shell (055 US2, FR-050 – FR-052, SC-002): the dialog, its lifetime, and
 * nothing it draws inside.
 *
 * ══ WHY THE SHELL IS EAGER AND THE BODY IS NOT ══
 *
 * Opening must never block input and the dialog must be in the DOM at once (FR-051, SC-002). The body
 * — breakdown, charts, detail — carries uPlot and d3-hierarchy (research R10), which must add nothing to
 * startup (Principle XII). So the shell is small and static, and the body is `lazy()`: the dialog
 * appears in the same commit as the open call with its loading state, and the body fills in when its
 * chunk has loaded AND the first frame has arrived.
 *
 * ══ EXCLUSIVE (FR-050) ══
 *
 * While open, everything behind the dialog is `inert` — no pointer, no focus, no assistive technology —
 * and the window dispatcher refuses every window chord but this modal's own toggle
 * (`keybindings/window-dispatcher.tsx`). A modifier chord typed inside the dialog also stops here, so
 * the window's other key handlers (Save, Find) cannot act on the editor the user cannot see.
 *
 * ══ THE DETAIL SUBSCRIPTION (FR-003) ══
 *
 * Detailed collection runs only while some window has a subscription, so the subscription is exactly
 * this component's mount: opened with the dialog, released with it — including when the dialog closes
 * before the subscription has come back, which must still release it or detail mode would stay on.
 */
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';
import { formatGrouped } from '@throng/core';
import type { DetailFrame } from '@throng/ipc-contract';
import { IconButton } from '../common/icon-button.js';
import { useFocusTrap } from '../common/focus-trap.js';
import { closeMonitor, getStatusItemRect, openMonitor, useMonitorOpen } from './monitor-store.js';
import { endSession, ingestFrame, reconfigureSession, setView, startSession, useSession, useView } from './monitor-session.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';

const MonitorBody = lazy(() => import('./monitor-body.js'));

/** What stands in for any data not yet collected (FR-051). */
function Loading(): ReactElement {
  return (
    <p className="resource-monitor__loading" role="status" data-testid="monitor-loading">
      Collecting the first reading…
    </p>
  );
}

/**
 * "Figures from 14 s ago" while the collector is failing (FR-044): a status line that states the age of
 * what is on screen and clears itself on the next good frame. It is not the monitor's notice — it
 * carries no action, so nothing needs the inline notice's Dismiss, and a kill failure keeps that slot.
 * The age is the time of the last GOOD reading (a stale frame keeps it), re-read each second.
 */
function StaleAge({ frame }: { frame: DetailFrame | null }): ReactElement | null {
  const [now, setNow] = useState(() => Date.now());
  const stale = frame?.stale === true;
  useEffect(() => {
    if (!stale) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [stale]);
  if (frame === null || !stale) return null;
  const seconds = Math.max(0, Math.round((now - (frame.staleSince ?? frame.at)) / 1000));
  return (
    <p className="resource-monitor__stale" role="status" data-testid="monitor-stale">
      Figures from {formatGrouped(seconds)} s ago
    </p>
  );
}

function MonitorModal(): ReactElement {
  const settings = useResourceMonitorSettings();
  const { frame } = useSession();
  const trap = useFocusTrap<HTMLDivElement>(true);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // The workspace behind goes inert for exactly as long as the dialog is up, and the keyboard goes back
  // to where it came from. A layout effect, so `document.activeElement` is still the opener.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const behind = Array.from(overlay?.parentElement?.children ?? []).filter(
      (el) => el !== overlay && !el.hasAttribute('inert') && !el.matches('.modal-overlay, [role="dialog"]'),
    );
    for (const el of behind) el.setAttribute('inert', '');
    return () => {
      for (const el of behind) el.removeAttribute('inert');
    };
  }, []);
  // Declared AFTER the focus trap's own effect, so its `focusin` guard is already gone when this runs:
  // focus handed back while the guard is still up is pulled straight back into a dialog being removed.
  useEffect(
    () => () => {
      const target = opener.current;
      if (target?.isConnected && target !== document.body) target.focus();
    },
    [],
  );

  // The session, and the detail subscription that feeds it.
  const initial = useRef(settings);
  useEffect(() => {
    const api = window.throng?.resources;
    startSession({ intervalSeconds: initial.current.intervalSeconds, historyMinutes: initial.current.historyMinutes });
    let released = false;
    let subscriptionId: number | null = null;
    const off = api?.onDetail(ingestFrame);
    void api?.subscribeDetail().then(({ subscriptionId: id }) => {
      if (released) void api.unsubscribeDetail(id);
      else subscriptionId = id;
    });
    return () => {
      released = true;
      off?.();
      if (subscriptionId !== null) void api?.unsubscribeDetail(subscriptionId);
      endSession();
    };
  }, []);

  // A changed capture interval or history window resizes the rolling window in place.
  useEffect(() => {
    reconfigureSession({ intervalSeconds: settings.intervalSeconds, historyMinutes: settings.historyMinutes });
  }, [settings.intervalSeconds, settings.historyMinutes]);

  // ── Maximise / Restore, and Minimise (US5, FR-056, FR-058) ──────────────────────────────────────
  const view = useView();
  const maximised = view.maximised;
  const minimising = useRef<Animation | 'pending' | null>(null);
  useEffect(
    () => () => {
      const running = minimising.current;
      if (running !== null && running !== 'pending') running.cancel();
    },
    [],
  );
  /**
   * Minimise is Close with a destination: the dialog shrinks toward the status-bar item it came from
   * (one `Element.animate`, FLIP — the rectangles are read once, here, and the browser does the rest on
   * the compositor), then closes when the animation finishes. With no item to move toward, or under
   * `prefers-reduced-motion`, it closes at once.
   */
  const minimise = (): void => {
    if (minimising.current !== null) return;
    const el = trap.ref.current;
    const item = getStatusItemRect();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (el === null || item === null || reduced || typeof el.animate !== 'function') {
      closeMonitor();
      return;
    }
    minimising.current = 'pending';
    const from = el.getBoundingClientRect();
    const dx = item.left + item.width / 2 - (from.left + from.width / 2);
    const dy = item.top + item.height / 2 - (from.top + from.height / 2);
    const sx = item.width / from.width;
    const sy = item.height / from.height;
    const animation = el.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0 },
      ],
      { duration: 220, easing: 'ease-in', fill: 'forwards' },
    );
    minimising.current = animation;
    animation.finished.then(closeMonitor, closeMonitor);
  };

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    // Esc closes (FR-052) — unless a context menu is open over the dialog, which closes first.
    if (e.key === 'Escape' && document.querySelector('[role="menu"]') === null) {
      e.stopPropagation();
      closeMonitor();
      return;
    }
    // A command chord typed here is the dialog's, not the window's: the window's other listeners (Save,
    // Find) must not act on a workspace the user cannot reach.
    if (e.ctrlKey || e.altKey || e.metaKey) e.stopPropagation();
    trap.onKeyDown(e);
  };

  return (
    <div
      ref={overlayRef}
      className="modal-overlay resource-monitor-overlay"
      data-testid="monitor-overlay"
      // The scrim dismisses nothing and must not pull focus off the dialog (as the confirmation's).
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <div
        ref={trap.ref}
        className="resource-monitor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-monitor-title"
        data-testid="monitor-dialog"
        data-state={frame === null ? 'loading' : 'ready'}
        data-maximised={maximised ? 'true' : 'false'}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id="resource-monitor-title" className="resource-monitor__title">
          Resource Monitor
        </h2>
        <StaleAge frame={frame} />
        <div className="resource-monitor__content">
          {frame === null ? (
            <Loading />
          ) : (
            <Suspense fallback={<Loading />}>
              <MonitorBody />
            </Suspense>
          )}
        </div>
        {/*
          Last in the DOM, first in the eye: FR-068's Tab order ends at the controls, so they follow the
          filter, breakdown, chart and detail; the stylesheet puts them at the top right.
        */}
        <div className="resource-monitor__window-controls" data-testid="monitor-window-controls" data-region="window">
          <IconButton
            token="windowMinimise"
            title="Minimise"
            testId="monitor-minimise"
            className="icon-button resource-monitor__control"
            onClick={minimise}
          />
          <IconButton
            token={maximised ? 'panelRestore' : 'panelMaximise'}
            title={maximised ? 'Restore' : 'Maximise'}
            testId="monitor-maximise"
            className="icon-button resource-monitor__control"
            onClick={() => setView({ maximised: !maximised })}
          />
          <IconButton
            token="dismiss"
            title="Close"
            testId="monitor-close"
            className="icon-button resource-monitor__control"
            onClick={closeMonitor}
          />
        </div>
      </div>
    </div>
  );
}

/** Mounted once in the main window (`app.tsx`): the modal while open, and the listener for another window's request. */
export function ResourceMonitorHost(): ReactElement | null {
  const open = useMonitorOpen();
  // A sub-workspace window asked for the monitor; main forwards it here and brings this window forward.
  useEffect(() => window.throng?.resources?.onOpenRequest(openMonitor), []);
  return open ? <MonitorModal /> : null;
}
