import { createContext, useCallback, useContext, useMemo, useRef, type ReactElement, type ReactNode } from 'react';

/**
 * The JSON editor's edit gate (032, FR-017/FR-018/FR-018a).
 *
 * ══ THE PROBLEM IT SOLVES ══
 *
 * Two components have to agree about one thing. The JSON tab owns the buffer and knows whether it is
 * valid; the preferences shell owns tab switching, the UI⇄JSON toggle and the answer to main's
 * "may I close?". Neither can answer the other's question alone.
 *
 * A context rather than lifted state, because the JSON tab is remounted whenever the document
 * changes (`docKey`) and lifting the buffer would mean the shell re-rendering on every keystroke —
 * which is precisely the churn FR-017 exists to remove.
 *
 * ══ WHO SAYS SO, AND WHY IT IS THE EDITOR ══
 *
 * A refusal is reported by the EDITOR, not by the caller that was refused. The first version had it
 * the other way round and produced three separate notices for one condition — an inline banner, a
 * toast on a tab switch, and a strip at the top of the window on a close — each with its own
 * wording, and two of them claiming the user could not leave when a Discard button was sitting a few
 * pixels away.
 *
 * So `tryLeave` tells the registered editor it was refused and the editor flashes the one notice it
 * already shows. Callers get a boolean and say nothing.
 *
 * ══ WHY A REF AND NOT STATE ══
 *
 * The registration is deliberately NOT React state. It is read at the moment somebody tries to
 * leave, never rendered, and making it state would re-render the whole preferences window on every
 * keystroke to store a value nothing displays.
 */

/** What the active JSON editor tells the shell about itself. */
export interface JsonEditRegistration {
  /** True iff the buffer may be left as it stands. */
  isValid: () => boolean;
  /**
   * Apply the buffer, because the user is leaving (FR-017).
   *
   * Called ONLY when `isValid()` is true, so it never has to decide whether to write. It is
   * synchronous in effect — the write is scheduled through the shared per-document chain, which the
   * shutdown drain already settles — so a leaving user is never made to wait on the filesystem.
   */
  commit: () => void;
  /**
   * An exit was refused. Draw attention to the notice that says why (FR-018).
   *
   * The editor already shows it, permanently, from the moment the document became invalid. What a
   * refused exit adds is not information but EMPHASIS: the user pressed something and nothing
   * happened, so the thing that explains why has to move.
   */
  onRefused: () => void;
}

export interface JsonEditGate {
  /** Called by the JSON tab on mount/unmount. `null` unregisters. */
  register: (registration: JsonEditRegistration | null) => void;
  /**
   * May the user leave the JSON editor right now?
   *
   * Commits and returns `true` when there is nothing in the way — including when no JSON editor is
   * mounted at all, which is the common case and must not need a special caller. Otherwise it tells
   * the editor to flash its notice and returns `false`; the caller simply does not proceed.
   */
  tryLeave: () => boolean;
}

const NOOP_GATE: JsonEditGate = {
  register: () => undefined,
  tryLeave: () => true,
};

const JsonEditGateContext = createContext<JsonEditGate>(NOOP_GATE);

/**
 * The default is a gate that always says yes, and that is the right default rather than a
 * convenience.
 *
 * `JsonTab` is rendered in tests and in surfaces that mount no provider. A default that threw, or
 * that blocked, would make an unmounted provider fail as "the user cannot switch tabs" — a symptom
 * nobody would trace back to a missing provider.
 */
export function useJsonEditGate(): JsonEditGate {
  return useContext(JsonEditGateContext);
}

export function JsonEditGateProvider({ children }: { children: ReactNode }): ReactElement {
  const active = useRef<JsonEditRegistration | null>(null);

  const register = useCallback((registration: JsonEditRegistration | null) => {
    active.current = registration;
  }, []);

  const tryLeave = useCallback((): boolean => {
    const registration = active.current;
    if (!registration) return true;
    if (registration.isValid()) {
      // FR-017: leaving IS the apply trigger. Nothing wrote the document while the user was typing.
      registration.commit();
      return true;
    }
    registration.onRefused();
    return false;
  }, []);

  const gate = useMemo<JsonEditGate>(() => ({ register, tryLeave }), [register, tryLeave]);

  return <JsonEditGateContext.Provider value={gate}>{children}</JsonEditGateContext.Provider>;
}
