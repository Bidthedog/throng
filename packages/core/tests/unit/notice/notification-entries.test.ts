import { describe, expect, it } from 'vitest';
import {
  addEntry,
  applyLimit,
  dismissAllEntries,
  dismissEntry,
  dismissLimitWarning,
  emptyNotificationsDocument,
  entryKey,
  followLimitWarning,
  orderEntries,
  parseNotificationsDocument,
  pendingSummary,
  setOrder,
  type NotificationEntry,
  type NotificationEntryInput,
  type NotificationsDocument,
} from '@throng/core';

/**
 * 068 US3 T034 (data-model "Notification entry"; FR-024 to FR-031g, FR-039b) — the pure transitions
 * behind the Notifications panel. Layer: unit — no I/O; the store in main (T036) only persists them.
 */

const input = (over: Partial<NotificationEntryInput> = {}): NotificationEntryInput => ({
  severity: 'error',
  message: 'It failed.',
  details: [],
  copyText: 'It failed.',
  affected: [],
  actions: [],
  ...over,
});

let n = 0;
const add = (
  doc: NotificationsDocument,
  over: Partial<NotificationEntryInput> = {},
  opts: { limit?: number; now?: number } = {},
) => addEntry(doc, input(over), { id: `id${++n}`, now: opts.now ?? 1000 + n, limit: opts.limit ?? 100 });

describe('entryKey', () => {
  it('uses the group key when there is one', () => {
    expect(entryKey(input({ groupKey: 'g1', message: 'a' }))).toBe(entryKey(input({ groupKey: 'g1', message: 'b' })));
    expect(entryKey(input({ groupKey: 'g1' }))).not.toBe(entryKey(input({ groupKey: 'g2' })));
  });

  it('otherwise joins severity, message, title and subject', () => {
    const base = input({ title: 'T', subject: 'S' });
    expect(entryKey(base)).toBe(entryKey(input({ title: 'T', subject: 'S' })));
    for (const other of [{ severity: 'warning' as const }, { message: 'x' }, { title: 'U' }, { subject: 'Z' }]) {
      expect(entryKey({ ...base, ...other })).not.toBe(entryKey(base));
    }
  });
});

describe('addEntry', () => {
  it('appends a new entry with a count of one, the given id and time', () => {
    const r = add(emptyNotificationsDocument(), {}, { now: 5000 });
    expect(r.outcome).toBe('added');
    expect(r.doc.entries).toHaveLength(1);
    expect(r.doc.entries[0]).toMatchObject({ id: r.id, raisedAt: 5000, repeatCount: 1, severity: 'error' });
    expect(r.doc.entries[0]).not.toHaveProperty('pending');
    expect(r.dropped).toEqual([]);
    expect(r.limitReached).toBe(false);
  });

  it('treats a repeat as outcome repeat: bumps repeatCount, keeps raisedAt and id, adds nothing', () => {
    const first = add(emptyNotificationsDocument(), {}, { now: 100 });
    const again = add(first.doc, {}, { now: 900 });
    expect(again.outcome).toBe('repeat');
    expect(again.id).toBe(first.id);
    expect(again.doc.entries).toHaveLength(1);
    expect(again.doc.entries[0]).toMatchObject({ repeatCount: 2, raisedAt: 100 });
  });

  it('trims the oldest past the limit and returns what it dropped', () => {
    let doc = emptyNotificationsDocument();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const r = add(doc, { message: `m${i}` }, { limit: 3 });
      doc = r.doc;
      ids.push(r.id);
      if (i === 3) {
        expect(r.dropped.map((e) => e.id)).toEqual([ids[0]]);
      }
    }
    expect(doc.entries.map((e) => e.message)).toEqual(['m1', 'm2', 'm3']);
  });

  it('reports limitReached ONCE, when the count reaches the limit, and sets limitWarningShown', () => {
    let doc = emptyNotificationsDocument();
    const reached: boolean[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = add(doc, { message: `m${i}` }, { limit: 3 });
      doc = r.doc;
      reached.push(r.limitReached);
    }
    expect(reached).toEqual([false, false, true, false, false]);
    expect(doc.limitWarningShown).toBe(true);
  });

  it('never reports limitReached once the warning has been dismissed for good (FR-031g)', () => {
    let doc = dismissLimitWarning(emptyNotificationsDocument());
    for (let i = 0; i < 4; i += 1) {
      const r = add(doc, { message: `m${i}` }, { limit: 3 });
      doc = r.doc;
      expect(r.limitReached).toBe(false);
    }
  });

  it('re-arms the warning when the count falls below the limit again (not dismissed)', () => {
    let doc = emptyNotificationsDocument();
    for (let i = 0; i < 3; i += 1) doc = add(doc, { message: `m${i}` }, { limit: 3 }).doc;
    expect(doc.limitWarningShown).toBe(true);
    doc = dismissEntry(doc, doc.entries[0]!.id, 3);
    expect(doc.limitWarningShown).toBe(false);
    expect(add(doc, { message: 'again' }, { limit: 3 }).limitReached).toBe(true);
  });
});

