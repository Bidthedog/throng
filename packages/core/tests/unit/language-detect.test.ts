/**
 * Extension-only detection (016, FR-002/FR-002b).
 *
 * Detection reads the FILENAME and nothing else. The rules that matter: the longest
 * declared suffix wins (`types.d.ts` is TypeScript declarations, not merely `.ts`),
 * matching is case-insensitive, and a file with no extension at all is plain text —
 * never sniffed from its content.
 */
import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../../src/editor/language-detect.js';
import { PLAIN_TEXT_ID } from '../../src/editor/languages.js';

describe('detectLanguage (FR-002)', () => {
  it('matches a simple extension', () => {
    expect(detectLanguage('main.rs')).toBe('rust');
    expect(detectLanguage('app.py')).toBe('python');
    expect(detectLanguage('tsconfig.json')).toBe('json');
  });

  it('prefers the LONGEST declared suffix (FR-002b)', () => {
    expect(detectLanguage('types.d.ts')).toBe('typescript');
    // Both `.d.ts` and `.ts` are declared by TypeScript; the point is the longest one is
    // consulted first, which is what lets a future language claim `.d.ts` alone.
    expect(detectLanguage('index.ts')).toBe('typescript');
  });

  it('matches case-insensitively', () => {
    expect(detectLanguage('README.MD')).toBe('markdown');
    expect(detectLanguage('Program.CS')).toBe('csharp');
  });

  it('gives a file with NO extension plain text (FR-002b)', () => {
    expect(detectLanguage('Dockerfile')).toBe(PLAIN_TEXT_ID);
    expect(detectLanguage('Makefile')).toBe(PLAIN_TEXT_ID);
  });

  it('treats a leading-dot-only name as having no extension (FR-002b)', () => {
    expect(detectLanguage('.gitignore')).toBe(PLAIN_TEXT_ID);
    expect(detectLanguage('.env')).toBe(PLAIN_TEXT_ID);
  });

  it('gives an unknown extension plain text, never an error', () => {
    expect(detectLanguage('archive.zzz')).toBe(PLAIN_TEXT_ID);
  });

  it('reads only the filename of a full path', () => {
    expect(detectLanguage('C:\\src\\deep\\main.go')).toBe('go');
    expect(detectLanguage('/home/u/src/main.go')).toBe('go');
  });

  it('never inspects content — a shebang decides nothing (FR-002)', () => {
    // detectLanguage takes a filename and nothing else: there is no parameter through
    // which content COULD reach it. That is the guarantee, expressed as a type.
    expect(detectLanguage.length).toBe(1);
    expect(detectLanguage('script')).toBe(PLAIN_TEXT_ID);
  });
});
