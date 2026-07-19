import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { hsvToRgb, parseHex, rgbToHsv, toHex, type Hsv } from '@throng/core';

import { Icon } from './icon.js';
import { clampToViewport } from './clamp-to-viewport.js';

/**
 * 018 / US4 — the themed colour picker (FR-020 … FR-026).
 *
 * To edit a colour token you clicked a swatch, and what opened was the OPERATING SYSTEM'S OWN COLOUR
 * DIALOG: a light-grey panel in system fonts, in the middle of a fully-themed dark application. No
 * stylesheet, attribute or application flag can theme it — the only remedy is to stop using the
 * native control, which is what this is.
 *
 * It sits on the control the Themes editor is BUILT FROM: every colour token in the app is edited
 * through it, which is why the jarring break was so visible.
 *
 * Two things it must not lose, and one it never had:
 *
 * - The TARGET THEME IS CAPTURED AT EDIT TIME (FR-023). Switching theme inside the write debounce
 *   would otherwise land theme A's pending document in theme B's file. That guarantee lives in the
 *   Themes tab and is untouched by this rewrite; this control just calls `onCommit`.
 * - Rapid edits inside the debounce window COMPOUND into one write rather than racing.
 * - VALIDATION, which never existed. The old control committed raw text on every keystroke, so
 *   typing `zzz` wrote `zzz` into the theme file. Here an invalid entry is refused, the last valid
 *   colour stands, and the error shows on the row.
 *
 * Fully keyboard-operable (FR-024): the saturation/value area is a focusable 2-D slider driven by the
 * arrow keys, the hue is a range input, and the hex field commits on blur/Enter.
 */

const SV_SIZE = 160;
const HUE_MAX = 360;

