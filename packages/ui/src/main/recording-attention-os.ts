import type { ISystemNotifier, ITaskbarBadge } from '@throng/core';

/**
 * One OS-facing call, as the E2E harness reads it back (057). Electron's `Notification` and
 * `setOverlayIcon` cannot be observed from Playwright, so under `THRONG_E2E_ATTENTION_OS=record` the
 * composition root binds these recorders in their place and they write each effective call to a sink.
 */
export type OsCall =
  | { target: 'notifier'; op: 'show'; id: string; title: string; body: string; kind: 'attention' | 'failed' }
  | { target: 'notifier'; op: 'close'; id: string }
  | { target: 'badge'; op: 'set'; image: string; description: string }
  | { target: 'badge'; op: 'clear' };

export type OsCallSink = (call: OsCall) => void;

export class RecordingSystemNotifier implements ISystemNotifier {
  private readonly shown = new Set<string>();
  private readonly handlers: Array<(id: string) => void> = [];

  constructor(private readonly sink: OsCallSink) {}

  show(n: { id: string; title: string; body: string; kind: 'attention' | 'failed' }): void {
    this.shown.add(n.id);
    this.sink({ target: 'notifier', op: 'show', id: n.id, title: n.title, body: n.body, kind: n.kind });
  }

  close(id: string): void {
    if (!this.shown.delete(id)) return;
    this.sink({ target: 'notifier', op: 'close', id });
  }

  onClick(handler: (id: string) => void): void {
    this.handlers.push(handler);
  }

  /** Simulate the user activating a shown notification. */
  activate(id: string): void {
    if (!this.shown.has(id)) return;
    for (const h of this.handlers) h(id);
  }
}

export class RecordingTaskbarBadge implements ITaskbarBadge {
  private showing = false;

  constructor(private readonly sink: OsCallSink) {}

  set(image: string, description: string): void {
    this.showing = true;
    this.sink({ target: 'badge', op: 'set', image, description });
  }

  clear(): void {
    if (!this.showing) return;
    this.showing = false;
    this.sink({ target: 'badge', op: 'clear' });
  }
}
