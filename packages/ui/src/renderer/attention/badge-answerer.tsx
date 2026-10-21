import { useEffect } from 'react';
import { domBadgeDeps, renderBadge } from './badge-renderer.js';

/**
 * Answers main's request for the taskbar badge image (057 FR-039, research R13).
 *
 * Mounted in every window; main sends each request to exactly ONE of them — the main window, or a
 * sub-workspace window while the main window is closed — so there is one answerer per request. The
 * preload correlates the reply; this just returns the PNG data URL, and a throw becomes a failed reply.
 */
export function BadgeAnswerer(): null {
  useEffect(() => {
    const attention = window.throng?.attention;
    if (!attention?.onBadgeRequest) return undefined;
    return attention.onBadgeRequest((req) => renderBadge(req, domBadgeDeps()));
  }, []);
  return null;
}
