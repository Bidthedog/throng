/**
 * Path IDENTITY, not path spelling (019 / US1, FR-007).
 *
 * The editor coordinator stores the path a renderer opened with — forward-slashed, as the
 * File Explorer tree spells it — while UI main builds its paths with `node:path.join`, which
 * on Windows spells them back-slashed. The two name the SAME file. Every existing comparison
 * that got this right did it inline (`markDeleted`, `editor-coordinator.ts:269-276`) and every
 * new one that gets it wrong fails SILENTLY: a move is announced, nothing matches, and the
 * editor is left pointing at a file that is no longer there — issue #87's own symptom, arriving
 * through the fix for it.
 *
 * These cases are the ones raw `===` cannot see.
 */
import { describe, it, expect } from 'vitest';
import { normaliseForCompare, samePath, isUnderPath } from '../../src/fs/path-id.js';

describe('normaliseForCompare', () => {
  it('spells every separator as `/`', () => {
    expect(normaliseForCompare('C:\\p\\sub\\note.txt')).toBe('c:/p/sub/note.txt');
  });

  it('strips trailing separators — a folder is the same folder with or without one', () => {
    expect(normaliseForCompare('C:/p/dest/')).toBe('c:/p/dest');
    expect(normaliseForCompare('C:\\p\\dest\\\\')).toBe('c:/p/dest');
  });

  it('lowercases — a Windows-first decision, made once and stated', () => {
    expect(normaliseForCompare('C:/P/Note.TXT')).toBe('c:/p/note.txt');
  });

  it('leaves an already-normal path alone (idempotent)', () => {
    const n = normaliseForCompare('c:/p/note.txt');
    expect(normaliseForCompare(n)).toBe(n);
  });
});

describe('samePath', () => {
  it('is TRUE across separator spellings — the case that makes a move match nothing', () => {
    expect(samePath('C:/p/note.txt', 'C:\\p\\note.txt')).toBe(true);
  });

  it('is TRUE across case', () => {
    expect(samePath('C:/P/Note.txt', 'c:/p/note.txt')).toBe(true);
  });

  it('is FALSE when the case differs but the file does not exist there', () => {
    // Different FILES, not different spellings of one.
    expect(samePath('C:/p/note.txt', 'C:/p/notes.txt')).toBe(false);
    expect(samePath('C:/p/note.txt', 'C:/q/note.txt')).toBe(false);
  });

  it('ignores a trailing separator on a folder', () => {
    expect(samePath('C:/p/dest/', 'C:\\p\\dest')).toBe(true);
  });
});

describe('isUnderPath', () => {
  it('counts the folder itself', () => {
    expect(isUnderPath('C:/a/pack', 'C:\\a\\pack')).toBe(true);
  });

  it('counts a descendant, whatever the spelling', () => {
    expect(isUnderPath('C:\\a\\pack\\one.txt', 'C:/a/pack')).toBe(true);
    expect(isUnderPath('C:/a/pack/deep/two.txt', 'C:/A/Pack/')).toBe(true);
  });

  it('respects the SEGMENT boundary — a prefix is not a parent', () => {
    // `pack-lock.json` merely starts with `pack`. A naive startsWith would re-point it
    // under a folder it has never been in.
    expect(isUnderPath('C:/a/package-lock.json', 'C:/a/pack')).toBe(false);
    expect(isUnderPath('C:/a/packed', 'C:/a/pack')).toBe(false);
  });

  it('is FALSE for a sibling or an ancestor', () => {
    expect(isUnderPath('C:/a/other/one.txt', 'C:/a/pack')).toBe(false);
    expect(isUnderPath('C:/a', 'C:/a/pack')).toBe(false);
  });
});