export function ColourPicker({
  value,
  onCommit,
  testId,
  onClose,
}: {
  /** The current colour, as it stands in the theme document. */
  value: string;
  /** Apply a colour. Called live while dragging — the caller owns the debounce. */
  onCommit: (hex: string) => void;
  testId: string;
  onClose: () => void;
}): ReactElement {
  const rgb = parseHex(value) ?? { r: 0, g: 0, b: 0 };
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(rgb));
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<{ left: number; top: number } | null>(null);

  // FR-013 / FR-036 — FLIP AND CLAMP ON BOTH AXES, via the shared clampToViewport (the same positioner
  // the context menu uses). The picker used to flip only vertically, so a swatch near the RIGHT edge
  // opened a picker that ran off the side of the window. It anchors under its control (`.ctl--colour`),
  // opening below by default and flipping above near the bottom, and now also shifts/flips horizontally
  // so it always fits. The 6px gap is baked into the anchor rect. Measured before paint so it never
  // flashes off-screen.
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const GAP = 6;
    const r = el.getBoundingClientRect();
    const a = host.getBoundingClientRect();
    const { left, top } = clampToViewport(
      { left: a.left, right: a.right, top: a.top - GAP, bottom: a.bottom + GAP },
      { width: r.width, height: r.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    // Translate the desired VIEWPORT position into an offset relative to the picker's positioned
    // ancestor (offsetParent), preserving whatever the current CSS default resolved to.
    setOffset({ left: el.offsetLeft + (left - r.left), top: el.offsetTop + (top - r.top) });
  }, []);
  const svRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Follow the document when it changes underneath us (a reset, a theme switch, the hot-reload
  // round-trip) — but never while the user is dragging, or their own drag would fight the echo of
  // its own writes coming back through the config store.
  useEffect(() => {
    if (dragging.current) return;
    const next = parseHex(value);
    if (!next) return;
    setHsv((cur) => {
      const derived = rgbToHsv(next);
      // HUE IS UNDEFINED FOR AN ACHROMATIC COLOUR. Black, white and every grey have no hue to recover:
      // `rgbToHsv` can only answer 0, because there is no other honest answer. So re-deriving the hue
      // from the value we just committed WIPES the hue the user is holding — drag the hue slider on a
      // token set to #ffffff and every step commits another achromatic hex, the echo comes back with
      // h: 0, and the slider snaps home. The control could not be driven out of white at all.
      //
      // The hue lives in the picker, not in the colour, so keep it.
      return derived.s === 0 || derived.v === 0 ? { ...derived, h: cur.h } : derived;
    });
  }, [value]);

  const apply = (next: Hsv): void => {
    setHsv(next);
    onCommit(toHex(hsvToRgb(next)));
  };

  /** Map a pointer position inside the saturation/value area onto the colour it names. */
  const fromPointer = (clientX: number, clientY: number): void => {
    const box = svRef.current?.getBoundingClientRect();
    if (!box) return;
    const s = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    const v = 1 - Math.min(1, Math.max(0, (clientY - box.top) / box.height));
    apply({ ...hsv, s, v });
  };

  useEffect(() => {
    const move = (e: PointerEvent): void => {
      if (dragging.current) fromPointer(e.clientX, e.clientY);
    };
    const up = (): void => {
      dragging.current = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });

  // Escape closes and the last applied value stands (FR-024/AC-4). Click-away too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: PointerEvent): void => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose();
    };
    const handle = setTimeout(() => {
      window.addEventListener('keydown', onKey);
      window.addEventListener('pointerdown', onDown);
    }, 0);
    return () => {
      clearTimeout(handle);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  // Open with focus in the saturation area, so the keyboard user can start immediately.
  useLayoutEffect(() => {
    svRef.current?.focus();
  }, []);

  /** Arrow keys drive the saturation/value area — this is what makes it keyboard-operable. */
  const onSvKey = (e: React.KeyboardEvent): void => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, () => Hsv> = {
      ArrowLeft: () => ({ ...hsv, s: Math.max(0, hsv.s - step) }),
      ArrowRight: () => ({ ...hsv, s: Math.min(1, hsv.s + step) }),
      ArrowUp: () => ({ ...hsv, v: Math.min(1, hsv.v + step) }),
      ArrowDown: () => ({ ...hsv, v: Math.max(0, hsv.v - step) }),
    };
    const next = moves[e.key];
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    apply(next());
  };

  const pure = toHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));

  return (
    <div
      className="colour-picker"
      ref={ref}
      data-testid={`${testId}-picker`}
      role="dialog"
      aria-label="Choose a colour"
      // Inline position overrides the CSS default once measured; `bottom: auto` neutralises the old
      // upward-flip rule so the computed top always wins.
      style={offset ? { left: offset.left, top: offset.top, bottom: 'auto' } : undefined}
    >
      <div
        ref={svRef}
        className="colour-picker__sv"
        data-testid={`${testId}-sv`}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={toHex(hsvToRgb(hsv))}
        style={{ width: SV_SIZE, height: SV_SIZE, background: pure }}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          fromPointer(e.clientX, e.clientY);
        }}
        onKeyDown={onSvKey}
      >
        <div className="colour-picker__sv-white" />
        <div className="colour-picker__sv-black" />
        <div
          className="colour-picker__thumb"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
        />
      </div>

      <input
        type="range"
        className="colour-picker__hue"
        data-testid={`${testId}-hue`}
        aria-label="Hue"
        min={0}
        max={HUE_MAX}
        value={Math.round(hsv.h)}
        onChange={(e) => apply({ ...hsv, h: Number(e.target.value) })}
      />
    </div>
  );
}

/**
 * The swatch + hex field that OPENS the picker — the control that replaces `<input type="color">`.
 *
 * The hex field holds LOCAL edit state rather than binding straight to the round-tripped theme value.
 * Before, every keystroke was gated on a 150 ms debounced write plus an inter-process round trip, so
 * the field fought the user as they typed.
 */
