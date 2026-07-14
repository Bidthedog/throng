/**
 * The precedence chain (016, FR-005a) — document override → user mapping → registry → plain text.
 *
 * The two rules this file exists to keep apart (FR-004c vs FR-005b):
 *
 *   - An EXPLICIT Plain Text is a decision. It TERMINATES the chain.
 *   - An UNRESOLVABLE id (a language a later build removed) is not a decision. It contributes
 *     nothing, FALLS THROUGH to the next rung, and the stored id is PRESERVED so a build that
 *     reintroduces the language resolves it again.
 *
 * Conflate them and either a user's deliberate "this is plain text" gets overruled by detection,
 * or a stale id silently rewrites itself and the user's choice is destroyed by an upgrade.
 */
import { describe, expect, it } from 'vitest';
import { resolveLanguage } from '../../src/editor/language-detect.js';
import { PLAIN_TEXT_ID } from '../../src/editor/languages.js';

describe('resolveLanguage precedence (FR-005a)', () => {
  it('puts the document override above everything', () => {
    expect(
      resolveLanguage({ fileName: 'main.rs', override: 'python', userMapping: { '.rs': 'go' } }),
    ).toEqual({ languageId: 'python', source: 'override' });
  });

  it('puts the user extension mapping above the built-in registry (FR-004b)', () => {
    expect(resolveLanguage({ fileName: 'legacy.h', userMapping: { '.h': 'c' } })).toEqual({
      languageId: 'c',
      source: 'user-mapping',
    });
    // …and without the mapping, the registry's `.h` → cpp fiat stands.
    expect(resolveLanguage({ fileName: 'legacy.h' })).toEqual({
      languageId: 'cpp',
      source: 'registry',
    });
  });

  it('matches a user mapping case-insensitively, like detection', () => {
    expect(resolveLanguage({ fileName: 'a.FOO', userMapping: { '.foo': 'ruby' } }).languageId).toBe('ruby');
    expect(resolveLanguage({ fileName: 'a.foo', userMapping: { '.FOO': 'ruby' } }).languageId).toBe('ruby');
  });

  it('falls back to plain text when nothing matches', () => {
    expect(resolveLanguage({ fileName: 'notes' })).toEqual({
      languageId: PLAIN_TEXT_ID,
      source: 'plaintext',
    });
  });

  it('TERMINATES the chain on an explicit Plain Text override (FR-004c)', () => {
    // The file is unmistakably Rust. The user said plain text. The user wins.
    expect(resolveLanguage({ fileName: 'main.rs', override: PLAIN_TEXT_ID })).toEqual({
      languageId: PLAIN_TEXT_ID,
      source: 'override',
    });
  });

  it('TERMINATES the chain on an explicit Plain Text user mapping (FR-004c)', () => {
    expect(
      resolveLanguage({ fileName: 'generated.ts', userMapping: { '.ts': PLAIN_TEXT_ID } }),
    ).toEqual({ languageId: PLAIN_TEXT_ID, source: 'user-mapping' });
  });

  it('FALLS THROUGH an unresolvable override, preserving the stored id (FR-005b)', () => {
    // `elvish` is not in the registry — a language a later build removed, or an older
    // build has not yet gained. It decides nothing, and detection carries on.
    const resolved = resolveLanguage({ fileName: 'main.rs', override: 'elvish' });
    expect(resolved).toEqual({ languageId: 'rust', source: 'registry' });
    // The point of FR-005b: nothing here rewrites what is stored. resolveLanguage is pure and
    // returns what to RENDER; the stored override is the caller's, untouched.
  });

  it('FALLS THROUGH an unresolvable user mapping to the registry (FR-005b)', () => {
    expect(resolveLanguage({ fileName: 'main.rs', userMapping: { '.rs': 'elvish' } })).toEqual({
      languageId: 'rust',
      source: 'registry',
    });
  });

  it('falls through an unresolvable override AND an unresolvable mapping, to plain text', () => {
    expect(
      resolveLanguage({ fileName: 'a.zzz', override: 'elvish', userMapping: { '.zzz': 'gnomish' } }),
    ).toEqual({ languageId: PLAIN_TEXT_ID, source: 'plaintext' });
  });

  it('does not conflate the two: an unresolvable id is NOT an explicit plain text', () => {
    // If these were conflated, the unresolvable override would terminate at plaintext and
    // this would be `plaintext`, not `rust`. That is the whole distinction.
    expect(resolveLanguage({ fileName: 'main.rs', override: 'elvish' }).languageId).toBe('rust');
    expect(resolveLanguage({ fileName: 'main.rs', override: PLAIN_TEXT_ID }).languageId).toBe(PLAIN_TEXT_ID);
  });
});
