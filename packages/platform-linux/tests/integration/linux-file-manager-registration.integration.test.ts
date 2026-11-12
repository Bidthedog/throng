// Layer: integration. What each override file contains and where it lands is only checkable on a real folder.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LinuxFileManagerRegistration } from '../../src/linux-file-manager-registration.js';

let home: string;
const nemo = (): string => join(home, '.local/share/nemo/actions/throng-open-project.nemo_action');
const kde = (): string => join(home, '.local/share/kio/servicemenus/throng-open-project-kde.desktop');
const gnome = (): string => join(home, '.local/share/applications/throng-open-project.desktop');

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'throng-fm-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('LinuxFileManagerRegistration (067 FR-033, FR-034)', () => {
  it('is on after install, with nothing written', async () => {
    expect(await new LinuxFileManagerRegistration(home, true).status()).toEqual({ state: 'on' });
    expect(existsSync(nemo())).toBe(false);
  });

  it('writes the three per-user overrides when turned off', async () => {
    const svc = new LinuxFileManagerRegistration(home, true);
    expect(await svc.setEnabled(false)).toEqual({ state: 'off' });
    expect(readFileSync(nemo(), 'utf8')).toContain('Active=false');
    expect(readFileSync(kde(), 'utf8')).toContain('Hidden=true');
    expect(readFileSync(gnome(), 'utf8')).toContain('Hidden=true');
    expect(await svc.status()).toEqual({ state: 'off' });
  });

  it('removes the overrides when turned back on', async () => {
    const svc = new LinuxFileManagerRegistration(home, true);
    await svc.setEnabled(false);
    expect(await svc.setEnabled(true)).toEqual({ state: 'on' });
    expect(existsSync(nemo())).toBe(false);
    expect(existsSync(kde())).toBe(false);
    expect(existsSync(gnome())).toBe(false);
  });

  it('is unavailable on an archive build, and writes nothing', async () => {
    const svc = new LinuxFileManagerRegistration(home, false);
    expect((await svc.setEnabled(false)).state).toBe('unavailable');
    expect(existsSync(nemo())).toBe(false);
  });
});
