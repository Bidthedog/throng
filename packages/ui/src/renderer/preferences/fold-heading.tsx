import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { formatGrouped } from '@throng/core';
import { Icon } from '../common/icon.js';
import { IconButton } from '../common/icon-button.js';
import type { FoldTab } from './preferences-folds.js';

/** What marks a row as holding an invalid entry: an input's `aria-invalid`, or a problem row's own hook. */
const INVALID_SELECTOR = '[aria-invalid="true"], [data-pref-invalid]';

/**
 * The one foldable heading every Preferences tab renders (056 FR-001..FR-007, FR-013; contracts/folding.md).
 *
 * ══ ONE ELEMENT, NOT THREE COPIES ══
 *
 * Before 056 the section markup was copied into three tabs and the Icons section, and `Subsection` held
 * the subgroup/subsection version. FR-013 says the three tabs fold identically — same control, same keys,
 * same count, same search behaviour — "through the one shared rendering", which is only checkable if there
 * is one. The caller keeps its own wrapper (`<section>` or the `role="group"` div) and its test ids; this
 * renders the heading and the content container inside it.
 *
 * ══ THE HEADING IS A DISCLOSURE BUTTON (F1, FR-004) ══
 *
 * `<hN>` holding ONE `<button>`: the heading stays a heading to a screen reader's heading navigation, and
 * the button spans the whole row, so a click anywhere on it — name, count, empty space — toggles. Enter and
 * Space are the button's own behaviour; nothing here re-implements them. The 046 Projects category header
 * is the precedent (whole-row toggle, rotated `chevron` token, a count).
 *
 * ══ HIDE, NEVER UNMOUNT (F3, research R2) ══
 *
 * Folded content gets the `hidden` attribute and stays mounted. Drafts and invalid flags are local state
 * inside each control, so unmounting would discard an entry the user had not finished — FR-007 forbids it.
 * `hidden` also takes the rows out of the tab order and the accessibility tree, which is FR-004's "rows
 * inside a folded heading MUST NOT receive focus". The container carries no `display` rule of its own and
 * the stylesheet backs `[hidden]` with `display: none`, so no class can override a fold.
 *
 * ══ THE GROUP KEEPS ITS NAME (F4, FR-005) ══
 *
 * `aria-labelledby` on the caller's group points at the NAME span only. Pointing it at the heading would
 * fold the count and the marker into the group's name ("Editor 34") and change what the group has always
 * been called.
 *
 * ══ THE WARNING MARKER (F2, F7, FR-007, research R3) ══
 *
 * Shown only while folded and something inside is `aria-invalid="true"`. Evaluated when the heading
 * folds and kept current by a MutationObserver that exists ONLY while folded, filtered to that one
 * attribute (and added/removed rows), so it does no work on the input path (Principle XII).
 */
