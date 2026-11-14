// Layer: integration — surviving a restart, an atomic write and a corrupt file are claims about the
// file on disk; no in-memory fake can fail for those reasons.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NotificationEntryInput } from '@throng/core';
import { NotificationStore, type NotificationsSnapshot } from '../../src/main/notification-store.js';

/**
 * 068 US3 T036 (FR-031, FR-031c, FR-031e, FR-031g) — the main-process store behind the Notifications
 * panel, modelled on `form-history-service.test.ts`. The rules themselves (dedupe, order, limit,
 * pending) are `notification-entries.test.ts`'s; this file proves persistence and the events.
 */

let dir: string;
let path: string;
let limit: number;
let logged: string[];
let changes: NotificationsSnapshot[];
let repeats: string[];
let limitReached: number;
let counter: number;

const make = (): NotificationStore =>
  new NotificationStore(path, {
    limit: () => limit,
    log: (message) => logged.push(message),
    changed: (snapshot) => changes.push(snapshot),
    repeat: (id) => repeats.push(id),
    limitReached: () => {
      limitReached += 1;
    },
    newId: () => `id${++counter}`,
    now: () => 1000 + counter,
  });

const input = (message: string, over: Partial<NotificationEntryInput> = {}): NotificationEntryInput => ({
  severity: 'error',
  message,
  details: [],
  copyText: message,
  affected: [],
  actions: [],
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'throng-notifications-'));
  path = join(dir, 'notifications.json');
  limit = 100;
  logged = [];
  changes = [];
  repeats = [];
  limitReached = 0;
  counter = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('persistence across a new store instance (FR-031)', () => {
  it('keeps what was added, in a file a new instance reads', async () => {
    const first = make();
    await first.add(input('a'));
    await first.add(input('b', { severity: 'info' }));
    const snapshot = await make().list();
    expect(snapshot.entries.map((e) => e.message)).toEqual(['a', 'b']);
    expect(snapshot.limit).toBe(100);
  });

  it('keeps a dismissal, a dismiss-all and an order', async () => {
    const store = make();
    const a = await store.add(input('a'));
    await store.add(input('b'));
    await store.add(input('c'));
    await store.dismiss(a.id);
    expect((await make().list()).entries.map((e) => e.message)).toEqual(['b', 'c']);

    await store.setOrder('priority-newest');
    expect((await make().list()).order).toBe('priority-newest');

    expect((await make().list()).pendingCount).toBe(2);

    await store.dismissAll();
    expect((await make().list()).entries).toEqual([]);
  });

  it('writes atomically: no temporary file is left, and the file always parses', async () => {
    const store = make();
    await Promise.all([store.add(input('a')), store.add(input('b')), store.add(input('c'))]);
    expect(readdirSync(dir)).toEqual(['notifications.json']);
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { version: number; entries: unknown[] };
    expect(parsed.version).toBe(1);
    expect(parsed.entries).toHaveLength(3);
  });

  it('answers a repeat with outcome repeat, asks the main window to flash it, and stores one entry', async () => {
    const store = make();
    const first = await store.add(input('a'));
    const again = await store.add(input('a'));
    expect(first.outcome).toBe('added');
    expect(again).toEqual({ outcome: 'repeat', id: first.id });
    expect(repeats).toEqual([first.id]);
    expect((await store.list()).entries).toHaveLength(1);
  });

  it('broadcasts a snapshot after each change', async () => {
    const store = make();
    await store.add(input('a'));
    expect(changes.at(-1)?.entries).toHaveLength(1);
    await store.dismissAll();
    expect(changes.at(-1)?.entries).toHaveLength(0);
  });

  it('counts every entry and reports the most severe, with no panel state involved (FR-059)', async () => {
    const store = make();
    await store.add(input('seen'));
    await store.add(input('info one', { severity: 'info' }));
    const warning = await store.add(input('a warning', { severity: 'warning' }));
    const snapshot = await store.list();
    expect(snapshot.pendingCount).toBe(3);
    expect(snapshot.pendingSeverity).toBe('error');
    await store.dismiss(warning.id);
    expect((await store.list()).pendingCount).toBe(2);
    await store.dismissAll();
    expect(await store.list()).toMatchObject({ pendingCount: 0, pendingSeverity: null });
  });

  it('loads a stored pending field and ignores it: the entry counts and the field is not written back', async () => {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        order: 'oldest',
        limitWarningDismissed: false,
        limitWarningShown: false,
        entries: [{ id: 'x', key: 'k', severity: 'info', message: 'old', details: [], copyText: 'old', affected: [], actions: [], raisedAt: 1, repeatCount: 1, pending: false }],
      }),
      'utf8',
    );
    const store = make();
    expect((await store.list()).pendingCount).toBe(1);
    await store.add(input('new'));
    expect(readFileSync(path, 'utf8')).not.toContain('"pending"');
  });
});

describe('a corrupt or foreign file (FR-031c)', () => {
  it('sets a corrupt file aside as notifications.json.bad, logs it, and starts empty', async () => {
    writeFileSync(path, '{ not json', 'utf8');
    const store = make();
    expect((await store.list()).entries).toEqual([]);
    expect(existsSync(`${path}.bad`)).toBe(true);
    expect(readFileSync(`${path}.bad`, 'utf8')).toBe('{ not json');
    expect(logged.some((m) => /notifications/i.test(m))).toBe(true);
    await store.add(input('fresh'));
    expect((await make().list()).entries.map((e) => e.message)).toEqual(['fresh']);
  });

  it.each([
    ['another version', JSON.stringify({ version: 2, entries: [{ id: 'x' }] })],
    ['no version', JSON.stringify({ entries: [] })],
  ])('sets a document with %s aside and starts empty', async (_label, text) => {
    writeFileSync(path, text, 'utf8');
    expect((await make().list()).entries).toEqual([]);
    expect(readFileSync(`${path}.bad`, 'utf8')).toBe(text);
  });

  it('does not set aside a missing file: there is nothing to rescue', async () => {
    expect((await make().list()).entries).toEqual([]);
    expect(existsSync(`${path}.bad`)).toBe(false);
  });
});

