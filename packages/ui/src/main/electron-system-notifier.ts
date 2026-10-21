import type { ISystemNotifier } from '@throng/core';

/** The slice of Electron's `Notification` this adapter uses; structural so it needs no Electron to test. */
export interface NotificationLike {
  show(): void;
  close(): void;
  on(event: 'click' | 'close', listener: () => void): unknown;
}

export type NotificationFactory = (options: { title: string; body: string }) => NotificationLike;

/**
 * 057 — ISystemNotifier over Electron's `Notification`. One notification per panel id: a repeat
 * `show` closes the one on screen and shows its replacement (FR-035), `close` withdraws it (FR-036),
 * and a click is handed to the registered handler with the panel id.
 */
export class ElectronSystemNotifier implements ISystemNotifier {
  private readonly shown = new Map<string, NotificationLike>();
  private readonly handlers: Array<(id: string) => void> = [];

  constructor(private readonly create: NotificationFactory) {}

  show(n: { id: string; title: string; body: string; kind: 'attention' | 'failed' }): void {
    this.shown.get(n.id)?.close();
    const notification = this.create({ title: n.title, body: n.body });
    this.shown.set(n.id, notification);
    notification.on('click', () => {
      for (const h of this.handlers) h(n.id);
    });
    notification.on('close', () => {
      // Only forget it if it is still the one on screen: a replaced notification closes late.
      if (this.shown.get(n.id) === notification) this.shown.delete(n.id);
    });
    notification.show();
  }

  close(id: string): void {
    const notification = this.shown.get(id);
    if (!notification) return;
    this.shown.delete(id);
    notification.close();
  }

  onClick(handler: (id: string) => void): void {
    this.handlers.push(handler);
  }
}
