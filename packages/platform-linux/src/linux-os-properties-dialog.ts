import type { IOsPropertiesDialog, ShellActionResult } from '@throng/core';

/** Linux has no such dialog an application can open: the action is absent (067 FR-122, Principle II). */
export class LinuxOsPropertiesDialog implements IOsPropertiesDialog {
  readonly available = false;

  async show(): Promise<ShellActionResult> {
    return { ok: false, osReason: 'Linux has no standard Properties dialog that an application can open.' };
  }
}
