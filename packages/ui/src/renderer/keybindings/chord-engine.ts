/**
 * The multi-key chord engine (046 FR-091, FR-092, FR-124, FR-126; 047 research R5) — extracted from
 * the CodeMirror plugin that used to own it (`editor/commands.ts`'s `multiStrokeChords`), so a
 * preview panel can host the SAME state machine instead of a second copy of it (Principle VIII).
 *
 * ## Why not each host's own key-matching engine
 *
 * `keymap.of([{ key: 'Ctrl-e w' }])` (CodeMirror's own prefix support) would give a stored prefix and
 * a 4 s timeout for free, and gets two of FR-092's endings wrong for this app — with no way to correct
 * them from outside, because the stored prefix is a module-level variable in `@codemirror/view`:
 * - **Focus leaving.** The stored prefix survives a blur. Tab away and back inside 4 s, press the
 *   second key, and the chord completes in a view showing no prefix at all.
 * - **Escape.** It is consumed but not stopped, so a window-level listener still sees it and can act
 *   on it (FR-092: Escape "cancels and is consumed without closing any bar").
 * A preview panel has no CodeMirror underneath it at all, so it could not reuse CodeMirror's engine
 * even if these two endings were right.
 *
 * ## What is, and is not, host-agnostic
 *
 * This engine is PURE over key events: it knows nothing of CodeMirror, the DOM, or a preview panel.
 * MATCHING a stroke against a host's own bindings is entirely the host's job — CodeMirror's
 * `runScopeHandlers` over per-view scopes for the editor, a plain lookup for a preview — passed in as
 * two callbacks, {@link ChordEngineHost.matchFirst} and {@link ChordEngineHost.matchNext}. The engine
 * owns everything ELSE FR-092 and FR-124 require: the pending prefix, its timeout, Escape, blur,
 * modifier release, the "not bound" report, and the indicator text — so a host that gets matching
 * right for free gets every ending right too, rather than re-deriving them.
 *
 * A stroke that EXTENDS a prefix (the second of a three-key chord) and one that COMPLETES a chord
 * both come back from `matchFirst`/`matchNext` as `true` — CodeMirror's own dispatch does not
 * distinguish them either, since both are simply "a binding ran". The engine tells them apart the
 * same way the original class did: {@link ChordEngine.begin} — called by the host'S OWN matched
 * binding, synchronously, before `matchFirst`/`matchNext` returns — sets a flag the engine checks the
 * instant the call returns. A match that never calls `begin` therefore completed; one that does
 * extended.
 *
 * One continuous press (FR-124, FR-126): every key after the first must still hold every modifier the
 * FIRST key held; letting go of one ends the prefix silently, whichever key is awaited.
 *
 * Everything the engine takes is consumed AND stopped (via {@link ChordKeyEvent.preventDefault} /
 * `stopPropagation`): the strokes of a chord belong to the chord, and no window-level listener gets a
 * second go at them.
 */
import { eventToToken, formatChord, normalizeToken } from '@throng/core';
import {
  carriedModifiers,
  holdsCarried,
  NO_CARRIED,
  releasesCarried,
  resolveKeydown,
  type CarriedModifiers,
  type ChordEventLike,
} from '../config/chord-key.js';

/** How long a prefix stays pending (FR-092: CodeMirror's own `PrefixTimeout`). */
export const TWO_STROKE_TIMEOUT_MS = 4000;
/** How long "the key combination … is not bound" stays up after an unbound key. */
export const UNBOUND_NOTICE_MS = 2500;

/** `keyCode`s of a modifier pressed alone — the same list CodeMirror uses to hold a stored prefix. */
const MODIFIER_KEY_CODES: ReadonlySet<number> = new Set([16, 17, 18, 20, 91, 92, 224, 225]);
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'AltGraph',
  'OS',
]);

/** The event shape the engine reads: a real `KeyboardEvent`, or a test double of the same shape. */
export interface ChordKeyEvent extends ChordEventLike {
  readonly keyCode?: number;
  preventDefault(): void;
  stopPropagation(): void;
}

/** What the pending indicator shows — a prefix awaiting its next stroke, or a just-failed one. */
/**
 * What the pending indicator shows. `'unavailable'` (048 FR-092) is never published by the engine
 * itself: the window dispatcher raises it for a chord whose command has nothing to act on in a
 * sub-workspace window, through the same overlay, so chord feedback has one surface.
 */
export type ChordIndicator = {
  readonly kind: 'pending' | 'unbound' | 'unavailable';
  readonly keys: string;
} | null;