describe('applyLimit', () => {
  const full = (): NotificationsDocument => {
    let doc = emptyNotificationsDocument();
    for (let i = 0; i < 6; i += 1) doc = add(doc, { message: `m${i}` }).doc;
    return doc;
  };

  it('drops the oldest down to the new limit and returns them', () => {
    const r = applyLimit(full(), 4);
    expect(r.doc.entries.map((e) => e.message)).toEqual(['m2', 'm3', 'm4', 'm5']);
    expect(r.dropped.map((e) => e.message)).toEqual(['m0', 'm1']);
  });

  it('is a no-op inside the limit', () => {
    const doc = full();
    expect(applyLimit(doc, 100)).toEqual({ doc, dropped: [] });
  });
});

describe('the other transitions', () => {
  const two = (): NotificationsDocument => {
    let doc = add(emptyNotificationsDocument(), { message: 'a' }).doc;
    doc = add(doc, { message: 'b', severity: 'info' }).doc;
    return doc;
  };

  it('dismissEntry removes one entry, and an unknown id changes nothing', () => {
    const doc = two();
    expect(dismissEntry(doc, doc.entries[0]!.id, 100).entries.map((e) => e.message)).toEqual(['b']);
    expect(dismissEntry(doc, 'nope', 100)).toEqual(doc);
  });

  it('dismissAllEntries empties the list but keeps the order and the warning flags', () => {
    const doc = setOrder(two(), 'newest');
    const cleared = dismissAllEntries(doc);
    expect(cleared.entries).toEqual([]);
    expect(cleared.order).toBe('newest');
  });

  it('setOrder only accepts a known order', () => {
    expect(setOrder(two(), 'priority-newest').order).toBe('priority-newest');
    expect(setOrder(two(), 'sideways' as never).order).toBe('oldest');
  });
});

describe('orderEntries (FR-028)', () => {
  const entry = (id: string, severity: NotificationEntry['severity'], raisedAt: number): NotificationEntry => ({
    id,
    key: id,
    severity,
    message: id,
    details: [],
    copyText: id,
    affected: [],
    actions: [],
    raisedAt,
    repeatCount: 1,
  });
  const list = [
    entry('s1', 'success', 1),
    entry('e1', 'error', 2),
    entry('i1', 'info', 3),
    entry('a1', 'attention', 4),
    entry('w1', 'warning', 5),
    entry('e2', 'error', 6),
  ];
  const ids = (order: Parameters<typeof orderEntries>[1]) => orderEntries(list, order).map((e) => e.id);

  it('oldest puts the earliest raise first, newest the latest', () => {
    expect(ids('oldest')).toEqual(['s1', 'e1', 'i1', 'a1', 'w1', 'e2']);
    expect(ids('newest')).toEqual(['e2', 'w1', 'a1', 'i1', 'e1', 's1']);
  });

  it('priority-oldest ranks error, warning, attention, info, success, then oldest first within a rank', () => {
    expect(ids('priority-oldest')).toEqual(['e1', 'e2', 'w1', 'a1', 'i1', 's1']);
  });

  it('priority-newest ranks the same, newest first within a rank', () => {
    expect(ids('priority-newest')).toEqual(['e2', 'e1', 'w1', 'a1', 'i1', 's1']);
  });

  it('never mutates its input', () => {
    const copy = [...list];
    orderEntries(list, 'newest');
    expect(list).toEqual(copy);
  });
});

