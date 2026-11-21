import { describe, expect, it } from 'vitest';
import {
  CALLOUT_ROLES,
  CALLOUT_TYPES,
  ICON_KEYS,
  calloutTitle,
  isCalloutTypeId,
  resolveCalloutType,
} from '../../src/index.js';

/**
 * 075 FR-018 – FR-019a: throng's own callout type registry. The registry, not the parser, resolves an
 * alias, and adding a type is one entry plus its icon art.
 */
describe('callout type registry (075 FR-018, FR-019, FR-019a)', () => {
  it('ships exactly the thirteen types of FR-019, with their aliases and roles', () => {
    const table = CALLOUT_TYPES.map((t) => [t.id, [...t.aliases].sort().join(','), t.role]);
    expect(table).toEqual([
      ['note', '', 'neutral'],
      ['abstract', 'summary,tldr', 'info'],
      ['info', '', 'info'],
      ['todo', '', 'info'],
      ['tip', 'hint,important', 'accent'],
      ['success', 'check,done', 'success'],
      ['question', 'faq,help', 'question'],
      ['warning', 'attention,caution,warn', 'warning'],
      ['failure', 'fail,missing', 'danger'],
      ['danger', 'error', 'danger'],
      ['bug', '', 'danger'],
      ['example', '', 'accent'],
      ['quote', 'cite', 'neutral'],
    ]);
  });

  it('gives every entry an icon key that exists, its own, and a role among the seven', () => {
    const icons = new Set<string>(ICON_KEYS);
    for (const entry of CALLOUT_TYPES) {
      expect(icons.has(entry.icon), `${entry.id} → ${entry.icon}`).toBe(true);
      expect(CALLOUT_ROLES).toContain(entry.role);
    }
    expect(new Set(CALLOUT_TYPES.map((t) => t.icon)).size).toBe(CALLOUT_TYPES.length);
    expect(CALLOUT_ROLES).toEqual(['neutral', 'info', 'accent', 'success', 'question', 'warning', 'danger']);
  });

  it('shares no id or alias between entries, and every name is lower case', () => {
    const names = CALLOUT_TYPES.flatMap((t) => [t.id, ...t.aliases]);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toBe(name.toLowerCase());
  });

  it('resolves ids and aliases case-insensitively to the canonical type', () => {
    for (const written of ['NOTE', 'Note', 'note']) expect(resolveCalloutType(written)).toEqual({ id: 'note', known: true });
    expect(resolveCalloutType('check').id).toBe('success');
    expect(resolveCalloutType('TLDR').id).toBe('abstract');
    expect(resolveCalloutType('Caution').id).toBe('warning');
    expect(resolveCalloutType('error').id).toBe('danger');
  });

  it('renders an unknown type as note, marked unknown', () => {
    expect(resolveCalloutType('banana')).toEqual({ id: 'note', known: false });
    expect(resolveCalloutType('<img src=x onerror=alert(1)>')).toEqual({ id: 'note', known: false });
    expect(resolveCalloutType('')).toEqual({ id: 'note', known: false });
    expect(resolveCalloutType('constructor')).toEqual({ id: 'note', known: false });
  });

  it('recognises only canonical ids as type ids', () => {
    expect(isCalloutTypeId('warning')).toBe(true);
    expect(isCalloutTypeId('caution')).toBe(false);
    expect(isCalloutTypeId('constructor')).toBe(false);
  });
});

describe('callout title (075 FR-002)', () => {
  it('uses the written title when there is one', () => {
    expect(calloutTitle('info', 'Clarification')).toBe('Clarification');
    expect(calloutTitle('banana', 'Ripe')).toBe('Ripe');
  });

  it('uses the canonical entry\'s default title when the marker names the canonical id', () => {
    expect(calloutTitle('warning', '')).toBe('Warning');
    expect(calloutTitle('NOTE', undefined)).toBe('Note');
  });

  it('otherwise uses the type as written, in title case', () => {
    expect(calloutTitle('tldr', '')).toBe('Tldr');
    expect(calloutTitle('check', '  ')).toBe('Check');
    expect(calloutTitle('banana split', '')).toBe('Banana Split');
  });
});
