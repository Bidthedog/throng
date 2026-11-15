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
import { normaliseForCompare, pathCompareKey, remainderUnder, samePath, isUnderPath } from '../../src/fs/path-id.js';
import { linuxHostTraits, macosHostTraits } from '../../src/platform/host-traits.js';
import { withHostTraits } from '../../src/testing/with-host-traits.js';

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

  /**
   * A `..` SEGMENT IS REFUSED (033 FR-032).
   *
   * This predicate compares strings and never touches a disk, so it cannot resolve `..` — but every
   * consumer that acts on its answer can and does. `C:/project/../../Windows/System32` is a clean
   * prefix match against `C:/project`, and `statSync` (and then the shell) resolve it to somewhere
   * else entirely. The two disagreed about what one string meant, and this is the side that makes
   * the containment decision, so it refuses what it cannot evaluate.
   */
  describe('a `..` segment', () => {
    it('does NOT escape the folder by looking like a descendant', () => {
      expect(isUnderPath('C:/project/../../Windows/System32', 'C:/project')).toBe(false);
      expect(isUnderPath('C:\\project\\..\\other', 'C:/project')).toBe(false);
    });

    it('is refused wherever it appears — deep, trailing, or on the FOLDER side', () => {
      expect(isUnderPath('C:/project/src/../../escape', 'C:/project')).toBe(false);
      expect(isUnderPath('C:/project/..', 'C:/project')).toBe(false);
      expect(isUnderPath('C:/project/src', 'C:/project/sub/..')).toBe(false);
    });

    it('is a SEGMENT rule — a name that merely contains dots is untouched', () => {
      // The regression this guards: a blanket `includes('..')` would refuse real files.
      expect(isUnderPath('C:/project/..hidden', 'C:/project')).toBe(true);
      expect(isUnderPath('C:/project/a..b/one.txt', 'C:/project')).toBe(true);
      expect(isUnderPath('C:/project/notes...txt', 'C:/project')).toBe(true);
    });
  });
});

/** 070 FR-020, FR-021, research R4: the volume decides case, and Unicode normalisation never splits one file in two. */
describe('macOS path identity', () => {
  const macos = macosHostTraits('/var/folders/zz/T/throng', ['/Volumes/Work', '/Volumes/Work/Deep']);
  // Built from code points: the two spellings must differ byte for byte, whatever an editor does to the source.
  const nfc = `caf${String.fromCharCode(0xe9)}`;
  const nfd = `cafe${String.fromCharCode(0x301)}`;

  it('treats two cases of one name as one file on a default volume', () => {
    withHostTraits(macos, () => {
      expect(samePath('/Users/dev/p/README.md', '/Users/dev/p/readme.md')).toBe(true);
      expect(isUnderPath('/Users/Dev/P/a.md', '/users/dev/p')).toBe(true);
    });
  });

  it('treats them as two files under a case-sensitive volume', () => {
    withHostTraits(macos, () => {
      expect(samePath('/Volumes/Work/README.md', '/Volumes/Work/readme.md')).toBe(false);
      expect(samePath('/Volumes/Work/README.md', '/Volumes/Work/README.md/')).toBe(true);
      expect(isUnderPath('/Volumes/Work/Src/a.ts', '/Volumes/Work/src')).toBe(false);
    });
  });

  it('matches the root itself by the case rule of the volume that holds it, so either spelling of the mount is under it', () => {
    withHostTraits(macos, () => {
      expect(samePath('/volumes/work/README.md', '/Volumes/Work/README.md')).toBe(true);
      expect(samePath('/volumes/work/README.md', '/Volumes/Work/readme.md')).toBe(false);
      // A sibling whose name merely starts like the root is not under it.
      expect(samePath('/Volumes/Workshop/A.md', '/Volumes/Workshop/a.md')).toBe(true);
    });
  });

  it('lets the longest root win', () => {
    withHostTraits(macos, () => {
      expect(pathCompareKey('/Volumes/Work/Deep/X.md')).toBe('/volumes/work/deep/X.md');
    });
  });

  it('can treat the whole boot volume as case-sensitive', () => {
    withHostTraits(macosHostTraits('/tmp/throng', ['/']), () => {
      expect(samePath('/Users/dev/README.md', '/Users/dev/readme.md')).toBe(false);
    });
  });

  it('treats NFD and NFC spellings of one name as the same file, for comparison only', () => {
    withHostTraits(macos, () => {
      expect(samePath(`/Users/dev/${nfd}.md`, `/Users/dev/${nfc}.md`)).toBe(true);
      expect(samePath(`/Volumes/Work/${nfd}`, `/Volumes/Work/${nfc}`)).toBe(true);
      expect(isUnderPath(`/Users/dev/${nfd}/x.md`, `/Users/dev/${nfc}`)).toBe(true);
      // The remainder is cut from the path as spelled, never from its normalised form.
      expect(remainderUnder(`/Users/dev/${nfd}/${nfd}.md`, `/Users/dev/${nfc}`)).toBe(`/${nfd}.md`);
    });
  });

  it('leaves Windows and Linux results unchanged (FR-039)', () => {
    expect(normaliseForCompare(`C:\\P\\${nfd}\\`)).toBe(`c:/p/${nfd}`);
    expect(samePath(`C:/p/${nfd}`, `C:/p/${nfc}`)).toBe(false);
    withHostTraits(linuxHostTraits('/run/user/1000/throng'), () => {
      expect(samePath('/p/README.md', '/p/readme.md')).toBe(false);
      expect(samePath(`/p/${nfd}`, `/p/${nfc}`)).toBe(false);
      expect(pathCompareKey('/P/Note.txt')).toBe('/P/Note.txt');
    });
  });
});
