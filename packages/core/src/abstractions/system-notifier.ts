/**
 * The OS notification seam (057, Principle II).
 *
 * Shows a notification outside throng's own windows for a panel that needs the user. `id` is the panel id,
 * so a repeat raise for the same panel replaces the one shown (FR-035) and a clear closes it (FR-036).
 */
export interface ISystemNotifier {
  show(n: { id: string; title: string; body: string; kind: 'attention' | 'failed' }): void;
  /** Close the notification with this id; a no-op when none is shown. */
  close(id: string): void;
  /** Register a handler for the user activating a notification. */
  onClick(handler: (id: string) => void): void;
}

/** Shows nothing; for platforms and tests with no notification surface. */
export class NoSystemNotifier implements ISystemNotifier {
  show(): void {}
  close(): void {}
  onClick(): void {}
}
