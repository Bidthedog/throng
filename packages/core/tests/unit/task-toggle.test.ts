/**
 * 054 T014 — `locateTaskToggle` finds the one marker a preview checkbox click toggles (FR-022, FR-023,
 * FR-027, FR-029; contracts/preview-ipc-054.md).
 */
import { describe, expect, it } from 'vitest';
import { applyTaskToggle, locateTaskToggle, taskItemText } from '../../src/preview/task-toggle.js';

const toggled = (text: string, line: number, expectChecked: boolean, itemText: string): string => {
  const located = locateTaskToggle(text, line, expectChecked, itemText);
  if (!located.ok) throw new Error(`refused: ${located.reason}`);
  return applyTaskToggle(text, located);
};

describe('locateTaskToggle — every list shape (FR-023)', () => {
  it.each([
    ['- [ ] a', '- [x] a'],
    ['* [ ] a', '* [x] a'],
    ['+ [ ] a', '+ [x] a'],
    ['1. [ ] a', '1. [x] a'],
    ['12) [ ] a', '12) [x] a'],
    ['    - [ ] a', '    - [x] a'],
    ['> - [ ] a', '> - [x] a'],
    ['> > 1. [ ] a', '> > 1. [x] a'],
    ['- [x] a', '- [ ] a'],
    ['- [X] a', '- [ ] a'],
  ])('%s → %s', (before, after) => {
    const checked = /\[[xX]\]/.test(before);
    expect(toggled(before, 0, checked, 'a')).toBe(after);
  });

  it('changes only the marker character — nothing else on the line or in the file (FR-022)', () => {
    const text = 'intro\n- [ ] keep [ ] this  \n- [ ] other\n';
    expect(toggled(text, 1, false, 'keep [ ] this')).toBe('intro\n- [x] keep [ ] this  \n- [ ] other\n');
  });

  it('preserves CRLF, lone CR and mixed endings around the edit (FR-029)', () => {
    expect(toggled('a\r\n- [ ] t\r\nb\rc\n', 1, false, 't')).toBe('a\r\n- [x] t\r\nb\rc\n');
    expect(toggled('a\r- [ ] t\rb', 1, false, 't')).toBe('a\r- [x] t\rb');
  });

  it('accepts an item with no text', () => {
    expect(toggled('- [ ]', 0, false, '')).toBe('- [x]');
  });
});

describe('locateTaskToggle — the source moved since the render (FR-027)', () => {
  it('relocates a moved item by its unique text', () => {
    const now = 'new line\n- [ ] one\n- [ ] two\n';
    expect(toggled(now, 1, false, 'two')).toBe('new line\n- [ ] one\n- [x] two\n');
  });

  it('relocates when the line number is past the end', () => {
    expect(toggled('- [ ] only', 9, false, 'only')).toBe('- [x] only');
  });

  it('refuses ambiguous when the line no longer holds it and the text appears twice', () => {
    expect(locateTaskToggle('x\n- [ ] dup\n- [ ] dup', 0, false, 'dup')).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('refuses not-found when no task item has the text', () => {
    expect(locateTaskToggle('- [ ] other', 0, false, 'gone')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('refuses changed when the item is there but in the other state', () => {
    expect(locateTaskToggle('- [x] t', 0, false, 't')).toEqual({ ok: false, reason: 'changed' });
  });

  it('prefers the item at the line even when its text is duplicated elsewhere', () => {
    expect(toggled('- [ ] dup\n- [ ] dup', 1, false, 'dup')).toBe('- [ ] dup\n- [x] dup');
  });

  it('never treats a non-list line as a task', () => {
    expect(locateTaskToggle('[ ] t', 0, false, 't')).toEqual({ ok: false, reason: 'not-found' });
    expect(locateTaskToggle('-[ ] t', 0, false, 't')).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('taskItemText — the renderer and main share one fingerprint', () => {
  it('returns the trimmed text after the marker, or null for a non-task line', () => {
    expect(taskItemText('> 1. [X]   hello world  ')).toBe('hello world');
    expect(taskItemText('- [ ]')).toBe('');
    expect(taskItemText('plain')).toBeNull();
  });
});
