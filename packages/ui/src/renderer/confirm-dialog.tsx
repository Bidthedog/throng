import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useFocusTrap } from './common/focus-trap.js';

/**
 * THE confirmation model (018 / US6, FR-048/048a).
 *
 * A confirmation is modal and blocking: the user is consenting to a consequence, and the
 * constitution requires its decision buttons keep TEXT LABELS, because the label IS the statement of
 * the consequence being consented to. That is why there are two notice models and not one — putting
 * "delete this theme?" in the same auto-dismissing corner widget as "saved" would let it be missed,
 * or dismissed without a decision.
 *
 * 018 folds every other confirmation in the application into this one. Before, there were FIVE:
 *
 *   - this promise-based modal
 *   - a RIVAL modal in the preferences window, which exists only because this provider was never
 *     mounted there, so `useConfirm()` threw and the themes surface had to grow its own
 *   - an inline confirm STRIP, also in preferences
 *   - and three n-way decision modals — application close, dirty close, unsaved open — each with its
 *     own component and its own bespoke markup
 *
 * The three n-way modals are confirmations by every behavioural test: modal, blocking, text-labelled
 * buttons stating a consequence. They differ from a binary confirm only in ARITY. So this model takes
 * an ordered set of `choices` (defaulting to Cancel + Accept) and an optional `details` region, and
 * one component serves all of them. A second component for "the same thing but with three buttons"
 * is precisely the duplication this story exists to remove.
 *
 * THE BINARY CASE KEEPS ITS EXACT SHAPE. `confirm-accept` alone is asserted by thirteen end-to-end
 * suites; `confirm-dialog` by most of them. That is what lets those suites keep passing untouched —
 * and a migration that forces a thirteen-file test rewrite is a migration people quietly decline to
 * do (FR-053).
 */

export interface ConfirmChoice {
  /** States the consequence. NEVER an icon — the constitution's exception to the icon rule. */
  label: string;
  /** What `confirm()` resolves to when this is chosen. */
  value: string;
  danger?: boolean;
  /** Preserved verbatim from the surface being folded in (e.g. `app-close-terminate`). */
  testId?: string;
}

export interface ConfirmOptions {
  title?: string;
  /**
   * The question, as text or as marked-up content.
   *
   * A ReactNode rather than a string so a dialog can EMPHASISE the nouns inside its own sentence —
   * the file names in "Unsaved changes", which are the one part a user actually needs to read before
   * answering. Every existing caller passes a plain string and is unaffected, and the rendered text
   * content is unchanged, so the suites that read this message keep reading the same words.
   */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
  /** An extra, visually highlighted warning shown below the message (FR-026a) —
   *  e.g. that a destroy also removes the panel from other windows/sub-workspaces. */
  warningMessage?: string;
  /**
   * An ordered set of decision buttons. Omit for the binary Cancel/Accept case, whose shape is
   * unchanged.
   *
   * This is what absorbs the three n-way modals: the app-close prompt's three choices, the
   * dirty-close prompt's three, the unsaved-open prompt's four.
   */
  choices?: readonly ConfirmChoice[];
  /** A details region — e.g. the app-close prompt's table of running terminals. */
  details?: ReactNode;
  /** Override the root/message identifiers, so a folded-in surface keeps the ones its tests use. */
  testIds?: { overlay?: string; dialog?: string; message?: string };
}

