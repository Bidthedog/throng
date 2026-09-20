import { describe, expect, it } from 'vitest';

import { TERMINAL_URL_REGEX } from '../../src/renderer/terminal/terminal-url.js';

/** The urls a printed line yields, matched the way WebLinksAddon's LinkComputer matches them. */
function urlsIn(line: string): string[] {
  const rex = new RegExp(TERMINAL_URL_REGEX.source, `${TERMINAL_URL_REGEX.flags}g`);
  return [...line.matchAll(rex)].map((m) => m[0]);
}

describe('TERMINAL_URL_REGEX — which url a plain-text line yields (#198)', () => {
  it('keeps balanced parentheses inside the url', () => {
    expect(urlsIn('see https://en.wikipedia.org/wiki/Bash_(Unix_shell) for details')).toEqual([
      'https://en.wikipedia.org/wiki/Bash_(Unix_shell)',
    ]);
    expect(urlsIn('https://example.com/f(a)(b)/g')).toEqual(['https://example.com/f(a)(b)/g']);
  });

  it('drops a closing parenthesis the url did not open', () => {
    expect(urlsIn('(see https://example.com/a)')).toEqual(['https://example.com/a']);
    expect(urlsIn('(https://en.wikipedia.org/wiki/Bash_(Unix_shell))')).toEqual([
      'https://en.wikipedia.org/wiki/Bash_(Unix_shell)',
    ]);
  });

  it('stops at an opening parenthesis that is never closed', () => {
    expect(urlsIn('https://example.com/a_(b c')).toEqual(['https://example.com/a_']);
  });

  it('still drops trailing sentence punctuation', () => {
    expect(urlsIn('Go to https://example.com/a.')).toEqual(['https://example.com/a']);
    expect(urlsIn('https://example.com/q?a=1, then')).toEqual(['https://example.com/q?a=1']);
    expect(urlsIn('"https://example.com/quoted"')).toEqual(['https://example.com/quoted']);
  });

  it('matches only http(s), several per line', () => {
    expect(urlsIn('ftp://x.com and http://a.com/1 and HTTPS://b.com/2')).toEqual([
      'http://a.com/1',
      'HTTPS://b.com/2',
    ]);
  });
});
