/**
 * The taskbar badge seam (057, FR-039, Principle II).
 *
 * The badge is drawn by the renderer (so it carries the theme's colours) and handed over as a PNG data
 * URL; the implementation puts it on every window that has a taskbar button.
 */
export interface ITaskbarBadge {
  set(image: string, description: string): void;
  clear(): void;
}

/** Badges nothing; for platforms and tests with no taskbar. */
export class NoTaskbarBadge implements ITaskbarBadge {
  set(): void {}
  clear(): void {}
}
