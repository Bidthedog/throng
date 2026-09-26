/**
 * The carried-modifier rule for a two-stroke chord's second stroke (046 iterate round 4, FR-123).
 *
 * While a two-stroke prefix is pending, a modifier held continuously since the first stroke does not
 * count as part of the second stroke: Ctrl held, E, W completes `Ctrl+E W`. A modifier released
 * (its keyup) stops being carried, so pressed again it DOES count — `Ctrl+E Ctrl+W` stays reachable.
 *
 * The rule lives ONCE, in `config/chord-key.ts` (Principle VIII), and both the editor's two-stroke
 * engine (`editor/commands.ts`) and the capture modal (`preferences/capture-modal.tsx`) use it.
 *
 * 046 iterate round 5 (FR-124, S29) supersedes FR-123 for MATCHING: the chord `Ctrl+E,W` is one
 * continuous press, matched exactly, and releasing a first-stroke modifier ENDS the prefix. The engine
 * now uses the carried set only to see that release (`releasesCarried`, `holdsCarried`, the last block
 * below). `withoutCarried` stays pinned here for as long as the capture modal still calls it.
 */
import { describe, expect, it } from 'vitest';
import {
  carriedModifiers,
  chordCandidates,
  holdsCarried,
  releaseCarried,
  releasesCarried,
  withoutCarried,
  NO_CARRIED,
  type ChordEventLike,
} from '../../src/renderer/config/chord-key.js';

const ev = (key: string, code: string, mods: Partial<ChordEventLike> = {}): ChordEventLike => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

const CTRL_E = ev('e', 'KeyE', { ctrlKey: true });
const CTRL_W = ev('w', 'KeyW', { ctrlKey: true });

describe('the modifiers held at the first stroke are carried', () => {
  it('Ctrl+E carries Ctrl, and nothing else', () => {
    expect(carriedModifiers(CTRL_E)).toEqual({ ctrl: true, alt: false, shift: false, meta: false });
  });

  it('Ctrl+Shift+E carries both', () => {
    expect(carriedModifiers(ev('E', 'KeyE', { ctrlKey: true, shiftKey: true }))).toEqual({
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
    });
  });

  it('nothing is carried before a first stroke', () => {
    expect(NO_CARRIED).toEqual({ ctrl: false, alt: false, shift: false, meta: false });
  });
});

describe('a modifier keyup drops it from the carried set', () => {
  it('releasing Ctrl drops Ctrl', () => {
    expect(releaseCarried(carriedModifiers(CTRL_E), { key: 'Control' }).ctrl).toBe(false);
  });

  it('releasing Shift drops only Shift', () => {
    const carried = carriedModifiers(ev('E', 'KeyE', { ctrlKey: true, shiftKey: true }));
    expect(releaseCarried(carried, { key: 'Shift' })).toEqual({ ctrl: true, alt: false, shift: false, meta: false });
  });

  it('a non-modifier keyup (the E itself) drops nothing', () => {
    const carried = carriedModifiers(CTRL_E);
    expect(releaseCarried(carried, { key: 'e' })).toEqual(carried);
  });
});

describe('the second stroke reads with the carried modifiers cleared', () => {
  it('with Ctrl carried, Ctrl+W reads as its bare key', () => {
    const second = withoutCarried(CTRL_W, carriedModifiers(CTRL_E));
    expect(second.ctrlKey).toBe(false);
    expect(second.key).toBe('w');
    expect(second.code).toBe('KeyW');
    expect(chordCandidates(second)).toEqual(['w']);
  });

  it('with Ctrl released and pressed again, Ctrl+W keeps its Ctrl', () => {
    const carried = releaseCarried(carriedModifiers(CTRL_E), { key: 'Control' });
    const second = withoutCarried(CTRL_W, carried);
    expect(second.ctrlKey).toBe(true);
    expect(chordCandidates(second)).toEqual(['Ctrl+w']);
  });

  it('a modifier added for the second stroke that was not carried is kept (Ctrl carried, Shift new)', () => {
    const second = withoutCarried(ev('W', 'KeyW', { ctrlKey: true, shiftKey: true }), carriedModifiers(CTRL_E));
    expect(second.ctrlKey).toBe(false);
    expect(second.shiftKey).toBe(true);
  });

  it('with Shift carried, a letter reads as the unshifted letter it would type (Ctrl+Shift+E then W)', () => {
    const first = ev('E', 'KeyE', { ctrlKey: true, shiftKey: true });
    const second = withoutCarried(ev('W', 'KeyW', { ctrlKey: true, shiftKey: true }), carriedModifiers(first));
    expect(second.shiftKey).toBe(false);
    expect(second.key).toBe('w');
  });
});

describe('FR-124 — letting go of a first-stroke modifier ends the prefix', () => {
  it('a Ctrl keyup releases Ctrl+E’s carried Ctrl; a Shift keyup does not', () => {
    const carried = carriedModifiers(CTRL_E);
    expect(releasesCarried(carried, { key: 'Control' })).toBe(true);
    expect(releasesCarried(carried, { key: 'Shift' })).toBe(false);
    expect(releasesCarried(carried, { key: 'e' })).toBe(false);
  });

  it('a keydown still holding Ctrl holds the carried set; one without it does not', () => {
    const carried = carriedModifiers(CTRL_E);
    expect(holdsCarried(CTRL_W, carried)).toBe(true);
    expect(holdsCarried(ev('W', 'KeyW', { ctrlKey: true, shiftKey: true }), carried), 'an added Shift is fine').toBe(true);
    expect(holdsCarried(ev('w', 'KeyW'), carried)).toBe(false);
  });
});
