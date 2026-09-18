import { describe, expect, it } from 'vitest';
import { terminalLinkTarget } from '../../src/terminal/link-menu.js';

/** US7 / FR-019d (spec 024): the terminal link menu's selection-priority rule. */
describe('terminalLinkTarget (024 US7)', () => {
  it('offers the link when there is a link and no selection', () => {
    expect(terminalLinkTarget('', 'https://example.com')).toBe('https://example.com');
    expect(terminalLinkTarget('', 'http://x.io/p')).toBe('http://x.io/p');
  });

  it('offers nothing when a selection is active (selection wins)', () => {
    expect(terminalLinkTarget('selected text', 'https://example.com')).toBeNull();
  });

  it('offers nothing when there is no link under the pointer', () => {
    expect(terminalLinkTarget('', null)).toBeNull();
  });

  /*
   * 045 S1 (#394) — the ONE change this supersession permits in this file.
   *
   * 024 refused `file:` because the only route out was the OS URL opener, which would launch
   * whatever the URI named. A file link now takes a path-based route that checks existence and
   * project membership and never touches that opener, so the reason for the refusal is gone — but
   * only for a target that RESOLVES. A `file:` URI naming nothing is still a non-link (FR-013),
   * and every other scheme is exactly as unopenable as it was.
   */
  it('offers a file: target that resolves (FR-011)', () => {
    expect(terminalLinkTarget('', 'file:///c/x', true)).toBe('file:///c/x');
  });

  it('offers nothing for a file: target that does not resolve (FR-013)', () => {
    expect(terminalLinkTarget('', 'file:///c/x', false)).toBeNull();
    expect(terminalLinkTarget('', 'file:///c/x')).toBeNull();
  });

  it('a selection still wins, even over a file link that resolves', () => {
    expect(terminalLinkTarget('selected text', 'file:///c/x', true)).toBeNull();
  });

  it('every other scheme stays inert, resolved or not', () => {
    for (const uri of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@b', 'ftp://x/y', 'x']) {
      expect(terminalLinkTarget('', uri, true), uri).toBeNull();
      expect(terminalLinkTarget('', uri, false), uri).toBeNull();
    }
  });

  it('a web link is unaffected by the resolution flag', () => {
    expect(terminalLinkTarget('', 'https://example.com', false)).toBe('https://example.com');
    expect(terminalLinkTarget('', 'https://example.com', true)).toBe('https://example.com');
  });
});
