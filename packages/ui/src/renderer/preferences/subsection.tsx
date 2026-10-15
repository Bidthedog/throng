import { useId, type ReactElement, type ReactNode } from 'react';
import { FoldHeading } from './fold-heading.js';
import type { FoldCount } from './use-preference-folds.js';

/**
 * One subsection of a preferences section (040 FR-036a/b). Beside {@link groupDescriptors}, because
 * the two halves of the same requirement belong together.
 *
 * ══ WHY THIS IS A COMPONENT AND NOT THREE COPIES OF SIX LINES ══
 *
 * `group-descriptors.ts` deduplicated the GROUPING, which was already byte-identical in two tabs.
 * FR-036's binding — "one registry cannot render two ways" — is about the RENDERING, and
 * `contracts/metadata.md` pins six rules on all three tabs at once. Left as three copies of the
 * markup, changing any one of those rules is three edits, and missing one fails nothing: the
 * settings copy has a not-collapsible test, the other two did not, so a `<details>` creeping into
 * the Themes tab would have shipped.
 *
 * The three copies differed in exactly one character sequence — the test-id prefix — which is what
 * makes this an extraction rather than a generalisation. Nothing here is parameterised that the
 * tabs do not already disagree about.
 *
 * ══ WHY THE ID PREFIX IS A PARAMETER AND THE CLASS NAMES ARE NOT ══
 *
 * The prefixes genuinely differ (`settings-subgroup-`, `keybindings-subgroup-`,
 * `themes-subgroup-`) and `contracts/metadata.md` fixes each one; the Themes tab's is deliberately
 * NOT `settings-subgroup-` even though its GROUP ids borrow the Settings tab's prefix, because that
 * collision is inherited rather than chosen. The class names never differed, so they stay here as
 * literals — a prop nobody varies is a way for someone to vary it.
 *
 * ══ ROLE AND LABEL ══
 *
 * A bare `<div>` + `<h4>` says "these fields belong together" visually and nowhere else. A screen
 * reader walking the form field by field hears the status-bar toggles as three unrelated
 * checkboxes. `role="group"` with `aria-labelledby` on the heading is the standard pair, and the
 * heading text is already the right label — so this costs one attribute and no new wording.
 *
 * {@link useId} rather than a slug of `${group}-${subgroup}`: group and subgroup names carry spaces
 * and `·`, an `id` must be unique across the whole document, and the Themes tab shares its GROUP id
 * prefix with the Settings tab. A generated id cannot collide and cannot be malformed; the
 * human-readable string stays where it is useful, in `data-testid`.
 *
 * ══ IT FOLDS (056 FR-002, WHICH SUPERSEDES 040 FR-036a) ══
 *
 * 040 pinned "not collapsible" on this component; 056 reverses it. The heading is rendered by
 * {@link FoldHeading} — the same element the sections use — and the fold state, the toggle and the counts
 * come from the tab, which owns them. `role="group"`, `aria-labelledby`, the test ids and the h4/h5
 * levels are exactly as before (FR-005): the id lands on the heading's NAME, so the group is still called
 * "Status Bar" and not "Status Bar 3".
 */
export function Subsection({
  testIdPrefix,
  group,
  subgroup,
  subsection,
  level = subsection === undefined ? 4 : 5,
  folded,
  onToggle,
  count,
  children,
}: {
  /**
   * This tab's own prefix — `settings-subgroup`, `keybindings-subgroup` or `themes-subgroup`; for a
   * nested subsection (054) `settings-subsection`, `keybindings-subsection` or `themes-subsection`.
   */
  testIdPrefix: string;
  /** The section this subsection sits in. The id is group-qualified: two groups may share a name. */
  group: string;
  /** The subsection's name, used both as its heading and as the tail of its test id. */
  subgroup: string;
  /**
   * 054 FR-050a — the THIRD level, nested inside `subgroup`: its name becomes the heading and the tail
   * of the test id (`<prefix>-<group>-<subgroup>-<subsection>`). The same component, one level down, so
   * the six rendering rules hold there too.
   */
  subsection?: string;
  /** The heading level: `h4` for a subgroup, `h5` for a subsection nested in one (054 R9). */
  level?: 4 | 5;
  /** Is this subsection folded? The tab's `usePreferenceFolds` answers; this component holds no state. */
  folded: boolean;
  onToggle: () => void;
  /** Rows beneath it (FR-006): the unfiltered total, and the match count while a search is active. */
  count: FoldCount;
  /** The already-rendered rows. The tabs each render their own row shape. */
  children: ReactNode;
}): ReactElement {
  const headingId = useId();
  const name = subsection ?? subgroup;
  // Unslugified, space and all — every shipped id is the raw group string
  // (`settings-group-Editor · Navigation`), and slugifying only these would make them the one
  // set of ids in the registry that does not match the strings they name.
  const testId = `${testIdPrefix}-${group}-${subgroup}${subsection === undefined ? '' : `-${subsection}`}`;
  return (
    <div
      className={`settings-subgroup${level === 5 ? ' settings-subgroup--nested' : ''}`}
      role="group"
      aria-labelledby={headingId}
      data-testid={testId}
    >
      {/* Folds since 056 (FR-002), superseding 040 FR-036a's "not collapsible" and contract rule 3. */}
      <FoldHeading
        level={level}
        testId={testId}
        name={name}
        total={count.total}
        matches={count.matches}
        folded={folded}
        onToggle={onToggle}
        headingId={headingId}
        titleClassName="settings-subgroup__title"
      >
        {children}
      </FoldHeading>
    </div>
  );
}
