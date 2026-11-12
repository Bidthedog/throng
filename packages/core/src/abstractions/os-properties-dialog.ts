import type { ShellActionResult } from './shell-integration.js';

/** The OS's own Properties dialog, where it has one (067 FR-053). */
export interface IOsPropertiesDialog {
  readonly available: boolean;
  readonly unavailableReason?: string;
  show(path: string): Promise<ShellActionResult>;
}
