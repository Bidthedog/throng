/**
 * The chord engine, in isolation (047 T018/T019, research R5) — the state machine `commands.ts`'s
 * `multiStrokeChords` used to own outright, now extracted to `keybindings/chord-engine.ts` so a
 * preview panel can host the SAME engine (Principle VIII) rather than a second copy of it.
 *
 * A fake {@link ChordEngineHost} stands in for CodeMirror's `runScopeHandlers`: `matchFirst` begins a
 * one-stroke prefix on `Ctrl+E`, and `matchNext` completes on `w` (recording a call) or reports
 * anything else unbound. This exercises the engine's own contract — arming, completion, the unbound
 * report, and every FR-092 ending — without any CodeMirror machinery in the loop; the full path
 * through `commands.ts` (`Ctrl+E,W` toggling word wrap in a mounted editor) stays covered by
 * `editor-two-stroke-chord.test.ts`, which is unchanged and still green.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChordEngine,
  TWO_STROKE_TIMEOUT_MS,
  UNBOUND_NOTICE_MS,
  type ChordEngineHost,
  type ChordIndicator,
  type ChordKeyEvent,
} from '../../src/renderer/keybindings/chord-engine.js';

/** A minimal `ChordKeyEvent` — real fields, fake `preventDefault`/`stopPropagation` to assert on. */
function keyEvent(init: {
  key: string;
  code: string;
  keyCode?: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
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

const ctrlE = () => keyEvent({ key: 'e', code: 'KeyE', keyCode: 69, ctrlKey: true });
const ctrlW = () => keyEvent({ key: 'w', code: 'KeyW', keyCode: 87, ctrlKey: true });
const ctrlX = () => keyEvent({ key: 'x', code: 'KeyX', keyCode: 88, ctrlKey: true });
const plainW = () => keyEvent({ key: 'w', code: 'KeyW', keyCode: 87 });
const escape = () => keyEvent({ key: 'Escape', code: 'Escape', keyCode: 27 });
const shiftAlone = () => keyEvent({ key: 'Shift', code: 'ShiftLeft', keyCode: 16, shiftKey: true });

/**
 * A one-stroke-prefix host: `Ctrl+E` begins the (single) prefix `'p1'`; while it is pending, `w`
 * completes (recorded by `ran`) and anything else is unbound. Mirrors `commands.ts`'s own host shape
 * (a match that only EXTENDS calls {@link ChordEngine.begin} synchronously; one that completes does
 * not) without any CodeMirror scope machinery.
 */
function makeHarness(): {
  engine: ChordEngine<string>;
  indicators: ChordIndicator[];
  ran: ReturnType<typeof vi.fn>;
} {
  const indicators: ChordIndicator[] = [];
  const ran = vi.fn();
  const host: ChordEngineHost<string> = {
    matchFirst: (e) => {
      if (e.key === 'e' && e.ctrlKey) {
        engine.begin('p1', ['Ctrl+E']);
        return true;
      }
      return false;
    },
    matchNext: (e, prefix) => {
      if (prefix !== 'p1') return false;
      if (e.key === 'w') {
        ran();
        return true; // completes — does NOT call begin()
      }
      return false; // unbound
    },
    onIndicator: (indicator) => indicators.push(indicator),
  };
  const engine = new ChordEngine<string>(host);
  return { engine, indicators, ran };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the first stroke arms a pending prefix', () => {
  it('consumes the key and publishes a pending indicator naming it', () => {
    const { engine, indicators } = makeHarness();
    const e = ctrlE();

    expect(engine.keydown(e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(e.stopPropagation).toHaveBeenCalledTimes(1);
    expect(indicators).toEqual([{ kind: 'pending', keys: 'Ctrl+E' }]);
  });

  it('a key matching nothing is not consumed and arms nothing', () => {
    const { engine, indicators } = makeHarness();
    expect(engine.keydown(plainW())).toBe(false);
    expect(indicators).toEqual([]);
  });
});

describe('a matching second stroke completes and fires exactly once', () => {
  it('runs the host command once, consumes the key, and clears the indicator', () => {
    const { engine, indicators, ran } = makeHarness();
    engine.keydown(ctrlE());

    const e = ctrlW();
    expect(engine.keydown(e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(ran).toHaveBeenCalledTimes(1);
    expect(indicators).toEqual([{ kind: 'pending', keys: 'Ctrl+E' }, null]);
  });

  it('a second chord afterwards arms and completes again — not a one-shot', () => {
    const { engine, ran } = makeHarness();
    engine.keydown(ctrlE());
    engine.keydown(ctrlW());
    engine.keydown(ctrlE());
    engine.keydown(ctrlW());
    expect(ran).toHaveBeenCalledTimes(2);
  });
});

describe('an unbound second stroke reports and resets', () => {
  it('is consumed, reported as not bound, and ends the prefix', () => {
    const { engine, indicators, ran } = makeHarness();
    engine.keydown(ctrlE());

    const e = ctrlX();
    expect(engine.keydown(e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(ran).not.toHaveBeenCalled();
    expect(indicators).toHaveLength(2);
    expect(indicators[1]).toMatchObject({ kind: 'unbound' });
    expect((indicators[1] as { keys: string }).keys).toContain('Ctrl+E');
    expect((indicators[1] as { keys: string }).keys).toMatch(/\bX\b/i);

    // The prefix is over: a later ordinary key is not swallowed as a second stroke.
    expect(engine.keydown(plainW())).toBe(false);
  });

  it('the very next keydown clears the stale "not bound" notice, whatever key it is', () => {
    const { engine, indicators } = makeHarness();
    engine.keydown(ctrlE());
    engine.keydown(ctrlX()); // unbound — indicator now 'unbound'
    expect(indicators.at(-1)).toMatchObject({ kind: 'unbound' });

    engine.keydown(plainW()); // matches nothing, but must clear the stale notice first
    expect(indicators.at(-1)).toBeNull();
  });

  it('times out on its own after the unbound notice window', () => {
    const { engine, indicators } = makeHarness();
    engine.keydown(ctrlE());
    engine.keydown(ctrlX());
    expect(indicators.at(-1)).toMatchObject({ kind: 'unbound' });

    vi.advanceTimersByTime(UNBOUND_NOTICE_MS - 1);
    expect(indicators.at(-1)).toMatchObject({ kind: 'unbound' });
    vi.advanceTimersByTime(1);
    expect(indicators.at(-1)).toBeNull();
  });
});

describe('Escape cancels the prefix silently (FR-092)', () => {
  it('is consumed, ends the prefix, and reports no "not bound" notice', () => {
    const { engine, indicators } = makeHarness();
    engine.keydown(ctrlE());

    const e = escape();
    expect(engine.keydown(e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(indicators).toEqual([{ kind: 'pending', keys: 'Ctrl+E' }, null]);

    // A later W is an ordinary key, not a completed chord.
    expect(engine.keydown(plainW())).toBe(false);
  });

  it('Escape with no prefix pending is left alone entirely', () => {
    const { engine, indicators } = makeHarness();
    expect(engine.keydown(escape())).toBe(false);
    expect(indicators).toEqual([]);
  });
});

describe('blur ends the prefix (FR-092)', () => {
  it('clears the indicator and a later second stroke does not complete', () => {
    const { engine, indicators } = makeHarness();
    engine.keydown(ctrlE());
    engine.blur();
    expect(indicators).toEqual([{ kind: 'pending', keys: 'Ctrl+E' }, null]);
    expect(engine.keydown(plainW())).toBe(false);
  });
});

describe('releasing a carried modifier ends the prefix silently (FR-124)', () => {
  it('a keyup releasing Ctrl while pending ends it with no "not bound" report', () => {
    const { engine, indicators } = makeHarness();
    engine.keydown(ctrlE());
    engine.keyup({ key: 'Control', code: 'ControlLeft', ctrlKey: false, altKey: false, shiftKey: false });
    expect(indicators).toEqual([{ kind: 'pending', keys: 'Ctrl+E' }, null]);
  });

  it('a completing stroke that no longer holds Ctrl is treated as a fresh first stroke instead', () => {
    const { engine, ran } = makeHarness();
    engine.keydown(ctrlE());
    // W without Ctrl: the prefix ends silently and this key is re-dispatched as an ordinary keydown —
    // which this harness's `matchFirst` does not bind, so it is not consumed.
    expect(engine.keydown(plainW())).toBe(false);
    expect(ran).not.toHaveBeenCalled();
  });
});

describe('a modifier pressed alone never ends or extends a pending prefix', () => {
  it('is not consumed, and the prefix is still pending afterwards', () => {
    const { engine, indicators } = makeHarness();
    engine.keydown(ctrlE());
    expect(engine.keydown(shiftAlone())).toBe(false);
    expect(indicators).toEqual([{ kind: 'pending', keys: 'Ctrl+E' }]);

    // The prefix survived: the bound second stroke still completes it.
    expect(engine.keydown(ctrlW())).toBe(true);
  });
});

describe('the prefix times out at TWO_STROKE_TIMEOUT_MS (FR-092)', () => {
  it('is still pending just before the timeout and gone at it', () => {
    const { engine, indicators } = makeHarness();
    engine.keydown(ctrlE());

    vi.advanceTimersByTime(TWO_STROKE_TIMEOUT_MS - 1);
    expect(indicators.at(-1)).toMatchObject({ kind: 'pending' });

    vi.advanceTimersByTime(1);
    expect(indicators.at(-1)).toBeNull();
    expect(engine.keydown(plainW())).toBe(false);
  });

  it('a completed chord cancels the pending timer — no late clear fires after', () => {
    const { engine, indicators } = makeHarness();
    engine.keydown(ctrlE());
    engine.keydown(ctrlW());
    const countAfterComplete = indicators.length;

    vi.advanceTimersByTime(TWO_STROKE_TIMEOUT_MS + 1000);
    expect(indicators).toHaveLength(countAfterComplete);
  });
});

describe('destroy() ends any pending prefix', () => {
  it('clears the indicator', () => {
    const { engine, indicators } = makeHarness();
    engine.keydown(ctrlE());
    engine.destroy();
    expect(indicators.at(-1)).toBeNull();
  });
});