/**
 * Whether letting go of a first-stroke modifier ends the prefix (048 R4).
 *
 * - `'carried'` (the default) — 046 FR-124: one continuous press. Every key after the first must still
 *   hold every modifier the first held; releasing one ends the prefix silently. The editor and preview
 *   hosts use this.
 * - `'released-ok'` — 048 FR-020a: the window host's split chord takes its arrow with the first
 *   stroke's modifiers held OR released, so a release neither ends the prefix nor is checked on the
 *   next key.
 */
export type ChordModifierPolicy = 'carried' | 'released-ok';

export interface ChordEngineOptions {
  readonly modifierPolicy?: ChordModifierPolicy;
}

/**
 * What a host supplies: its OWN key-matching (over its own bindings and its own notion of "scope"),
 * keyed by an opaque `TPrefix` the host chooses (CodeMirror's `prefixes` array index, for instance).
 */
export interface ChordEngineHost<TPrefix> {
  /**
   * Try to match `e` as the FIRST stroke of some chord. A match that only EXTENDS a prefix (rather
   * than running a single-stroke command outright) calls {@link ChordEngine.begin} synchronously,
   * before returning. Returns whether the key was handled at all — the engine consumes the event
   * exactly when this is `true`.
   */
  matchFirst(e: ChordKeyEvent): boolean;
  /**
   * Try to match `e` as the stroke following `prefix`. As with {@link matchFirst}, a match that
   * EXTENDS the prefix (not yet complete) calls {@link ChordEngine.begin} synchronously; a match that
   * COMPLETES a chord runs its command and does not. Returns whether the key was handled at all.
   */
  matchNext(e: ChordKeyEvent, prefix: TPrefix): boolean;
  /** The pending/unbound indicator changed; `null` clears it. */
  onIndicator(indicator: ChordIndicator): void;
}

/**
 * One running chord engine — one per host instance (one per CodeMirror view, or one per preview
 * panel). See the module doc for what it owns and what it leaves to the host.
 */
export class ChordEngine<TPrefix> {
  private pending: TPrefix | null = null;
  private pendingPhysical: readonly string[] = [];
  /** Set by {@link begin} while a matcher call is in flight: the key EXTENDED the prefix, completed nothing. */
  private extended = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** FR-124 — the modifiers the first key held, which must stay held through every key after it. */
  private carried: CarriedModifiers = NO_CARRIED;
  /** The indicator this engine last published, so the next keydown can clear a stale one (below). */
  private indicatorShown: ChordIndicator = null;

  /** 048 R4 — `'released-ok'`: modifier release is not an ending, and `holdsCarried` is not consulted. */
  private readonly releasedOk: boolean;

  constructor(
    private readonly host: ChordEngineHost<TPrefix>,
    options: ChordEngineOptions = {},
  ) {
    this.releasedOk = options.modifierPolicy === 'released-ok';
  }

  /**
   * Called by the host's OWN matched binding, synchronously, when a stroke begins or extends a
   * prefix — never called by this class itself.
   */
  begin(prefix: TPrefix, physical: readonly string[]): void {
    this.pending = prefix;
    this.pendingPhysical = physical;
    this.extended = true;
    this.arm(TWO_STROKE_TIMEOUT_MS);
    this.setIndicator({ kind: 'pending', keys: chordLabel(physical) });
  }

