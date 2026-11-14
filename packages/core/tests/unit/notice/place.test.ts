import { describe, expect, it } from 'vitest';
import {
  PLACE_SEPARATOR,
  SUBJECT_NAME_MAX,
  addEntry,
  emptyNotificationsDocument,
  formatPlace,
  normalisePlace,
  originOfSubject,
  parseNotificationsDocument,
  placeOfSubject,
  type NoticeSubject,
  type NotificationEntryInput,
} from '@throng/core';

/**
 * 068 US3 T089 (FR-061, FR-063) — where a notice belongs. Layer: unit — pure; the renderer's raise, toast, entry and
 * copy text are `notice-origin.test.ts`'s (component).
 */

describe('formatPlace (FR-061)', () => {
  it('joins project, tab and panel as `Project › Tab › Panel`', () => {
    expect(formatPlace({ project: 'Alpha', tab: 'Build', panel: 'Shell' })).toBe('Alpha › Build › Shell');
    expect(PLACE_SEPARATOR).toBe(' › ');
  });

  it('names a project alone when that is all the notice relates to', () => {
    expect(formatPlace({ project: 'Alpha' })).toBe('Alpha');
  });

  it('drops an absent or blank part rather than leaving a dangling separator', () => {
    expect(formatPlace({ project: 'Alpha', tab: '  ', panel: 'Shell' })).toBe('Alpha › Shell');
    expect(formatPlace({})).toBe('');
    expect(formatPlace(undefined)).toBe('');
  });

  it('keeps every name whole: a long one carries no ellipsis of its own, the surface cuts it to fit (FR-086)', () => {
    const long = 'x'.repeat(SUBJECT_NAME_MAX + 20);
    const parts = formatPlace({ project: long, tab: 'T', panel: 'P' }).split(PLACE_SEPARATOR);
    expect(parts).toEqual([long, 'T', 'P']);
  });
});

describe('placeOfSubject: the names the raiser already stated', () => {
  it.each<[string, NoticeSubject, ReturnType<typeof placeOfSubject>]>([
    ['a panel', { kind: 'panel', name: 'Shell', tab: 'Build', project: 'Alpha' }, { project: 'Alpha', tab: 'Build', panel: 'Shell' }],
    ['a terminal', { kind: 'terminal', flavour: 'Bash', panel: 'Shell', tab: 'Build', project: 'Alpha' }, { project: 'Alpha', tab: 'Build', panel: 'Shell' }],
    ['a tab', { kind: 'tab', name: 'Build', project: 'Alpha' }, { project: 'Alpha', tab: 'Build' }],
    ['a project', { kind: 'project', name: 'Alpha' }, { project: 'Alpha' }],
    ['a panel with no project known', { kind: 'panel', name: 'Shell' }, { panel: 'Shell' }],
  ])('%s', (_name, subject, expected) => {
    expect(placeOfSubject(subject)).toEqual(expected);
  });

  it.each<NoticeSubject>([
    { kind: 'none' },
    { kind: 'file', name: 'a.ts' },
    { kind: 'folder', name: 'src' },
    { kind: 'pane', name: 'Sidebar' },
    { kind: 'panelType', name: 'Editor' },
    { kind: 'subWorkspace', name: 'Detached' },
  ])('a subject that is no place names none: %j', (subject) => {
    expect(placeOfSubject(subject)).toBeUndefined();
  });

  it('normalisePlace is undefined when nothing is left', () => {
    expect(normalisePlace({ project: ' ' })).toBeUndefined();
  });
});

