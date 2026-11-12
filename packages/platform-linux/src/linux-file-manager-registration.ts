import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FileManagerRegistration, IFileManagerRegistration } from '@throng/core';

/** Same-named files in the user's own data folder, which each file manager reads ahead of the system-wide one. */
const OVERRIDES: readonly { readonly path: string; readonly body: string }[] = [
  { path: '.local/share/nemo/actions/throng-open-project.nemo_action', body: '[Nemo Action]\nActive=false\n' },
  { path: '.local/share/kio/servicemenus/throng-open-project-kde.desktop', body: '[Desktop Entry]\nHidden=true\n' },
  { path: '.local/share/applications/throng-open-project.desktop', body: '[Desktop Entry]\nHidden=true\n' },
];
const UNAVAILABLE: FileManagerRegistration = { state: 'unavailable', reason: 'This copy of throng was not installed from a package, so it registers nothing.' };

/** The packaged file-manager items, switched per user with no administrator prompt (067 FR-034). */
export class LinuxFileManagerRegistration implements IFileManagerRegistration {
  constructor(
    private readonly home: string,
    private readonly installed: boolean,
  ) {}

  async status(): Promise<FileManagerRegistration> {
    if (!this.installed) return UNAVAILABLE;
    return { state: OVERRIDES.some((o) => existsSync(join(this.home, o.path))) ? 'off' : 'on' };
  }

  async setEnabled(on: boolean): Promise<FileManagerRegistration> {
    if (!this.installed) return UNAVAILABLE;
    for (const override of OVERRIDES) {
      const path = join(this.home, override.path);
      if (on) {
        await rm(path, { force: true });
      } else {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, override.body);
      }
    }
    return this.status();
  }
}