export function FoldHeading({
  level,
  testId,
  name,
  total,
  matches,
  folded,
  onToggle,
  headingId,
  titleClassName,
  children,
}: {
  /** 3 for a section, 4 for a subgroup, 5 for a nested subsection. */
  level: 3 | 4 | 5;
  /** The element's existing test id; this adds `-toggle`, `-count` and `-invalid` to it. */
  testId: string;
  name: string;
  /** Rows beneath the heading in the unfiltered registry, descendants included (FR-006). */
  total: number;
  /** Rows beneath it that survive an active search. Omit with no search; given, the label reads "N of M". */
  matches?: number | undefined;
  folded: boolean;
  onToggle: () => void;
  /** The id the caller's `aria-labelledby` points at; it lands on the name span. */
  headingId?: string;
  /** The heading's existing class (`settings-group__title`, `settings-subgroup__title`). */
  titleClassName?: string;
  children: ReactNode;
}): ReactElement {
  const ownId = useId();
  const nameId = headingId ?? `${ownId}-name`;
  const contentId = `${ownId}-content`;
  const contentRef = useRef<HTMLDivElement>(null);
  const [hasInvalid, setHasInvalid] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (!folded || el === null) {
      setHasInvalid(false);
      return;
    }
    // `aria-invalid` on the inputs, and `data-pref-invalid` for a problem row that is not an input
    // (ARIA has no aria-invalid on a table row, so the row carries its own scan hook).
    let invalid = el.querySelector(INVALID_SELECTOR) !== null;
    setHasInvalid(invalid);
    const publish = (next: boolean): void => {
      if (next === invalid) return;
      invalid = next;
      setHasInvalid(next);
    };

    // FULL SCANS ARE COALESCED AND RARE (Principle XII). With sections folded by default every section holds
    // this observer, so a record must not cost a `querySelector` over the whole subtree. Each record is
    // judged on its own target instead, and only a change that could have CLEARED the marker (an invalid
    // attribute flipped off, or a node that held one removed) asks for a rescan, at most one per frame.
    const holdsInvalid = (node: Node): boolean =>
      node instanceof Element && (node.matches(INVALID_SELECTOR) || node.querySelector(INVALID_SELECTOR) !== null);
    let frame: number | undefined;
    const rescan = (): void => {
      if (frame !== undefined) return;
      const run = (): void => {
        frame = undefined;
        publish(el.querySelector(INVALID_SELECTOR) !== null);
      };
      frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : window.setTimeout(run, 16);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') {
          // Only the target needs checking: it either became invalid, or may have been the last invalid one.
          if (record.target instanceof Element && record.target.matches(INVALID_SELECTOR)) publish(true);
          else if (invalid) rescan();
        } else {
          for (const added of record.addedNodes) if (holdsInvalid(added)) publish(true);
          if (invalid) for (const removed of record.removedNodes) if (holdsInvalid(removed)) rescan();
        }
      }
    });
    observer.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-invalid', 'data-pref-invalid'],
    });
    return () => {
      observer.disconnect();
      if (frame !== undefined) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        window.clearTimeout(frame);
      }
    };
  }, [folded]);

  const Heading = `h${level}` as 'h3' | 'h4' | 'h5';
  const label =
    matches === undefined ? formatGrouped(total) : `${formatGrouped(matches)} of ${formatGrouped(total)}`;

  return (
    <>
      <Heading className={titleClassName}>
        <button
          type="button"
          className="fold-heading__button"
          data-testid={`${testId}-toggle`}
          aria-expanded={!folded}
          aria-controls={contentId}
          // The hover title names the ACTION the click performs (themeable-icon-control rule); the
          // accessible name stays the heading's own text, which is what a disclosure button is called.
          title={folded ? 'Unfold section' : 'Fold section'}
          onClick={onToggle}
        >
          <Icon token="chevron" className={`fold-heading__chevron${folded ? '' : ' fold-heading__chevron--open'}`} />
          <span className="fold-heading__name" id={nameId}>
            {name}
          </span>
          <span className="fold-heading__count" data-testid={`${testId}-count`}>
            {label}
          </span>
          {folded && hasInvalid ? (
            <span
              className="fold-heading__invalid"
              role="img"
              title="Contains an invalid entry"
              aria-label="Contains an invalid entry"
              data-testid={`${testId}-invalid`}
            >
              <Icon token="warning" />
            </span>
          ) : null}
        </button>
      </Heading>
      <div className="fold-content" id={contentId} ref={contentRef} hidden={folded}>
        {children}
      </div>
    </>
  );
}

/**
 * Expand All and Collapse All, beside a tab's search box (056 FR-011b).
 *
 * Two icon buttons from the existing `expandAll` / `collapseAll` tokens (the explorer toolbar's), each
 * with a hover title; they are plain buttons, so Tab and Enter work. `disabled` is the caller's
 * "a search is active" — a search owns the fold state while it runs (FR-008), so a bulk fold would have
 * nothing coherent to mean.
 */
export function FoldAllButtons({
  tab,
  onExpandAll,
  onCollapseAll,
  disabled = false,
}: {
  tab: FoldTab;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <>
      <IconButton
        token="expandAll"
        className="icon-button fold-all__button"
        testId={`${tab}-expand-all`}
        title="Expand All Sections"
        disabled={disabled}
        onClick={onExpandAll}
      />
      <IconButton
        token="collapseAll"
        className="icon-button fold-all__button"
        testId={`${tab}-collapse-all`}
        title="Collapse All Sections"
        disabled={disabled}
        onClick={onCollapseAll}
      />
    </>
  );
}