describe('originOfSubject: the ids a panel subject carries', () => {
  it('reads the panel and project off a panel or terminal subject', () => {
    expect(originOfSubject({ kind: 'panel', name: 'Shell', panelId: 'p1', projectId: 'pr1' })).toEqual({ panelId: 'p1', projectId: 'pr1' });
    expect(originOfSubject({ kind: 'terminal', flavour: 'Bash', panelId: 'p2' })).toEqual({ panelId: 'p2' });
  });

  it('is undefined for a subject with no ids, and for one that is no panel', () => {
    expect(originOfSubject({ kind: 'panel', name: 'Shell' })).toBeUndefined();
    expect(originOfSubject({ kind: 'file', name: 'a.ts' })).toBeUndefined();
    expect(originOfSubject({ kind: 'none' })).toBeUndefined();
    expect(originOfSubject(undefined)).toBeUndefined();
  });
});

const input = (over: Partial<NotificationEntryInput> = {}): NotificationEntryInput => ({
  severity: 'error',
  message: 'It failed.',
  details: [],
  copyText: 'It failed.',
  affected: [],
  actions: [],
  ...over,
});
const opts = (id: string) => ({ id, now: 1, limit: 100 });

describe('an entry keeps where its notice was raised (FR-061, FR-063)', () => {
  it('stores the origin and the names as raised', () => {
    const r = addEntry(
      emptyNotificationsDocument(),
      input({ origin: { panelId: 'p1', projectId: 'pr1' }, place: { project: 'Alpha', tab: 'Build', panel: 'Shell' } }),
      opts('e1'),
    );
    expect(r.doc.entries[0]).toMatchObject({ origin: { panelId: 'p1', projectId: 'pr1' }, place: { project: 'Alpha', tab: 'Build', panel: 'Shell' } });
  });

  it('stores none for a notice about the whole app', () => {
    const entry = addEntry(emptyNotificationsDocument(), input(), opts('e1')).doc.entries[0]!;
    expect(entry).not.toHaveProperty('origin');
    expect(entry).not.toHaveProperty('place');
  });

  it('a name changed after the raise leaves the entry as raised, even when the condition is raised again [derived]', () => {
    const first = addEntry(
      emptyNotificationsDocument(),
      input({ groupKey: 'g', origin: { panelId: 'p1' }, place: { project: 'Alpha', tab: 'Build', panel: 'Shell' } }),
      opts('e1'),
    );
    const again = addEntry(
      first.doc,
      input({ groupKey: 'g', origin: { panelId: 'p1' }, place: { project: 'Alpha', tab: 'Build', panel: 'Renamed' } }),
      opts('e2'),
    );
    expect(again.outcome).toBe('repeat');
    expect(again.doc.entries[0]!.place).toEqual({ project: 'Alpha', tab: 'Build', panel: 'Shell' });
  });

  it('survives a JSON round trip, which is what a restart is', () => {
    const doc = addEntry(
      emptyNotificationsDocument(),
      input({ origin: { panelId: 'p1', projectId: 'pr1' }, place: { project: 'Alpha', panel: 'Shell' } }),
      opts('e1'),
    ).doc;
    const restored = parseNotificationsDocument(JSON.parse(JSON.stringify(doc)));
    expect(restored.entries[0]).toMatchObject({ origin: { panelId: 'p1', projectId: 'pr1' }, place: { project: 'Alpha', panel: 'Shell' } });
  });

  it('loads an entry stored before origin existed, with neither', () => {
    const restored = parseNotificationsDocument({
      version: 1,
      entries: [{ id: 'x', key: 'k', severity: 'info', copyText: 'c', raisedAt: 1 }],
    });
    expect(restored.entries[0]).not.toHaveProperty('origin');
    expect(restored.entries[0]).not.toHaveProperty('place');
  });

  it('drops a malformed origin or place on load rather than the entry', () => {
    const restored = parseNotificationsDocument({
      version: 1,
      entries: [{ id: 'x', key: 'k', severity: 'info', copyText: 'c', raisedAt: 1, origin: 'p1', place: [1, 2] }],
    });
    expect(restored.entries).toHaveLength(1);
    expect(restored.entries[0]).not.toHaveProperty('origin');
    expect(restored.entries[0]).not.toHaveProperty('place');
  });
});