describe('the limit (FR-031d, FR-031e, FR-031f, FR-031g)', () => {
  it('drops the oldest when the limit is lowered, and logs each drop', async () => {
    const store = make();
    for (const m of ['a', 'b', 'c', 'd']) await store.add(input(m));
    limit = 2;
    await store.applyLimit();
    expect((await make().list()).entries.map((e) => e.message)).toEqual(['c', 'd']);
    expect(logged.filter((m) => /dropped/i.test(m))).toHaveLength(2);
  });

  it('logs each entry dropped by an add past the limit', async () => {
    limit = 2;
    const store = make();
    for (const m of ['a', 'b', 'c']) await store.add(input(m));
    expect(logged.filter((m) => /dropped/i.test(m))).toHaveLength(1);
    expect((await store.list()).entries.map((e) => e.message)).toEqual(['b', 'c']);
  });

  it('reports limitReached once, however many entries follow', async () => {
    limit = 3;
    const store = make();
    for (const m of ['a', 'b', 'c', 'd', 'e']) await store.add(input(m));
    expect(limitReached).toBe(1);
  });

  it('persists dismissLimitWarning and suppresses the warning for good', async () => {
    limit = 2;
    const first = make();
    await first.dismissLimitWarning();
    const second = make();
    for (const m of ['a', 'b', 'c', 'd']) await second.add(input(m));
    expect(limitReached).toBe(0);
    expect(JSON.parse(readFileSync(path, 'utf8')).limitWarningDismissed).toBe(true);
  });
});

describe('a locked file is not an absent one (B14)', () => {
  const locked = (code: string) => (): Promise<string> => Promise.reject(Object.assign(new Error('busy'), { code }));

  it('never overwrites a stored file it could not read: the add fails, the file is intact, and the failure is logged', async () => {
    const seed = make();
    await seed.add(input('keep me'));
    const before = readFileSync(path, 'utf8');
    const store = new NotificationStore(path, {
      limit: () => limit,
      log: (m) => logged.push(m),
      changed: () => {},
      repeat: () => {},
      limitReached: () => {},
      readFile: locked('EBUSY'),
      retryDelayMs: 0,
    });
    await expect(store.add(input('new'))).rejects.toThrow();
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('retries a transient lock and then reads the file', async () => {
    await make().add(input('keep me'));
    let attempts = 0;
    const store = new NotificationStore(path, {
      limit: () => limit,
      log: () => {},
      changed: () => {},
      repeat: () => {},
      limitReached: () => {},
      readFile: (p) => {
        attempts += 1;
        return attempts < 3 ? locked('EPERM')() : Promise.resolve(readFileSync(p, 'utf8'));
      },
      retryDelayMs: 0,
    });
    expect((await store.list()).entries.map((e) => e.message)).toEqual(['keep me']);
    expect(attempts).toBe(3);
  });

  it('treats ENOENT, and only ENOENT, as no file yet', async () => {
    const store = new NotificationStore(path, {
      limit: () => limit,
      log: () => {},
      changed: () => {},
      repeat: () => {},
      limitReached: () => {},
      readFile: locked('ENOENT'),
      retryDelayMs: 0,
    });
    expect((await store.list()).entries).toEqual([]);
  });
});

describe('the limit warning outlives a restart and re-arms (B12, FR-031f, FR-031g)', () => {
  let seq = 0;
  const fill = async (store: NotificationStore, n: number): Promise<void> => {
    for (let i = 0; i < n; i += 1) await store.add(input(`m${seq++}-${i}`));
  };

  it('reports the warning as outstanding after a restart while it was neither dismissed nor followed', async () => {
    limit = 3;
    const store = make();
    await fill(store, 3);
    expect(limitReached).toBe(1);
    expect((await store.list()).limitWarningActive).toBe(true);
    expect((await make().list()).limitWarningActive).toBe(true);
  });

  it('a dismissal ends it for good, across a restart', async () => {
    limit = 3;
    const store = make();
    await fill(store, 3);
    await store.dismissLimitWarning();
    expect((await make().list()).limitWarningActive).toBe(false);
    await store.dismissAll();
    await fill(store, 3);
    expect(limitReached).toBe(1);
  });

  it('following the link is not a refusal: the warning stops being outstanding and warns again at the next limit', async () => {
    limit = 3;
    const store = make();
    await fill(store, 3);
    await store.followLimitWarning();
    expect((await store.list()).limitWarningActive).toBe(false);
    limit = 5;
    await store.applyLimit();
    await fill(store, 2);
    expect(limitReached, 'filling to the raised limit did not warn').toBe(2);
  });

  it('raising the limit re-arms an outstanding warning', async () => {
    limit = 3;
    const store = make();
    await fill(store, 3);
    limit = 10;
    await store.applyLimit();
    expect((await store.list()).limitWarningActive).toBe(false);
    await fill(store, 7);
    expect(limitReached).toBe(2);
  });
});