  /** End the prefix (and any notice), for every FR-092 ending but an unbound key's own report. */
  end(): void {
    this.pending = null;
    this.pendingPhysical = [];
    this.carried = NO_CARRIED;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.indicatorShown) this.setIndicator(null);
  }

  keydown(e: ChordKeyEvent): boolean {
    if (this.pending === null) {
      // A notice from the last unbound key goes with the next key, whatever that key is.
      if (this.indicatorShown) this.end();
      const began = this.host.matchFirst(e);
      // FR-124 — the modifiers the first key held; releasing any of them ends the prefix.
      if (began) this.carried = carriedModifiers(e);
      return began && consume(e);
    }
    // A modifier on its own is the user reaching for Shift+W, not the next key.
    if (e.keyCode !== undefined && MODIFIER_KEY_CODES.has(e.keyCode)) return false;
    if (MODIFIER_KEYS.has(e.key)) return false;

    const prefix = this.pending;
    if (e.key === 'Escape') {
      this.end();
      return consume(e);
    }
    // FR-124 — a first-key modifier no longer held (its keyup went elsewhere) ended the prefix
    // already: end it silently, and this key is handled as it would be with no prefix.
    if (!this.releasedOk && !holdsCarried(e, this.carried)) {
      this.end();
      return this.keydown(e);
    }
    // FR-124, FR-126 — matched EXACTLY as pressed, against the next key as physically pressed
    // (`Ctrl+E,W`'s second is `Ctrl+W`). A modifier added for a key is part of that key.
    this.extended = false;
    if (this.host.matchNext(e, prefix)) {
      if (!this.extended) this.end(); // completed — a key that extended the prefix leaves it pending
      return consume(e);
    }
    // Completes nothing: consumed, typed nowhere, and reported (VS Code's behaviour) — every key
    // pressed, named as the Key Bindings editor writes the chord (`Ctrl+E,W,X`).
    // 048 FR-020a — under `'released-ok'` the first stroke's modifiers count as held whether or not
    // they still are, so the key is NAMED as carrying them: `Ctrl+Shift+Alt+End,X` for an `X` pressed
    // after letting go, exactly as for one pressed with them held (`formatChord` refuses a later
    // stroke that lacks a first-stroke modifier, which would otherwise fall back to a comma list).
    const keys = chordLabel([...this.pendingPhysical, strokeLabel(this.releasedOk ? withCarried(e, this.carried) : e)]);
    this.pending = null;
    this.pendingPhysical = [];
    this.carried = NO_CARRIED;
    this.arm(UNBOUND_NOTICE_MS);
    this.setIndicator({ kind: 'unbound', keys });
    return consume(e);
  }

  /**
   * 048 FR-092 — a host's own notice on this engine's indicator (the window host's `unavailable`),
   * ending any prefix first. It lives exactly as an unbound key's report does: {@link UNBOUND_NOTICE_MS},
   * or until the next key, whichever is first — so chord feedback has one lifetime rule, not two.
   */
  notify(indicator: NonNullable<ChordIndicator>): void {
    this.end();
    this.arm(UNBOUND_NOTICE_MS);
    this.setIndicator(indicator);
  }

  /** FR-124 — letting go of a first-key modifier while pending ends the prefix, silently. */
  keyup(e: ChordEventLike): void {
    if (this.releasedOk) return;
    if (this.pending !== null && releasesCarried(this.carried, e)) this.end();
  }

  /** FR-092: focus leaving the host ends the prefix — the indication, and the chord with it. */
  blur(): void {
    this.end();
  }

  destroy(): void {
    this.end();
  }

  private setIndicator(indicator: ChordIndicator): void {
    this.indicatorShown = indicator;
    this.host.onIndicator(indicator);
  }

  private arm(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.end(), ms);
  }
}

/** `e` with every `carried` modifier held — fields copied by name, since a DOM event's are getters. */
function withCarried(e: ChordEventLike, carried: CarriedModifiers): ChordEventLike {
  const getModifierState = e.getModifierState;
  return {
    key: e.key,
    code: e.code,
    ctrlKey: e.ctrlKey || carried.ctrl,
    altKey: e.altKey || carried.alt,
    shiftKey: e.shiftKey || carried.shift,
    metaKey: (e.metaKey ?? false) || carried.meta,
    ...(getModifierState ? { getModifierState: (k: 'NumLock') => getModifierState.call(e, k) } : {}),
  };
}

function consume(e: ChordKeyEvent): true {
  e.preventDefault();
  e.stopPropagation();
  return true;
}

/**
 * The keys pressed so far, the way the `Mods+K1,K2,K3` token writes them (046 FR-124, FR-126):
 * `Ctrl+E`, `Ctrl+E,W`, `Ctrl+E,W,Q` — through core's `formatChord`, so the indication and the Key
 * Bindings editor cannot disagree. Falls back to the strokes as pressed if core refuses them.
 */
function chordLabel(physical: readonly string[]): string {
  return (physical.length === 1 ? physical[0] : formatChord([...physical])) ?? physical.join(', ');
}

/**
 * A keydown as the Key Bindings editor spells a stroke (`X`, `Shift+W`, `Ctrl+Shift+1`) — through
 * `resolveKeydown`, so a digit is named physically, the way the capture modal would record it.
 *
 * Exported (047 T049) for a host that matches strokes against its OWN plain lookup rather than
 * CodeMirror's `runScopeHandlers` — a preview panel has no CodeMirror scopes underneath it — so it
 * can name a stroke exactly as `editor/commands.ts`'s `multiStrokeChords` does, from the same rule.
 */
export function strokeLabel(e: ChordEventLike): string {
  return (
    resolveKeydown(e, (ev) => {
      const token = eventToToken(ev);
      return token ? normalizeToken(token) : null;
    }) ?? e.key
  );
}
