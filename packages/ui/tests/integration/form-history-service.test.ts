// Layer: integration. Surviving a restart is a claim about the file on disk.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FormHistoryService } from '../../src/main/form-history-service.js';

let dir: string;
let path: string;
let settings: { enabled: boolean; maxEntries: number };
const make = (): FormHistoryService => new FormHistoryService(path, () => settings);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'throng-form-history-'));
  path = join(dir, 'terminal-form-history.json');
  settings = { enabled: true, maxEntries: 10 };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('FormHistoryService announces a change (067 FR-064b, FR-066, T136)', () => {
  it('names the terminal type for a field or type clear, and none for clear-all or a trim', async () => {
    const changes: { flavourId?: string }[] = [];
    const service = new FormHistoryService(path, () => settings, (change) => changes.push(change));
    await service.record('bash', { startupCommand: 'a', shellArguments: 'b' });
    expect(changes).toEqual([]);
    await service.clearField('bash', 'startupCommand');
    await service.clearFlavour('bash');
    await service.clearAll();
    settings = { enabled: true, maxEntries: 1 };
    await service.applyLimit();
    expect(changes).toEqual([{ flavourId: 'bash' }, { flavourId: 'bash' }, {}, {}]);
  });
});

describe('FormHistoryService forgets one value (067 FR-133, T142)', () => {
  it('removes that value from that field of that type alone, durably, and announces it', async () => {
    const changes: { flavourId?: string }[] = [];
    const service = new FormHistoryService(path, () => settings, (change) => changes.push(change));
    for (const v of ['one', 'two', 'three']) await service.record('bash', { startupCommand: v, shellArguments: v });
    await service.record('zsh', { startupCommand: 'two' });
    await service.removeValue('bash', 'startupCommand', 'two');
    expect(changes).toEqual([{ flavourId: 'bash' }]);
    expect(await make().get('bash')).toEqual({ startupCommand: ['three', 'one'], shellArguments: ['three', 'two', 'one'] });
    expect((await make().get('zsh')).startupCommand).toEqual(['two']);
  });

  it('changes nothing for a value or type it does not hold', async () => {
    const service = make();
    await service.record('bash', { startupCommand: 'one' });
    await service.removeValue('bash', 'startupCommand', 'absent');
    await service.removeValue('fish', 'shellArguments', 'one');
    expect((await make().get('bash')).startupCommand).toEqual(['one']);
  });
});

describe('FormHistoryService (067 FR-064a, FR-064b, FR-065, FR-066, FR-068)', () => {
  it('survives a restart', async () => {
    await make().record('bash', { startupCommand: 'npm test', shellArguments: '-l' });
    expect(await make().get('bash')).toEqual({ startupCommand: ['npm test'], shellArguments: ['-l'] });
  });

  it('keeps each terminal type separate', async () => {
    const service = make();
    await service.record('bash', { startupCommand: 'a' });
    await service.record('zsh', { startupCommand: 'b' });
    expect((await service.get('bash')).startupCommand).toEqual(['a']);
    expect((await service.get('zsh')).startupCommand).toEqual(['b']);
  });

  it('clears one field, one terminal type, and everything', async () => {
    const service = make();
    await service.record('bash', { startupCommand: 'a', shellArguments: 'b' });
    await service.record('zsh', { startupCommand: 'c' });
    await service.clearField('bash', 'startupCommand');
    expect(await service.get('bash')).toEqual({ startupCommand: [], shellArguments: ['b'] });
    await service.clearFlavour('bash');
    expect(await service.get('bash')).toEqual({ startupCommand: [], shellArguments: [] });
    expect((await service.get('zsh')).startupCommand).toEqual(['c']);
    await service.clearAll();
    expect(await make().get('zsh')).toEqual({ startupCommand: [], shellArguments: [] });
  });

  it('records and offers nothing while off, and keeps what is stored', async () => {
    await make().record('bash', { startupCommand: 'kept' });
    settings = { enabled: false, maxEntries: 10 };
    const off = make();
    await off.record('bash', { startupCommand: 'ignored' });
    expect(await off.get('bash')).toEqual({ startupCommand: [], shellArguments: [] });
    settings = { enabled: true, maxEntries: 10 };
    expect((await make().get('bash')).startupCommand).toEqual(['kept']);
  });

  it('clears while off', async () => {
    await make().record('bash', { startupCommand: 'a' });
    settings = { enabled: false, maxEntries: 10 };
    await make().clearAll();
    settings = { enabled: true, maxEntries: 10 };
    expect((await make().get('bash')).startupCommand).toEqual([]);
  });

  it('trims the file when the limit is lowered', async () => {
    const service = make();
    await service.record('bash', { startupCommand: 'a' });
    await service.record('bash', { startupCommand: 'b' });
    settings = { enabled: true, maxEntries: 1 };
    await service.applyLimit();
    settings = { enabled: true, maxEntries: 10 };
    expect((await make().get('bash')).startupCommand).toEqual(['b']);
  });

  it('starts empty from a damaged file', async () => {
    writeFileSync(path, '{ not json');
    expect(await make().get('bash')).toEqual({ startupCommand: [], shellArguments: [] });
  });
});