interface ConfirmContextValue {
  confirm(options: ConfirmOptions): Promise<boolean>;
  /** The n-way form: resolves to the chosen `value`, or `null` if dismissed. */
  choose(options: ConfirmOptions): Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

/** The value a dismissal (Escape) resolves to — the safe answer, which loses no work. */
const DISMISSED = null;

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: string | null) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }): ReactElement {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // The keyboard stays in the dialog while one is open (see useFocusTrap): a confirmation is
  // BLOCKING, and a dialog you can Tab out of into the live application is not.
  const trap = useFocusTrap<HTMLDivElement>(pending !== null);

  const choose = useCallback(
    (options: ConfirmOptions) =>
      new Promise<string | null>((resolve) => {
        setPending((current) => {
          // There is ONE dialog slot, so a second question asked while the first is on screen would
          // overwrite it — and the first promise would NEVER SETTLE. Its `await` would hang forever.
          //
          // That is not hypothetical: the application-close prompt awaits its answer and then closes the
          // window, so a confirmation opening underneath it would leave the app unclosable, with no
          // error and nothing on screen to explain why.
          //
          // The displaced question is answered — DISMISSED, the safe answer, the one that loses no work.
          current?.resolve(DISMISSED);
          return { ...options, resolve };
        });
      }),
    [],
  );

  // The binary case, unchanged: `true` when accepted, `false` when cancelled or dismissed.
  const confirm = useCallback(
    (options: ConfirmOptions) => choose(options).then((v) => v === 'accept'),
    [choose],
  );

  const settle = (value: string | null): void => {
    if (pending) pending.resolve(value);
    setPending(null);
  };

  const value = useMemo<ConfirmContextValue>(() => ({ confirm, choose }), [confirm, choose]);

  // The binary default. Cancel first, accept last — the destructive answer is never the one under
  // the pointer when the dialog opens.
  const choices: readonly ConfirmChoice[] = pending?.choices ?? [
    { label: pending?.cancelLabel ?? 'Cancel', value: 'cancel', testId: 'confirm-cancel' },
    {
      label: pending?.confirmLabel ?? 'Confirm',
      value: 'accept',
      danger: pending?.danger,
      testId: 'confirm-accept',
    },
  ];

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending ? (
        <div
          className="modal-overlay"
          data-testid={pending.testIds?.overlay ?? 'confirm-overlay'}
          /*
           * The scrim DISMISSES NOTHING. Clicking beside a dialog is the commonest accidental
           * gesture there is — a misjudged click at the edge of a button, a click to bring the
           * window forward — and this dialog is where a user is consenting to a consequence.
           * Answering a destructive question by missing it is not an answer. The decision buttons
           * (and Escape, which is deliberate and is what a screen-reader user is told to press)
           * are the only ways out.
           *
           * Pressing on the scrim ITSELF (never on the dialog within it) suppresses its default, so
           * the click cannot even blur the button the user was on — the dialog keeps the keyboard.
           */
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) e.preventDefault();
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            data-testid={pending.testIds?.dialog ?? 'confirm-dialog'}
            ref={trap.ref}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                settle(DISMISSED);
                return;
              }
              trap.onKeyDown(e);
            }}
          >
            {pending.title ? <h3 className="modal__title">{pending.title}</h3> : null}
            <p className="modal__message" data-testid={pending.testIds?.message ?? 'confirm-message'}>
              {pending.message}
            </p>
            {pending.warningMessage ? (
              <p className="modal__warning" data-testid="confirm-warning" role="alert">
                {pending.warningMessage}
              </p>
            ) : null}
            {pending.details}
            <div className="modal__buttons">
              {choices.map((c, i) => (
                <button
                  key={c.value}
                  type="button"
                  className={
                    // The LAST choice is the primary one, and it is the only one that may be styled
                    // destructive. Text labels throughout — the label is the consequence.
                    i === choices.length - 1
                      ? c.danger
                        ? 'modal__confirm modal__confirm--danger'
                        : 'modal__confirm'
                      : c.danger
                        ? 'modal__confirm--danger'
                        : undefined
                  }
                  data-testid={c.testId}
                  autoFocus={i === choices.length - 1}
                  onClick={() => settle(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx.confirm;
}

/** The n-way form — resolves to the chosen `value`, or `null` if the user dismissed the dialog. */
export function useChoose(): (options: ConfirmOptions) => Promise<string | null> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useChoose must be used within a ConfirmProvider');
  return ctx.choose;
}