export function ColourField({
  value,
  onCommit,
  testId,
  clearable = false,
}: {
  value: string;
  onCommit: (hex: string) => void;
  testId: string;
  /**
   * May this token be UNSET? (018.)
   *
   * Only for a token whose absence has a meaning — `iconColour` (each icon keeps its own colour) and
   * `menuItemHoverSurface` (the highlight follows the active project). For every other token, empty is
   * not a value: `toCssVariables` emits the empty string, `setProperty(name, '')` REMOVES the
   * declaration per CSSOM, and the surface reading it loses its colour entirely — persisted to the
   * theme file, so it survives a restart. Clearing the app background used to blank the explorer.
   */
  clearable?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);

  /**
   * Commit the value that is ACTUALLY IN THE BOX, read from the DOM — not from React state.
   *
   * The same reasoning as the numeric control (and the same defect it was fixed for): a fast
   * paste-then-blur fires the commit before React has re-rendered, so a handler closing over the
   * previous state silently drops the edit.
   *
   * `report` decides whether an unparseable value SHOWS an error. This is the difference between
   * validating and nagging:
   *
   * - While TYPING, a valid colour applies LIVE (FR-022 — apply immediately to the running app), and
   *   an invalid one is simply not applied. It is not an error: someone half-way through typing
   *   `#ff8800` has written `#ff8`, and flashing a complaint at them for it would be absurd.
   * - On BLUR or ENTER, the user has finished. Now an unparseable value IS an error: it is refused,
   *   the last valid colour stands, and the row says so (FR-026).
   */
  const commit = (raw: string, report: boolean): void => {
    if (raw.trim() === '') {
      // Clearing is a legitimate act for an OPTIONAL token — it means "unset", and unset is what makes
      // `iconColour` inherit and the menu highlight follow the active project.
      //
      // For every OTHER token it is not a value at all, and writing it would delete the property from
      // the document and from the theme file. So an empty field on a required token is refused exactly
      // like any other unparseable one: the last valid colour stands, and the row says so (FR-026).
      if (!clearable) {
        if (report) setInvalid(true);
        return;
      }
      setInvalid(false);
      onCommit('');
      return;
    }
    const rgb = parseHex(raw);
    if (!rgb) {
      if (report) setInvalid(true); // the last valid colour stands (FR-026)
      return;
    }
    setInvalid(false);
    onCommit(toHex(rgb));
  };

  return (
    <span className="ctl ctl--colour">
      <button
        type="button"
        className="ctl__colour-swatch"
        data-testid={testId}
        title="Choose a colour"
        aria-label="Choose a colour"
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{ background: parseHex(value) ? value : 'transparent' }}
        onClick={() => setOpen((o) => !o)}
      >
        {parseHex(value) ? null : <Icon token="dismiss" />}
      </button>

      <input
        type="text"
        className={`ctl__input ctl__colour-hex${invalid ? ' ctl__input--invalid' : ''}`}
        data-testid={`${testId}-hex`}
        aria-invalid={invalid}
        value={text}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
          // Apply LIVE while what is typed is a colour (FR-022). This is also what the control did
          // before 018 — minus the part where it applied whatever you typed, colour or not.
          commit(e.target.value, false);
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.currentTarget.value, true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value, true);
        }}
      />

      {/*
        NO MESSAGE. The RED BORDER IS THE MESSAGE.
        
        An inline sentence under the field pushed every row below it down the moment you cleared the
        box — and clearing the box is something you do halfway through typing a new colour, so the
        whole list jumped while you were aiming at it, then jumped back. The complaint was louder than
        the mistake, and it moved the thing you were trying to hit.
        
        The border says the same thing, in place, changing nothing else on the screen. The field keeps
        `aria-invalid`, so a screen reader is told exactly what it was told before.
      */}

      {open ? (
        /*
         * `close` is MEMOISED, and that is not a micro-optimisation.
         *
         * The picker's Escape and click-away listeners live in an effect keyed on `onClose`, and
         * they arm behind a `setTimeout(0)` so the click that OPENED the picker cannot immediately
         * close it. Passing a fresh arrow function here would give that effect a new identity on
         * every render — and the picker re-renders on every colour change, which during a drag is
         * continuously. So the listeners would be torn down and re-armed dozens of times a second,
         * leaving a window on each cycle in which Escape does nothing at all.
         *
         * It showed up as an intermittently un-closable picker under load. It was not the test
         * being flaky; the picker was.
         */
        <ColourPicker value={value} testId={testId} onCommit={onCommit} onClose={close} />
      ) : null}
    </span>
  );
}
