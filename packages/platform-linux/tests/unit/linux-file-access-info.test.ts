import { describe, expect, it } from 'vitest';
import { LinuxFileAccessInfo } from '../../src/linux-file-access-info.js';

const passwd = 'root:x:0:0:root:/root:/bin/bash\nspikeh:x:1000:1000::/home/spikeh:/bin/bash\n';
const group = 'root:x:0:\nusers:x:100:spikeh\n';
const info = new LinuxFileAccessInfo(async (file) => (file === '/etc/passwd' ? passwd : group));

describe('LinuxFileAccessInfo (067 FR-121)', () => {
  it('names the owner and group, with the permissions', async () => {
    expect(await info.read({ uid: 1000, gid: 100, mode: 0o100640 })).toEqual({
      owner: 'spikeh',
      group: 'users',
      modeSymbolic: 'rw-r-----',
      modeOctal: '0640',
    });
  });
  it('falls back to the number for an id with no name', async () => {
    expect(await info.read({ uid: 4242, gid: 77, mode: 0o100600 })).toMatchObject({ owner: '4242', group: '77' });
  });
  it('still answers when the name files cannot be read', async () => {
    const none = new LinuxFileAccessInfo(() => Promise.reject(new Error('EACCES')));
    expect(await none.read({ uid: 1000, gid: 100, mode: 0o100644 })).toMatchObject({ owner: '1000', group: '100', modeOctal: '0644' });
  });
});
