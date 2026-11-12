import { describe, expect, it } from 'vitest';
import { resolveInboundDragEffect } from '../../src/explorer/inbound-drag.js';

const config = { copy: 'ctrl', move: 'shift' } as const;
const none = { ctrl: false, shift: false, alt: false };

describe('resolveInboundDragEffect (067 FR-004, FR-005a)', () => {
  it('moves when the OS offers a move, only for a move key of Shift, which is what the OS reads', () => {
    expect(resolveInboundDragEffect(none, config, true, true)).toBe('move');
    expect(resolveInboundDragEffect(none, { copy: 'shift', move: 'ctrl' }, true, true)).toBe('copy');
    expect(resolveInboundDragEffect({ ...none, ctrl: true }, config, true, true)).toBe('copy');
  });
  it('copies with no modifier, where an internal drag would move', () => {
    expect(resolveInboundDragEffect(none, config, true)).toBe('copy');
  });
  it('copies with the copy modifier', () => {
    expect(resolveInboundDragEffect({ ...none, ctrl: true }, config, true)).toBe('copy');
  });
  it('moves with the move modifier', () => {
    expect(resolveInboundDragEffect({ ...none, shift: true }, config, true)).toBe('move');
  });
  it('honours rebound modifiers', () => {
    const rebound = { copy: 'alt', move: 'ctrl' } as const;
    expect(resolveInboundDragEffect({ ...none, ctrl: true }, rebound, true)).toBe('move');
    expect(resolveInboundDragEffect({ ...none, shift: true }, rebound, true)).toBe('copy');
  });
  it('is refused with no target in a project, whatever the modifiers', () => {
    expect(resolveInboundDragEffect({ ...none, shift: true }, config, false)).toBe('none');
  });
});
