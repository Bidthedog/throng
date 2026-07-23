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

  it('ignores a non-http(s) hovered value', () => {
    expect(terminalLinkTarget('', 'file:///c/x')).toBeNull();
    expect(terminalLinkTarget('', 'javascript:alert(1)')).toBeNull();
  });
});