describe('pendingSummary (FR-059)', () => {
  it('counts every entry and names the most severe, whatever the panel is showing', () => {
    let doc = add(emptyNotificationsDocument(), { message: 'a', severity: 'info' }).doc;
    doc = add(doc, { message: 'b', severity: 'warning' }).doc;
    doc = add(doc, { message: 'c', severity: 'error' }).doc;
    expect(pendingSummary(doc.entries)).toEqual({ count: 3, severity: 'error' });
  });

  it('ignores a stored pending flag: an entry stored as not pending still counts', () => {
    const doc = parseNotificationsDocument({
      version: 1,
      entries: [{ id: 'x', key: 'k', severity: 'info', copyText: 'c', raisedAt: 1, pending: false }],
    });
    expect(pendingSummary(doc.entries)).toEqual({ count: 1, severity: 'info' });
    expect(doc.entries[0]).not.toHaveProperty('pending');
  });

  it('follows the most severe left when one is dismissed, and drops to zero when all are', () => {
    let doc = add(emptyNotificationsDocument(), { message: 'a', severity: 'info' }).doc;
    const w = add(doc, { message: 'b', severity: 'warning' });
    doc = dismissEntry(w.doc, w.id, 100);
    expect(pendingSummary(doc.entries)).toEqual({ count: 1, severity: 'info' });
    expect(pendingSummary(dismissAllEntries(w.doc).entries)).toEqual({ count: 0, severity: null });
  });

  it('is zero with no severity when there are no entries', () => {
    expect(pendingSummary([])).toEqual({ count: 0, severity: null });
  });
});

