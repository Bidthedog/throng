import { describe, it, expect } from 'vitest';
import { noticeSeverityForExit, type PanelExitInfo } from '../../src/renderer/terminal/exit-store.js';

// Issue #143: a failure (crash or launch/attach failure) must render as a red
// `error` notice, not the green/neutral style. A clean exit stays `info`.
describe('noticeSeverityForExit', () => {
  const base: PanelExitInfo = { message: 'x' };

  it('maps an unexpected end (crash / launch failure) to error', () => {
    expect(noticeSeverityForExit({ ...base, unexpected: true })).toBe('error');
  });

  it('maps a clean/requested exit to info', () => {
    expect(noticeSeverityForExit({ ...base, code: 0, unexpected: false })).toBe('info');
  });

  it('treats an unknown (undefined) unexpected flag as info, not error', () => {
    expect(noticeSeverityForExit(base)).toBe('info');
  });
});
