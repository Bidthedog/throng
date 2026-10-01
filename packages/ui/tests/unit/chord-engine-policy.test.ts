/**
 * 048 R4, FR-020a — the chord engine's `modifierPolicy`. The editor and preview hosts keep 046 FR-124's
 * `'carried'` rule (releasing a first-stroke modifier ends the prefix); the window host passes
 * `'released-ok'`, under which a split chord's arrow may follow with the modifiers held OR released.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChordEngine,
  UNBOUND_NOTICE_MS,
  type ChordEngineHost,
  type ChordIndicator,
  type ChordKeyEvent,
  type ChordModifierPolicy,
} from '../../src/renderer/keybindings/chord-engine.js';

function keyEvent(init: {
  key: string;
  code: string;
  keyCode?: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): ChordKeyEvent {
  return {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...init,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

const HELD = { ctrlKey: true, shiftKey: true, altKey: true } as const;
const first = () => keyEvent({ key: 'End', code: 'End', keyCode: 35, ...HELD });
const downReleased = () => keyEvent({ key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 });
const ctrlUp = () => keyEvent({ key: 'Control', code: 'ControlLeft', keyCode: 17 });

function harness(policy?: ChordModifierPolicy): {
  engine: ChordEngine<string>;
  next: ReturnType<typeof vi.fn>;
  indicators: ChordIndicator[];
} {
  const next = vi.fn(() => true);
  const indicators: ChordIndicator[] = [];
  const host: ChordEngineHost<string> = {
    matchFirst: (e) => {
      if (e.code !== 'End' || !e.ctrlKey) return false;
      engine.begin('split', ['Ctrl+Shift+Alt+End']);
      return true;
    },
    matchNext: next,
    onIndicator: (i) => indicators.push(i),
  };
  const engine =
    policy === undefined ? new ChordEngine(host) : new ChordEngine(host, { modifierPolicy: policy });
  return { engine, next, indicators };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("modifierPolicy 'released-ok' (048 FR-020a)", () => {
  it('a released first-stroke modifier does not end the prefix, and matchNext receives the key', () => {
    const { engine, next, indicators } = harness('released-ok');
    engine.keydown(first());
    engine.keyup(ctrlUp());
    expect(indicators.at(-1)).toEqual({ kind: 'pending', keys: 'Ctrl+Shift+Alt+End' });

    const down = downReleased();
    expect(engine.keydown(down)).toBe(true);
    expect(next).toHaveBeenCalledWith(down, 'split');
    expect(down.preventDefault).toHaveBeenCalled();
  });

  it('an unbound key is named as carrying the first stroke’s modifiers, held or released', () => {
    for (const held of [true, false]) {
      const { engine, next, indicators } = harness('released-ok');
      next.mockReturnValue(false); // the key completes nothing
      engine.keydown(first());
      engine.keydown(keyEvent({ key: 'x', code: 'KeyX', keyCode: 88, ...(held ? HELD : {}) }));
      expect(indicators.at(-1)).toEqual({ kind: 'unbound', keys: 'Ctrl+Shift+Alt+End,X' });
    }
  });

  it('a second key pressed without the first-stroke modifiers still reaches matchNext', () => {
    const { engine, next } = harness('released-ok');
    engine.keydown(first());
    engine.keydown(downReleased());
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('notify — a host notice on the same indicator (048 FR-092)', () => {
  it('shows for UNBOUND_NOTICE_MS, then clears', () => {
    const { engine, indicators } = harness('released-ok');
    engine.notify({ kind: 'unavailable', keys: 'Next Project' });
    expect(indicators.at(-1)).toEqual({ kind: 'unavailable', keys: 'Next Project' });
    vi.advanceTimersByTime(UNBOUND_NOTICE_MS);
    expect(indicators.at(-1)).toBeNull();
  });

  it('ends a pending prefix first, and the next key clears it', () => {
    const { engine, next, indicators } = harness('released-ok');
    engine.keydown(first());
    engine.notify({ kind: 'unavailable', keys: 'Next Project' });
    expect(engine.keydown(downReleased())).toBe(false);
    expect(next).not.toHaveBeenCalled();
    expect(indicators.at(-1)).toBeNull();
  });
});

describe("modifierPolicy 'carried' — the default, unchanged (046 FR-124)", () => {
  for (const policy of [undefined, 'carried'] as const) {
    it(`${policy ?? 'default'}: releasing a first-stroke modifier ends the prefix silently`, () => {
      const { engine, next, indicators } = harness(policy);
      engine.keydown(first());
      engine.keyup(ctrlUp());
      expect(indicators.at(-1)).toBeNull();
      engine.keydown(downReleased());
      expect(next).not.toHaveBeenCalled();
    });

    it(`${policy ?? 'default'}: a key without the carried modifiers ends the prefix, never reaching matchNext`, () => {
      const { engine, next } = harness(policy);
      engine.keydown(first());
      engine.keydown(downReleased());
      expect(next).not.toHaveBeenCalled();
    });
  }
});
