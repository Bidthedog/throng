/**
 * Quick Open's exclusion toggle — does this search see what the project hides? (033, FR-069–FR-069c)
 *
 * ══ WHY IT IS CONTROLLED, WHERE THE TARGET BUTTON IS NOT ══
 *
 * `QuickOpenTarget` owns its value and reports it through `onChange`, because nothing on screen
 * depends on it until a row is chosen. This one is the opposite: its value selects WHICH INDEX the
 * window is mirroring, so it has to live where the subscription lives (`navigation-chrome.tsx`). A
 * copy held here would be a second source of truth for a question main is already answering.
 *
 * ══ WHY IT IS AN ICON WITH A HOVER TITLE, WHEN ITS NEIGHBOUR CARRIES TEXT ══
 *
 * The themeable-icon-control rule is NON-NEGOTIABLE and its exception is written for controls whose
 * LABEL IS THE STATEMENT OF THE CONSEQUENCE being consented to. FR-068 invokes that exception for
 * the target button, because a user needs to know where their file is about to land before they
 * press Enter. Nothing asks it of this control, and widening a non-negotiable rule's exception to
 * something that does not need it would be the wrong direction — so this stays an icon, and the
 * asymmetry between the two header controls is deliberate.
 *
 * ══ THE TOKENS ══
 *
 * `hide` while it is excluding, `showHidden` while it is not. `hide` is the SAME token the tree's
 * "Hide in this project" menu row carries, so the control reads as the same idea rather than as a
 * second vocabulary for it — which is FR-069c's claim, expressed in glyphs.
 */
import { type ReactElement } from 'react';
import { IconButton } from '../common/icon-button.js';

export function QuickOpenHidden({
  includeHidden,
  onChange,
}: {
  /** True while this search is seeing everything, including what the project hides. */
  includeHidden: boolean;
  onChange: (next: boolean) => void;
}): ReactElement {
  /*
   * The title says BOTH what is true now and what pressing it does.
   *
   * FR-068 exists because the target control stated the first and never the second, and a control
   * that only names its current value tells a user nothing about the choice available to them.
   * The same mistake is available here for free, so the sentence is written to close it.
   */
  const title = includeHidden
    ? 'Showing files this project hides — press to leave them out'
    : 'Leaving out files this project hides — press to show them';
  return (
    <IconButton
      token={includeHidden ? 'showHidden' : 'hide'}
      className="picker__header-button"
      testId="quickopen-hidden"
      title={title}
      /*
       * `exclude` / `include` — what the control is DOING, not what pressing it would do. Same
       * convention as `quickopen-target`'s `data-value`, and worth stating because the opposite
       * reading is equally natural and would make every assertion in the suite quietly inverted.
       */
      dataAttrs={{ 'data-value': includeHidden ? 'include' : 'exclude' }}
      onClick={() => onChange(!includeHidden)}
    />
  );
}
