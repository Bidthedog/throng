import { NOTICE_SEVERITIES, type AppSettings, type ISystemNotifier, type NoticeSeverity } from '@throng/core';

/** A notice's Windows notification id; the attention service ignores clicks on these (they are not marks). */
export const NOTICE_OS_ID_PREFIX = 'notice:';

/** Longest title and body sent to the OS; Windows truncates long text anyway, and the renderer is not trusted. */
const MAX_TEXT = 500;

export interface NoticeOsWindows {
  /** The focused throng window, or null when none is. */
  focusedId(): number | null;
  /** The main window, or null once it has closed. */
  mainId(): number | null;
  /** Restore, show and focus a window. */
  raise(windowId: number): void;
}

export interface NoticeOsDeps {
  notifier: ISystemNotifier;
  windows: NoticeOsWindows;
  settings: () => Pick<AppSettings, 'notifications'>;
}

/**
 * 057 FR-110 — an ordinary notice also raised as a Windows notification. The renderer sends each notice
 * it accepts; this decides, with main's own view of focus and the settings, whether one is shown:
 * only while no throng window is focused, and only while both the global switch (FR-109) and the
 * notice's type allow it. Clicking one brings throng's main window forward.
 */
export class NoticeOs {
  private seq = 0;

  constructor(private readonly deps: NoticeOsDeps) {
    deps.notifier.onClick((id) => {
      if (!id.startsWith(NOTICE_OS_ID_PREFIX)) return;
      const main = deps.windows.mainId();
      if (main !== null) deps.windows.raise(main);
    });
  }

  /** A notice the renderer accepted. Untrusted input: anything malformed is ignored. */
  show(input: unknown): void {
    const n = input as { severity?: unknown; title?: unknown; body?: unknown } | null;
    if (!n || !NOTICE_SEVERITIES.includes(n.severity as NoticeSeverity)) return;
    if (typeof n.title !== 'string' || typeof n.body !== 'string') return;
    const severity = n.severity as NoticeSeverity;
    const { notifications } = this.deps.settings();
    if (!notifications.os || !notifications[severity].os) return;
    if (this.deps.windows.focusedId() !== null) return;
    this.deps.notifier.show({
      id: `${NOTICE_OS_ID_PREFIX}${++this.seq}`,
      title: n.title.slice(0, MAX_TEXT),
      body: n.body.slice(0, MAX_TEXT),
      kind: severity === 'error' ? 'failed' : 'attention',
    });
  }
}
