// Layer: unit — 074 FR-072a: what a Safe HTML preview source is, and which URLs one admits.
import { describe, expect, it } from 'vitest';
import {
  SHIPPED_HTML_SAFE_SOURCES,
  matchesSafeSource,
  normaliseSafeSource,
  safeSourceList,
  sourceOf,
} from '../../src/preview/safe-sources.js';

describe('normaliseSafeSource (FR-072a)', () => {
  it.each([
    ['https://fonts.googleapis.com', 'https://fonts.googleapis.com'],
    ['  HTTPS://Fonts.GoogleApis.com/css2?family=Inter  ', 'https://fonts.googleapis.com'],
    ['https://cdn.example.com:8443/x', 'https://cdn.example.com:8443'],
    ['https://*.example.com', 'https://*.example.com'],
    ['fonts.gstatic.com', 'https://fonts.gstatic.com'],
    ['*.example.com', 'https://*.example.com'],
  ])('%s → %s', (raw, out) => {
    expect(normaliseSafeSource(raw)).toBe(out);
  });

  it.each(['http://fonts.googleapis.com', 'ftp://x.com', 'javascript:alert(1)', '', '   ', 'https://', 'https://*', 'https://a*.b.com', 'data:text/css,x'])(
    'refuses %j',
    (raw) => {
      expect(normaliseSafeSource(raw)).toBeNull();
    },
  );
});

describe('safeSourceList', () => {
  it('normalises, drops invalid entries and de-duplicates, keeping order', () => {
    expect(safeSourceList(['https://a.com/x', 'http://b.com', 'A.com', 'https://*.c.com', 42])).toEqual([
      'https://a.com',
      'https://*.c.com',
    ]);
  });

  it('a non-array is empty', () => {
    expect(safeSourceList(undefined)).toEqual([]);
  });
});

describe('matchesSafeSource', () => {
  const sources = ['https://fonts.gstatic.com', 'https://*.example.com'];

  it('admits an https URL whose origin is listed', () => {
    expect(matchesSafeSource('https://fonts.gstatic.com/s/inter/v1.woff2', sources)).toBe(true);
  });

  it('admits a subdomain of a wildcard source, at any depth, but not the bare domain', () => {
    expect(matchesSafeSource('https://img.example.com/a.png', sources)).toBe(true);
    expect(matchesSafeSource('https://a.b.example.com/a.png', sources)).toBe(true);
    expect(matchesSafeSource('https://example.com/a.png', sources)).toBe(false);
  });

  it('a source typed with the default port :443 is the source without one, and matches its URLs (FR-072c)', () => {
    expect(normaliseSafeSource('https://cdn.example.com:443')).toBe('https://cdn.example.com');
    expect(normaliseSafeSource('*.example.com:443')).toBe('https://*.example.com');
    expect(matchesSafeSource('https://cdn.example.com/site.css', [normaliseSafeSource('https://cdn.example.com:443')!])).toBe(true);
  });

  it('refuses http:, another port, a look-alike host and anything unparsable', () => {
    expect(matchesSafeSource('http://fonts.gstatic.com/x', sources)).toBe(false);
    expect(matchesSafeSource('https://fonts.gstatic.com:444/x', sources)).toBe(false);
    expect(matchesSafeSource('https://fonts.gstatic.com.evil.net/x', sources)).toBe(false);
    expect(matchesSafeSource('https://evilexample.com/x', sources)).toBe(false);
    expect(matchesSafeSource('not a url', sources)).toBe(false);
  });

  it('nothing matches an empty list', () => {
    expect(matchesSafeSource('https://fonts.gstatic.com/x', [])).toBe(false);
  });
});

describe('sourceOf', () => {
  it('names the origin a blocked URL would be allowed by', () => {
    expect(sourceOf('https://Cdn.Example.com/a/b.css?x=1')).toBe('https://cdn.example.com');
    expect(sourceOf('http://cdn.example.com/a.css')).toBe('http://cdn.example.com');
    expect(sourceOf('//cdn.example.com/a.css')).toBe('https://cdn.example.com');
    expect(sourceOf('nonsense')).toBeNull();
  });
});

it('ships Google Fonts (FR-072a)', () => {
  expect(SHIPPED_HTML_SAFE_SOURCES).toEqual(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
});
