import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logExpected, type FileManagerRegistration, type IFileManagerRegistration } from '@throng/core';

const run = promisify(execFile);
const VERBS = ['Software\\Classes\\Directory\\shell\\throng.OpenProject', 'Software\\Classes\\Directory\\Background\\shell\\throng.OpenProject'];
const LABEL = 'Open as throng project';
const UNAVAILABLE: FileManagerRegistration = { state: 'unavailable', reason: 'This copy of throng was not installed, so it registers nothing with the OS.' };
const MACHINE: FileManagerRegistration = { state: 'machine-wide', reason: 'Installed for everyone on this computer. Changing it needs the installer, run as administrator.' };

/** The registry calls this needs. Keys are full paths, starting `HKCU\\` or `HKLM\\`. */
export interface RegistryPort {
  exists(key: string): Promise<boolean>;
  setDefault(key: string, value: string): Promise<void>;
  deleteTree(key: string): Promise<void>;
}

/** The classic verb on a folder and a folder's background (067 FR-030), per user, through the preference (FR-034). */
export class WindowsFileManagerRegistration implements IFileManagerRegistration {
  constructor(
    private readonly registry: RegistryPort,
    private readonly execPath: string,
    private readonly installed: boolean,
  ) {}

  async status(): Promise<FileManagerRegistration> {
    if (!this.installed) return UNAVAILABLE;
    if (await this.registry.exists(`HKLM\\${VERBS[0]!}`)) return MACHINE;
    return { state: (await this.registry.exists(`HKCU\\${VERBS[0]!}`)) ? 'on' : 'off' };
  }

  async setEnabled(on: boolean): Promise<FileManagerRegistration> {
    const current = await this.status();
    if (current.state === 'unavailable' || current.state === 'machine-wide') return current;
    for (const verb of VERBS) {
      const key = `HKCU\\${verb}`;
      if (on) {
        await this.registry.setDefault(key, LABEL);
        await this.registry.setDefault(`${key}\\command`, `"${this.execPath}" "%V"`);
      } else {
        // `reg delete` fails on a key that is already gone, which is the state being asked for.
        if (await this.registry.exists(key)) await this.registry.deleteTree(key);
      }
    }
    return this.status();
  }
}

/** {@link RegistryPort} through `reg.exe`. */
export const REG_EXE: RegistryPort = {
  exists: async (key) => {
    try {
      await run('reg', ['query', key]);
      return true;
    } catch (error) {
      logExpected('windows-file-manager-registration: query a key', 'reg query fails when the key is absent, which is the answer', error);
      return false;
    }
  },
  setDefault: async (key, value) => {
    await run('reg', ['add', key, '/ve', '/d', value, '/f']);
  },
  deleteTree: async (key) => {
    await run('reg', ['delete', key, '/f']);
  },
};
