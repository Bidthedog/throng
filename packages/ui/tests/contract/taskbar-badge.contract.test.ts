/**
 * ITaskbarBadge (057, FR-039, contracts/app-attention.md): the no-op and the recording fake both
 * satisfy the seam. The Electron implementation (`setOverlayIcon` per window) is exercised in the
 * attention E2E through the recording fake; a real overlay cannot be asserted from a unit process.
 */
import { describe, expect, it } from 'vitest';
import { NoTaskbarBadge, type ITaskbarBadge } from '@throng/core';
import { RecordingTaskbarBadge } from '../../src/main/recording-attention-os.js';

describe.each<[string, () => ITaskbarBadge]>([
  ['NoTaskbarBadge', () => new NoTaskbarBadge()],
  ['RecordingTaskbarBadge', () => new RecordingTaskbarBadge(() => undefined)],
])('%s satisfies ITaskbarBadge', (_name, make) => {
  it('sets, replaces and clears without throwing', () => {
    const b = make();
    expect(() => {
      b.set('data:image/png;base64,AAAA', '2 panels need you');
      b.set('data:image/png;base64,BBBB', '3 panels need you');
      b.clear();
      b.clear();
    }).not.toThrow();
  });
});
