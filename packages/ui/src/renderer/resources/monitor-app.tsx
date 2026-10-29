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
 * The window must paint at once and never block input (FR-051, SC-002). The body — the two columns, the
 * list and the detail — is code the main window never needs (research R10, R16), which must add nothing to
 * startup (Principle XII), so it is `lazy()`: this shell appears with its loading state, and the body fills
 * in when its chunk has loaded AND the first frame has arrived.
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
import { ConfigProvider, useActiveTheme } from '../config/config-store.js';
import { ContextMenuProvider } from '../context-menu-provider.js';
import { useNoDropNavigation } from '../composition-root.js';
import { ConfirmProvider } from '../confirm-dialog.js';
import { NotificationProvider } from '../common/notification.js';
import { ThemeProvider } from '../theme/theme-provider.js';
import { windowTitle } from '../common/window-title.js';
import { HoverSuppression } from '../common/use-hover-suppression.js';
import { TitleBar } from '../title-bar/title-bar.js';
import {
  endSession,
  getSavedView,
  ingestFrame,
  reconfigureSession,
  restoreView,
  startSession,
  subscribeSession,
  useHasFrame,
  type SavedView,
} from './monitor-session.js';
import { Liveness } from './liveness.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';

const loadBody = (): Promise<typeof import('./monitor-body.js')> => import('./monitor-body.js');
const MonitorBody = lazy(loadBody);

/** The most often the view is sent to main while it is being typed or clicked into (SC-010). */
export const VIEW_SAVE_INTERVAL_MS = 250;

/** Sends a view change still waiting out the interval, at once; a no-op when nothing is waiting. */
let flushViewNow: () => void = () => undefined;

/**
 * Sends the view to main when it changes — the first change at once, then at most one send per interval,
 * the last send always carrying the latest view. It listens to the store directly rather than rendering
 * on every change: a keystroke in the filter changes the view, and the shell has nothing to redraw for it.
 */
function useSaveView(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const send = (view: SavedView): void => window.throng?.resources?.saveViewState?.(view);
    // What was restored is saved back as it stands; it does not start the interval.
    let sent: SavedView = getSavedView();
    send(sent);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = (): void => {
      timer = null;
      const view = getSavedView();
      if (view === sent) return;
      sent = view;
      send(view);
      timer = setTimeout(flush, VIEW_SAVE_INTERVAL_MS);
    };
    const off = subscribeSession(() => {
      if (timer === null && getSavedView() !== sent) flush();
    });
    const now = (): void => {
      if (getSavedView() === sent) return;
      sent = getSavedView();
      send(sent);
    };
    flushViewNow = now;
    // A window that is destroyed never runs React's cleanup, but its page does go away: whatever is still
    // waiting out the interval is sent then (FR-087).
    window.addEventListener('pagehide', now);
    return () => {
      off();
      window.removeEventListener('pagehide', now);
      if (flushViewNow === now) flushViewNow = () => undefined;
      if (timer !== null) clearTimeout(timer);
      // A change still waiting out the interval is not lost with the window.
      now();
    };
  }, [enabled]);
}

function MonitorShell(): ReactElement {
  const theme = useActiveTheme();
  const settings = useResourceMonitorSettings();
  // Only whether there is a first frame: the shell is not redrawn for the captures after it (D3).
  const hasFrame = useHasFrame();

  useEffect(() => {
    // Ask for the body's chunk now, so it loads while the first frame is on its way (D5).
    void loadBody();
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
  // Saved as it changes once restored — never before, which would overwrite it with the defaults.
  useSaveView(restored);

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

  /*
   * Esc closes the window (FR-052) — unless a context menu or a confirmation is open over it, whose own
   * Esc comes first. The confirmation dismisses without stopping the event, and is still in the DOM when
   * it reaches here, so a Kill cancelled with Esc must not take the window with it.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="menu"]') !== null) return;
      if (e.target instanceof Element && e.target.closest('[role="dialog"]') !== null) return;
      flushViewNow();
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
    flushViewNow();
    window.throng?.resources?.minimise?.({ reducedMotion });
  };

  return (
    <ThemeProvider theme={theme}>
      <div
        className="resource-monitor"
        data-testid="monitor-window"
        data-state={hasFrame ? 'ready' : 'loading'}
      >
        <HoverSuppression />
        <TitleBar identity={windowTitle('Resource Monitor')} showCog={false} onMinimise={minimise} />
        <div className="resource-monitor__content" data-testid="monitor-content">
          {/* "Collecting the first reading…", "Updated <time> (n s ago)" or "Figures from N s ago": one line (FR-091).
              Once the body is up it is the body's own first row (FR-121); until then — no reading, the view still
              being restored, the body's chunk still loading — it stands here alone. */}
          {!restored || !hasFrame ? (
            <Liveness />
          ) : (
            <Suspense fallback={<Liveness />}>
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
