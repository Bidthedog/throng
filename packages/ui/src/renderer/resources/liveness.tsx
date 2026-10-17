/**
 * The one line that says the monitor is alive (055 FR-091, FR-044, FR-051): "Collecting the first reading…"
 * before the first capture, "Updated <time> · every <n> s" — with a pulse on each capture — after it, and
 * "Figures from N s ago" while the collector is failing. Three states of one line, not three messages in
 * three places (030: one condition, one notice).
 *
 * It is a live region only in the two states that are news (collecting; stale). The "Updated" state changes
 * every two seconds and announcing each one would drown a screen reader, so it carries no role.
 *
 * The pulse is a fresh element per capture (`key` = the capture's tick), so a CSS animation plays again
 * rather than being a class that never changes; theme.css plays none under reduced motion.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { formatGrouped } from '@throng/core';
import { useSession } from './monitor-session.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';

export function Liveness(): ReactElement {
  const { frame } = useSession();
  const { intervalSeconds } = useResourceMonitorSettings();
  const stale = frame?.stale === true;

  // The age of what is on screen, re-read each second — but only while it is stale.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!stale) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [stale]);

  if (frame === null) {
    return (
      <p className="monitor-liveness" role="status" data-testid="monitor-loading" data-state="collecting">
        Collecting the first reading…
      </p>
    );
  }
  if (stale) {
    // The time of the last GOOD reading: a stale frame keeps it.
    const seconds = Math.max(0, Math.round((now - (frame.staleSince ?? frame.at)) / 1000));
    return (
      <p className="monitor-liveness monitor-liveness--stale" role="status" data-testid="monitor-stale" data-state="stale">
        Figures from {formatGrouped(seconds)} s ago
      </p>
    );
  }
  return (
    <p className="monitor-liveness" data-testid="monitor-updated" data-state="live">
      <span key={frame.tick} className="monitor-liveness__pulse" data-testid="monitor-liveness-pulse" data-tick={frame.tick} aria-hidden="true" />
      Updated {new Date(frame.at).toLocaleTimeString()} · every {formatGrouped(intervalSeconds)} s
    </p>
  );
}
