/**
 * The Resource Monitor window's app (055 FR-081 – FR-087, research R14): mounted by `main.tsx` for a
 * window launched with `?monitor`, beside the main window the way Preferences is.
 *
 * ══ A WINDOW, NOT A DIALOG ══
 *
 * The monitor used to be a modal dialog inside the main window, which made throng unusable while it was
 * open: everything behind it was `inert` and every window chord refused (the retired FR-050). It is now
 * its own frameless window — the Preferences title bar, the Preferences providers — so the terminal can
 * be typed into while it is open. Nothing here knows about the workspace; whatever has to run in the
 * window that owns a tab, a panel or a project goes through `resources.routeAction` (FR-086).
 *
 * ══ WHY THE SHELL IS EAGER AND THE BODY IS NOT ══
 *
 * The window must paint at once and never block input (FR-051, SC-002). The body — breakdown, charts,
 * detail — carries uPlot and d3-hierarchy (research R10), which must add nothing to startup (Principle
 * XII), so it is `lazy()`: this shell appears with its loading state, and the body fills in when its
 * chunk has loaded AND the first frame has arrived.
 *
 * ══ THE DETAIL SUBSCRIPTION (FR-003) ══
 *
 * Detailed collection runs only while some window has a subscription, so the subscription is exactly
 * this component's mount: opened with the window, released with it — including when the window closes
 * before the subscription has come back, which must still release it or detail mode would stay on.
 *
 * ══ THE VIEW (FR-087) ══
 *
 * Every open is a fresh renderer, so the view the user left is held by UI main until throng restarts:
 * read on mount and applied before the body is drawn, saved on every change. Whether the window was
 * maximised is main's to remember with its bounds, so it is not part of the view.
 */
import { lazy, Suspense, useEffect, useRef, useState, type ReactElement } from 'react';
import { formatGrouped } from '@throng/core';
import type { DetailFrame } from '@throng/ipc-contract';
import { ConfigProvider, useActiveTheme } from '../config/config-store.js';
import { ContextMenuProvider } from '../context-menu-provider.js';
import { useNoDropNavigation } from '../composition-root.js';
import { ConfirmProvider } from '../confirm-dialog.js';
import { NotificationProvider } from '../common/notification.js';
import { ThemeProvider } from '../theme/theme-provider.js';
import { windowTitle } from '../common/window-title.js';
import { HoverSuppression } from '../common/use-hover-suppression.js';
import { TitleBar } from '../title-bar/title-bar.js';
import { endSession, ingestFrame, reconfigureSession, restoreView, startSession, useSession, useView } from './monitor-session.js';
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

function MonitorShell(): ReactElement {
  const theme = useActiveTheme();
  const settings = useResourceMonitorSettings();
  const { frame } = useSession();
  const view = useView();

  useEffect(() => {
    document.title = windowTitle('Resource Monitor');
  }, []);

  // The view the last monitor window left, applied before the body is drawn (FR-087).
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    let live = true;
    const api = window.throng?.resources;
    const read = api?.viewState?.() ?? Promise.resolve(null);
    void read.then(
      (raw) => {
        if (!live) return;
        restoreView(raw);
        setRestored(true);
      },
      () => {
        if (live) setRestored(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);
  // Saved on every change once restored — never before, which would overwrite it with the defaults.
  useEffect(() => {
    if (restored) window.throng?.resources?.saveViewState?.(view);
  }, [view, restored]);

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

  // Esc closes the window (FR-052) — unless a context menu is open over it, which closes first.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="menu"]') !== null) return;
      window.throng?.window?.close?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /**
   * Minimise is Close with a destination (FR-085): main shrinks this window toward the status-bar
   * figures and closes it. Reduced motion is the renderer's to know, so it is passed along.
   */
  const minimise = (): void => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    window.throng?.resources?.minimise?.({ reducedMotion });
  };

  return (
    <ThemeProvider theme={theme}>
      <div
        className="resource-monitor"
        data-testid="monitor-window"
        data-state={frame === null ? 'loading' : 'ready'}
      >
        <HoverSuppression />
        <TitleBar identity={windowTitle('Resource Monitor')} showCog={false} onMinimise={minimise} />
        <div className="resource-monitor__content" data-testid="monitor-content">
          <StaleAge frame={frame} />
          {!restored || frame === null ? (
            <Loading />
          ) : (
            <Suspense fallback={<Loading />}>
              <MonitorBody />
            </Suspense>
          )}
        </div>
      </div>
    </ThemeProvider>
  );
}

export function MonitorApp(): ReactElement {
  // A separate renderer realm with its own root: a file dropped anywhere would otherwise navigate it.
  useNoDropNavigation();
  return (
    <ConfigProvider>
      <NotificationProvider>
        <ConfirmProvider>
          <ContextMenuProvider>
            <MonitorShell />
          </ContextMenuProvider>
        </ConfirmProvider>
      </NotificationProvider>
    </ConfigProvider>
  );
}
