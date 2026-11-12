import { describe, expect, it } from 'vitest';
import { WindowsFileAttributes } from '../../src/windows-file-attributes.js';

const FLAGS = { readOnly: 0x1, hidden: 0x2, system: 0x4, archive: 0x20, reparse: 0x400 };
const MOUNT_POINT = 0xa0000003;
const SYMLINK = 0xa000000c;

const read = (attributes: number, reparseTag = 0) =>
  new WindowsFileAttributes(async () => ({ attributes, reparseTag })).read('C:\\x');

describe('WindowsFileAttributes (067 FR-046)', () => {
  it('maps each flag on its own', async () => {
    expect(await read(FLAGS.readOnly)).toMatchObject({ readOnly: true, hidden: false, system: false, archive: false });
    expect(await read(FLAGS.hidden)).toMatchObject({ readOnly: false, hidden: true, system: false, archive: false });
    expect(await read(FLAGS.system)).toMatchObject({ readOnly: false, hidden: false, system: true, archive: false });
    expect(await read(FLAGS.archive)).toMatchObject({ readOnly: false, hidden: false, system: false, archive: true });
  });
  it('tells a junction from a symbolic link', async () => {
    expect((await read(FLAGS.reparse, MOUNT_POINT)).junction).toBe(true);
    expect((await read(FLAGS.reparse, SYMLINK)).junction).toBe(false);
    expect((await read(FLAGS.archive, MOUNT_POINT)).junction).toBe(false);
  });
  it('answers no attributes when the OS cannot say', async () => {
    const attributes = new WindowsFileAttributes(async () => null);
    expect(await attributes.read('C:\\gone')).toEqual({ readOnly: false, hidden: false, system: false, archive: false, junction: false });
  });
});
