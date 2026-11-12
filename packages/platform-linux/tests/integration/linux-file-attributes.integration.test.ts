// Layer: integration. Mode bits are read from a real file.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LinuxFileAttributes } from '../../src/linux-file-attributes.js';
import { LinuxOsPropertiesDialog } from '../../src/linux-os-properties-dialog.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'throng-attrs-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('LinuxFileAttributes (067 FR-046)', () => {
  it('reports a file with no write bit as read-only', async () => {
    const path = join(dir, 'a');
    writeFileSync(path, 'x');
    expect((await new LinuxFileAttributes().read(path)).readOnly).toBe(false);
    chmodSync(path, 0o444);
    expect((await new LinuxFileAttributes().read(path)).readOnly).toBe(true);
  });
  it('reports a dotfile as hidden', async () => {
    const path = join(dir, '.a');
    writeFileSync(path, 'x');
    expect(await new LinuxFileAttributes().read(path)).toMatchObject({ hidden: true, system: false, archive: false, junction: false });
  });
});

describe('LinuxOsPropertiesDialog (067 FR-053)', () => {
  it('reports itself absent, with nothing to show the user (FR-122)', async () => {
    const dialog = new LinuxOsPropertiesDialog();
    expect(dialog.available).toBe(false);
    expect(dialog.unavailableReason).toBeUndefined();
    expect((await dialog.show('/x')).ok).toBe(false);
  });
});
