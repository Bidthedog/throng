import { describe, it, expect } from 'vitest';
import {
  validateFlavourRecord,
  checkFlavourRecord,
} from '../../src/terminal/flavour-record.js';

/**
 * One flavour row, as the settings editor is about to commit it (019, US4/#67 — FR-019).
 *
 * The rules are the editor's, stated where the editor can say them OUT LOUD: a message, never a
 * boolean. "Invalid" with no reason is a dead end for a user who cannot see what the rule is —
 * the idiom `validateKey` established for the keyed-map control (016).
 */

const valid = {
  id: 'my-git-bash',
  label: 'Git Bash',
  file: 'C:/Program Files/Git/bin/bash.exe',
  args: [],
  defaultParams: '',
};

describe('validateFlavourRecord', () => {
  it('accepts a record with an id and an executable', () => {
    expect(validateFlavourRecord(valid, ['my-wsl'])).toBeNull();
  });

  it('requires an id — it keys the Flavour dropdown AND terminals.defaultParams', () => {
    const problem = validateFlavourRecord({ ...valid, id: '' }, []);
    expect(problem).toContain('id');
  });

  it('treats a whitespace-only id as no id at all', () => {
    expect(validateFlavourRecord({ ...valid, id: '   ' }, [])).toContain('id');
  });

  it('refuses a duplicate id with a reason that says so', () => {
    const problem = validateFlavourRecord(valid, ['my-wsl', 'my-git-bash']);
    expect(problem).toContain('already');
  });

  it('requires an executable', () => {
    const problem = validateFlavourRecord({ ...valid, file: '' }, []);
    expect(problem).toContain('executable');
  });

  /**
   * C12 — an executable means NON-EMPTY, not present-on-this-machine.
   *
   * A settings file is carried between machines and a flavour may legitimately name a path that
   * does not exist here yet. Launch already reports "not available on this machine", which is the
   * right place for that check and the only place that can make it honestly.
   */
  it('does NOT existence-check the executable — a path valid on another machine is valid here', () => {
    expect(
      validateFlavourRecord({ ...valid, file: 'Z:/not/installed/here/pwsh.exe' }, []),
    ).toBeNull();
  });

  it('reports the id problem before the executable one — a row with neither is not addressable', () => {
    expect(validateFlavourRecord({ id: '', file: '' }, [])).toContain('id');
  });
});

describe('checkFlavourRecord', () => {
  it('names the FIELD the problem belongs to, so the editor knows what it blocks', () => {
    expect(checkFlavourRecord({ ...valid, id: '' }, [])?.field).toBe('id');
    expect(checkFlavourRecord(valid, ['my-git-bash'])?.field).toBe('id');
    expect(checkFlavourRecord({ ...valid, file: '' }, [])?.field).toBe('file');
    expect(checkFlavourRecord(valid, [])).toBeNull();
  });

  it('is the source validateFlavourRecord reports — one rule, two shapes', () => {
    const record = { ...valid, file: '' };
    expect(validateFlavourRecord(record, [])).toBe(checkFlavourRecord(record, [])?.message);
  });
});