describe('parseNotificationsDocument is total', () => {
  it.each([[undefined], [null], ['x'], [3], [[]], [{}], [{ version: 2, entries: [{}] }], [{ version: 1, entries: 'no' }]])(
    'gives an empty version-1 document for %p',
    (raw) => {
      expect(parseNotificationsDocument(raw)).toEqual(emptyNotificationsDocument());
    },
  );

  it('keeps a well-formed document and drops malformed entries individually', () => {
    const doc = add(emptyNotificationsDocument(), { message: 'keep' }).doc;
    const raw = { ...doc, order: 'newest', entries: [...doc.entries, { id: 5 }, null, 'x'] };
    const parsed = parseNotificationsDocument(JSON.parse(JSON.stringify(raw)));
    expect(parsed.order).toBe('newest');
    expect(parsed.entries.map((e) => e.message)).toEqual(['keep']);
  });

  it('falls back to oldest for an unknown order', () => {
    expect(parseNotificationsDocument({ version: 1, order: 'sideways', entries: [] }).order).toBe('oldest');
  });

  it('survives a round trip through JSON', () => {
    let doc = add(emptyNotificationsDocument(), { message: 'a', actions: [{ kind: 'goToPanel', panelId: 'p', label: 'Go' }] }).doc;
    doc = dismissLimitWarning(doc);
    expect(parseNotificationsDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
});

describe('a repeat of a grown condition updates the entry in place (FR-029, 030 FR-037)', () => {
  const grouped = (affected: { panelId?: string; label: string }[], extra: Partial<NotificationEntryInput> = {}): NotificationEntryInput => ({
    groupKey: 'cause:folder-missing',
    severity: 'error',
    message: 'A folder is missing.',
    details: [],
    copyText: 'A folder is missing.\nAffected: ' + affected.map((a) => a.label).join(', '),
    affected,
    actions: [],
    ...extra,
  });
  const opts = (id: string) => ({ id, now: 1, limit: 100 });

  it('adds the new casualty to the stored entry and to its copy text, keeping one entry, its id and the repeat count', () => {
    const first = addEntry(emptyNotificationsDocument(), grouped([{ panelId: 'a', label: 'Term A' }]), opts('e1'));
    const second = addEntry(first.doc, grouped([{ panelId: 'b', label: 'Term B' }]), opts('e2'));
    expect(second.outcome).toBe('repeat');
    expect(second.doc.entries).toHaveLength(1);
    const entry = second.doc.entries[0]!;
    expect(entry.id).toBe('e1');
    expect(entry.repeatCount).toBe(2);
    expect(entry.affected.map((a) => a.label)).toEqual(['Term A', 'Term B']);
    expect(entry.copyText).toContain('Term A');
    expect(entry.copyText).toContain('Term B');
  });

  it('a casualty already listed adds nothing, so the entry does not grow', () => {
    const first = addEntry(emptyNotificationsDocument(), grouped([{ panelId: 'a', label: 'Term A' }]), opts('e1'));
    const second = addEntry(first.doc, grouped([{ panelId: 'a', label: 'Term A' }]), opts('e2'));
    const entry = second.doc.entries[0]!;
    expect(entry.affected).toHaveLength(1);
    expect(entry.copyText.match(/Term A/g)).toHaveLength(1);
  });

  it('merges new details without repeating one it already holds', () => {
    const first = addEntry(emptyNotificationsDocument(), grouped([{ label: 'x' }], { details: ['d1'] }), opts('e1'));
    const second = addEntry(first.doc, grouped([{ label: 'y' }], { details: ['d1', 'd2'] }), opts('e2'));
    expect(second.doc.entries[0]!.details).toEqual(['d1', 'd2']);
  });
});

describe('the content key is the toast duplicate rule (B11, 043 T237)', () => {
  const base: NotificationEntryInput = {
    severity: 'success',
    message: 'Replaced 2 matches in 2 files.',
    details: ['a.ts', 'b.ts'],
    copyText: 'x',
    affected: [],
    actions: [],
  };
  const opts = (id: string) => ({ id, now: 1, limit: 100 });

  it('keeps two summaries with equal headlines but different file lists as two entries', () => {
    const first = addEntry(emptyNotificationsDocument(), base, opts('e1'));
    const second = addEntry(first.doc, { ...base, details: ['c.ts', 'd.ts'] }, opts('e2'));
    expect(second.outcome).toBe('added');
    expect(second.doc.entries).toHaveLength(2);
  });

  it('still folds the same list raised again', () => {
    const first = addEntry(emptyNotificationsDocument(), base, opts('e1'));
    expect(addEntry(first.doc, { ...base }, opts('e2')).outcome).toBe('repeat');
  });

  it.each([
    ['action', { action: 'Replacing in files' }],
    ['testId', { testId: 'other-surface' }],
    ['instanceKey', { instanceKey: 'second' }],
  ] as const)('tells apart notices that differ only in %s', (_name, change) => {
    const first = addEntry(emptyNotificationsDocument(), base, opts('e1'));
    expect(addEntry(first.doc, { ...base, ...change }, opts('e2')).outcome).toBe('added');
  });
});

describe('following the limit warning link (B12)', () => {
  it('re-arms the warning without making it permanent', () => {
    let doc = emptyNotificationsDocument();
    doc = { ...doc, limitWarningShown: true };
    const followed = followLimitWarning(doc);
    expect(followed.limitWarningShown).toBe(false);
    expect(followed.limitWarningDismissed).toBe(false);
  });
});
