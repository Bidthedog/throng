import {
  applyDecPrivateMode,
  applyKittyCsi,
  createKittyKeyboardState,
  type KittyCsiPrefix,
  type KittyKeyboardState,
} from './kitty-keyboard.js';

/**
 * Track a terminal program's KEYBOARD NEGOTIATION from the raw output stream (#290).
 *
 * The renderer has always derived this by parsing the program's output through xterm's CSI handlers,
 * which works exactly as long as a view exists. It does not while a panel is unmounted — a
 * background tab, or a project being switched away from — and the program has no reason to wait: it
 * negotiates when it starts and un-negotiates when it exits, whether or not anyone is watching.
 *
 * The daemon sees every byte regardless, which is the property this needs. It already tracks the
 * ALTERNATE SCREEN from the same stream for the same reason ({@link trackAltScreen}); this is the
 * other half of what a rebuilt view has to be told rather than left to infer.
 *
 * ══ WHY INFERRING IT WAS WORSE THAN MISSING IT ══
 *
 * The failure this fixes is not a missed negotiation. It is a DOUBLE-COUNTED one. Rebuilding a view
 * restored the saved state from the renderer's panel store and then replayed the daemon's scrollback
 * tail — which still contains the very sequences that produced that state, verbatim, because
 * `appendScrollback` preserves control bytes. The kitty protocol is a stack: `CSI > flags u` pushes
 * and `CSI < n u` pops. Two pushes against one pop leaves it enabled, so when the program finally
 * turned the protocol off its pop only cancelled the duplicate, and throng went on believing a
 * program wanted enhanced key reporting after it had said otherwise.
 *
 * Downstream that boolean is `programOwnsKeyboard`, and while it is wrongly true on the normal
 * buffer the scrollback chords are handed to the program: Ctrl+Home and Ctrl+End stop being
 * reserved, and plain PageUp/PageDown skip the viewport branch that is gated on it. That is #290's
 * "every scroll route dies at once", from one boolean.
 *
 * So the answer is a single authority rather than two derivations. The daemon tracks it here, hands
 * it over on attach, and the view adopts it instead of reconstructing it.
 *
 * ══ SEQUENCES SPLIT ACROSS CHUNKS ══
 *
 * A PTY chunk boundary can fall inside an escape sequence, and a `CSI < u` that arrives as `CSI <`
 * then `u` would simply not be seen — which would silently re-create the very defect this exists to
 * fix, in a form nothing would ever reproduce. So an incomplete trailing sequence is carried to the
 * next call rather than dropped. {@link trackAltScreen} does not do this and is not being changed
 * here: a lost `1049` self-corrects on the program's next screen switch, whereas a lost pop is
 * permanent until the program re-negotiates.
 */

/** How much unterminated trailing escape text is worth carrying. A CSI parameter list is short; */
/** anything longer is malformed and holding it would grow without bound. */
const MAX_PENDING = 64;

/** ESC, and the CSI introducer that follows it. */
const ESC = '\x1b';

/**
 * One CSI sequence: the introducer, an optional private-marker prefix, numeric parameters, and the
 * final byte. Only `u` (kitty) and `h`/`l` (DEC private modes) are acted on; every other final is
 * matched so that the scan steps over it rather than mistaking its bytes for a later sequence.
 */
// This matches a CONTROL sequence, so it necessarily contains a control character — the same
// exemption `alt-screen.ts` takes for the same reason.
// eslint-disable-next-line no-control-regex
const CSI = /\u001b\[([?=><])?([0-9;]*)([A-Za-z])/g;

/** The kitty CSI-u private markers throng honours — the same set the renderer registers. */
const KITTY_PREFIXES = new Set<string>(['?', '=', '>', '<']);

export interface NegotiationScan {
  /** What the program has negotiated, after this chunk. */
  readonly state: KittyKeyboardState;
  /** An unterminated trailing escape sequence, to be prepended to the next chunk. */
  readonly pending: string;
}

/** A fresh scan: nothing negotiated, nothing half-read. */
export function createNegotiationScan(): NegotiationScan {
  return { state: createKittyKeyboardState(), pending: '' };
}

/** `"1;2"` → `[1, 2]`; `""` → `[]`. Empty positions read as 0, as a terminal's parser does. */
function params(raw: string): number[] {
  if (raw === '') return [];
  return raw.split(';').map((p) => (p === '' ? 0 : Number.parseInt(p, 10)));
}

/**
 * Apply every complete negotiation sequence in `chunk`, in the order the program emitted them.
 *
 * Order is load-bearing and is why this is a scan rather than a last-match-wins search like
 * {@link trackAltScreen}: pushes and pops only mean anything in sequence.
 */
export function scanKeyboardNegotiation(previous: NegotiationScan, chunk: string): NegotiationScan {
  const text = previous.pending + chunk;
  let state = previous.state;
  let consumedTo = 0;

  CSI.lastIndex = 0;
  for (let m = CSI.exec(text); m !== null; m = CSI.exec(text)) {
    consumedTo = m.index + m[0].length;
    const prefix = m[1] ?? '';
    const final = m[3] ?? '';
    if (final === 'u') {
      if (!KITTY_PREFIXES.has(prefix)) continue; // a bare `CSI u` is not ours
      // The `?` query's REPLY belongs to the view, which answers the program itself. Here the
      // sequence is only evidence about state, and `applyKittyCsi` leaves state untouched for it.
      state = applyKittyCsi(state, prefix as KittyCsiPrefix, params(m[2] ?? '')).state;
    } else if ((final === 'h' || final === 'l') && prefix === '?') {
      state = applyDecPrivateMode(state, params(m[2] ?? ''), final === 'h');
    }
  }

  return { state, pending: trailingPartial(text, consumedTo) };
}

/**
 * The unterminated escape sequence at the end, if any.
 *
 * Searching from the last COMPLETE sequence rather than the end of the string: an ESC that has
 * already been consumed as part of a match is not pending, and re-finding it would replay it.
 */
function trailingPartial(text: string, consumedTo: number): string {
  const esc = text.lastIndexOf(ESC);
  if (esc < consumedTo) return '';
  const tail = text.slice(esc);
  // A complete sequence would have matched above, so anything here is genuinely partial — unless it
  // is too long to be a CSI parameter list, in which case it is malformed and not worth carrying.
  return tail.length > MAX_PENDING ? '' : tail;
}
