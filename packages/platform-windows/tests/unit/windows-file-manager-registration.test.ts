import { describe, expect, it } from 'vitest';
import { WindowsFileManagerRegistration, type RegistryPort } from '../../src/windows-file-manager-registration.js';

const EXE = 'C:\\Users\\u\\AppData\\Local\\Programs\\throng\\throng.exe';
const FOLDER_KEY = 'Software\\Classes\\Directory\\shell\\throng.OpenProject';
const BACKGROUND_KEY = 'Software\\Classes\\Directory\\Background\\shell\\throng.OpenProject';

function fakeRegistry(machine = false): RegistryPort & { keys: Map<string, string> } {
  const keys = new Map<string, string>();
  if (machine) keys.set(`HKLM\\${FOLDER_KEY}`, '');
  return {
    keys,
    exists: async (key) => keys.has(key),
    setDefault: async (key, value) => void keys.set(key, value),
    deleteTree: async (key) => {
      for (const k of [...keys.keys()]) if (k === key || k.startsWith(`${key}\\`)) keys.delete(k);
    },
  };
}

describe('WindowsFileManagerRegistration (067 FR-030, FR-034)', () => {
  it('is off with nothing registered', async () => {
    expect(await new WindowsFileManagerRegistration(fakeRegistry(), EXE, true).status()).toEqual({ state: 'off' });
  });

  it('writes both verbs with the quoted path form and reports on', async () => {
    const reg = fakeRegistry();
    const svc = new WindowsFileManagerRegistration(reg, EXE, true);
    expect(await svc.setEnabled(true)).toEqual({ state: 'on' });
    expect(reg.keys.get(`HKCU\\${FOLDER_KEY}\\command`)).toBe(`"${EXE}" "%V"`);
    expect(reg.keys.get(`HKCU\\${BACKGROUND_KEY}\\command`)).toBe(`"${EXE}" "%V"`);
    expect(reg.keys.get(`HKCU\\${FOLDER_KEY}`)).toBe('Open as throng project');
  });

  it('removes both verbs when turned off', async () => {
    const reg = fakeRegistry();
    const svc = new WindowsFileManagerRegistration(reg, EXE, true);
    await svc.setEnabled(true);
    expect(await svc.setEnabled(false)).toEqual({ state: 'off' });
    expect([...reg.keys.keys()]).toEqual([]);
  });

  it('turns off cleanly when only one verb is left', async () => {
    const reg = fakeRegistry();
    const deleted: string[] = [];
    const deleteTree = reg.deleteTree;
    reg.deleteTree = async (key) => {
      deleted.push(key);
      await deleteTree(key);
    };
    reg.keys.set(`HKCU\\${FOLDER_KEY}`, 'x');
    expect(await new WindowsFileManagerRegistration(reg, EXE, true).setEnabled(false)).toEqual({ state: 'off' });
    expect(deleted).toEqual([`HKCU\\${FOLDER_KEY}`]);
  });

  it('reports a machine-wide registration and changes nothing', async () => {
    const reg = fakeRegistry(true);
    const svc = new WindowsFileManagerRegistration(reg, EXE, true);
    const status = await svc.setEnabled(false);
    expect(status.state).toBe('machine-wide');
    expect(reg.keys.has(`HKLM\\${FOLDER_KEY}`)).toBe(true);
  });

  it('is unavailable on a portable or archive build, and registers nothing', async () => {
    const reg = fakeRegistry();
    const svc = new WindowsFileManagerRegistration(reg, EXE, false);
    expect((await svc.setEnabled(true)).state).toBe('unavailable');
    expect(reg.keys.size).toBe(0);
  });
});
