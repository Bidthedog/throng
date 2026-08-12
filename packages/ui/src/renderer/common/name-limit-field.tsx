/**
 * The bounded rename field (031 US4, contracts/name-limit.md C1–C6, FR-035–FR-036a).
 *
 * ONE implementation for both rename boxes. The tab strip's and the panel header's caps are
 * required to be identical (FR-035g), and two copies of "count in grapheme clusters, cut only on a
 * cluster boundary, show the counter from ten remaining" is two chances for them to drift — which a
 * user would experience as the same limit behaving differently depending on what they renamed.
 *
 * ══ WHY GRAPHEMES, EVERYWHERE ══
 *
 * The limit is stated in "characters", and the only definition of that word the application shares
 * with the person typing is the grapheme cluster. `maxLength` on the input would count UTF-16 code
 * units, so a ten-character limit would refuse the fourth emoji and the counter would disagree with
 * the field — which is exactly C4. So the cap is applied in `onChange` through core's
 * `truncateGraphemes`, and the counter counts with `countGraphemes`. They cannot disagree, because
 * they are the same rule.
 *
 * ══ THE COUNTER IS NOT AN ERROR ══
 *
 * C3, and it is deliberate: no error styling, no notice, no blocked commit. Hitting a name limit is
 * not a mistake — the user asked for a name and got as much of it as the limit allows. A red field
 * would teach them they had done something wrong when nothing has gone wrong at all.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import { countGraphemes, truncateGraphemes } from '@throng/core';

/**
 * How close to the limit the counter appears (C1, C2, FR-035b).
 *
 * At a limit of 10 — the smallest `tabs.maxNameLength` allows — this makes the counter visible from
 * the first character. That is correct rather than a bug (C6): at that limit every character is
 * within ten of the end.
 */
const COUNTER_THRESHOLD = 10;

export interface NameLimitFieldProps {
  /** What the box opens on. Bounded on the way in, so an over-long stored name opens already cut. */
  initialValue: string;
  /** `tabs.maxNameLength`, in grapheme clusters. */
  limit: number;
  className: string;
  testId: string;
  counterTestId: string;
  counterClassName: string;
  /**
   * The user confirmed (Enter, or a blur that leaves the box). `value` is already bounded and
   * trimmed; `seed` is what the box was opened on, so the host can tell an edit from an untouched
   * box without re-deriving it from a title that may have moved underneath (#218).
   */
  onCommit: (value: string, seed: string) => void;
  /** The user backed out (Escape). Nothing to write. */
  onCancel: () => void;
}

export function NameLimitField({
  initialValue,
  limit,
  className,
  testId,
  counterTestId,
  counterClassName,
  onCommit,
  onCancel,
}: NameLimitFieldProps): ReactElement {
  // Seeded ONCE, at mount: the box is only mounted while it is open, so the initialiser is the
  // natural place for "what it opened on" and there is no effect to keep in step with a prop.
  const [draft, setDraft] = useState(() => truncateGraphemes(initialValue, limit));
  const seed = useRef<string | null>(null);

  /*
   * C5 — the limit can change WHILE the box is open (the preferences window is a separate window,
   * and settings hot-reload). Lowering it must shorten what is already typed, or the field would
   * permit a name the commit then silently cuts.
   */
  useEffect(() => {
    setDraft((current) => truncateGraphemes(current, limit));
  }, [limit]);

  const used = countGraphemes(draft);
  const atLimit = used >= limit;
  const showCounter = limit - used <= COUNTER_THRESHOLD;

  const commit = (value: string): void => {
    // FR-035f — the limit is applied at COMMIT as well as on the way in, so a box opened on an
    // over-long name (from a layout written before the limit was lowered) cannot reintroduce one.
    onCommit(truncateGraphemes(value.trim(), limit), seed.current ?? initialValue);
  };

  return (
    <>
      <input
        className={className}
        data-testid={testId}
        type="text"
        value={draft}
        autoFocus
        onFocus={(event) => {
          // The yardstick for "did they change it?", taken from the ELEMENT rather than the prop:
          // it is what the user is looking at, whatever has happened to the underlying title since.
          if (seed.current === null) seed.current = event.target.value;
          event.target.select();
        }}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(truncateGraphemes(event.target.value, limit))}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
          // Both keys are CONSUMED: they finish the rename and mean nothing to anything behind it.
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            commit((event.target as HTMLInputElement).value);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      {showCounter ? (
        <span
          className={counterClassName}
          data-testid={counterTestId}
          data-at-limit={atLimit ? 'true' : 'false'}
          // Informative, not corrective. See the C3 note at the top of this file.
          title={atLimit ? `Name limit reached (${limit} characters)` : `${used} of ${limit} characters`}
        >
          {used}/{limit}
        </span>
      ) : null}
    </>
  );
}
