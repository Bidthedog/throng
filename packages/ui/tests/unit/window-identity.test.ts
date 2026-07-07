import { describe, expect, it } from 'vitest';
import { parseWindowIdentity } from '../../src/renderer/window-identity.js';

// US7: a renderer window is either the main workspace window or a detached
// sub-workspace window. The kind is carried in the loaded URL's query string
// (?sw=<id>), so the renderer can decide what to mount without any IPC round-trip.
describe('parseWindowIdentity', () => {
  it('treats an empty/absent query as the main window', () => {
    expect(parseWindowIdentity('')).toEqual({ kind: 'main' });
    expect(parseWindowIdentity('?')).toEqual({ kind: 'main' });
    expect(parseWindowIdentity('?foo=bar')).toEqual({ kind: 'main' });
  });

  it('reads the sub-workspace id from ?sw=<id>', () => {
    expect(parseWindowIdentity('?sw=sw1')).toEqual({ kind: 'subworkspace', id: 'sw1' });
    expect(parseWindowIdentity('?sw=abc-123&x=1')).toEqual({ kind: 'subworkspace', id: 'abc-123' });
  });

  it('decodes a percent-encoded id', () => {
    expect(parseWindowIdentity('?sw=a%20b')).toEqual({ kind: 'subworkspace', id: 'a b' });
  });

  it('treats a blank sw value as the main window (defensive)', () => {
    expect(parseWindowIdentity('?sw=')).toEqual({ kind: 'main' });
  });
});
