/**
 * The one line that says the monitor is alive (055 FR-091, FR-044, FR-051, FR-121): "Collecting the first
 * reading…" before the first capture, "Updated <date and time> (<n> s ago)" — with a pulse on each capture and
 * the count running up each second — after it, and "Figures from N s ago" while the collector is failing. Three
 * states of one line, not three messages in three places (030: one condition, one notice).
 *
 * It is the centre of the body's first row (`monitor-body.tsx`): <filter> | Updated … | ?. The count reserves
 * the width of two digits in CSS (`.monitor-liveness__ago`), so the row does not shift as it counts 1 to 59.
 *
 * It is a live region only in the two states that are news (collecting; stale). The "Updated" state changes
 * every second and announcing each one would drown a screen reader, so it carries no role.
 *
 * The pulse is a fresh element per capture (`key` = the capture's tick), so a CSS animation plays again
 * rather than being a class that never changes; theme.css plays none under reduced motion.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { formatGrouped } from '@throng/core';
import { useSession } from './monitor-session.js';

export function Liveness(): ReactElement {
  const { frame } = useSession();
  const stale = frame?.stale === true;
  const live = frame !== null;

  // The age of what is on screen, re-read each second once there is anything on screen.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live, frame?.tick]);

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
  const ago = Math.max(0, Math.floor((now - frame.at) / 1000));
  return (
    <p className="monitor-liveness" data-testid="monitor-updated" data-state="live">
      <span key={frame.tick} className="monitor-liveness__pulse" data-testid="monitor-liveness-pulse" data-tick={frame.tick} aria-hidden="true" />
      Updated {new Date(frame.at).toLocaleString()} (
      <span className="monitor-liveness__ago" data-testid="monitor-liveness-ago">
        {formatGrouped(ago)}
      </span>{' '}
      s ago)
    </p>
  );
}
