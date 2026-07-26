import { describe, expect, it } from 'vitest';
import { windowOpenDecision } from '../../src/main/window-open-guard.js';

/**
 * US7 / FR-019b (spec 024): a renderer-opened window is always denied; only an http(s) target is
 * handed to the OS opener. The window is NEVER opened in-app.
 */
describe('windowOpenDecision (024 US7)', () => {
  it('routes http and https targets to the OS opener', () => {
    expect(windowOpenDecision('https://example.com').openExternal).toBe(true);
    expect(windowOpenDecision('http://example.com').openExternal).toBe(true);
  });

  it('does not open non-http(s) targets externally (nor in-app — the caller always denies)', () => {
    for (const bad of ['javascript:alert(1)', 'file:///c/x', 'data:text/html,x', 'about:blank', '', 42]) {
      expect(windowOpenDecision(bad as unknown).openExternal).toBe(false);
    }
  });
});
