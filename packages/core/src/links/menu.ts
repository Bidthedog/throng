import type { MenuSection } from '../workspace/menu-sections.js';
import { LINK_TARGETS, linkTargetStates, type LinkTarget } from './targets.js';
import type { ResolvedLink } from './types.js';

/**
 * 045 FR-031 — the file-link run, composed once and drawn identically by both panel types
 * (`contracts/menus-and-gestures.md` §1).
 *
 * One function rather than one per surface, because FR-031 requires the two menus to be the same
 * and two builders are two chances to disagree. The surfaces differ in exactly one input — the
 * chord — and that difference is a parameter rather than a branch.
 *
 * ══ THE CHORD IS PASSED IN, AND THE TERMINAL PASSES NONE ══
 *
 * FR-031 as amended on 2026-09-18 requires Open Link to show its chord *where one is bound*, which
 * is constitution Principle VI's own wording. In a terminal none is bound
 * (`COMMAND_SCOPES['preview.followLink'].has('terminal')` is false, FR-046), and drawing
 * `Ctrl+Enter` there would advertise a key that in fact goes to the shell. So this file does not ask
 * which surface it is building for — the caller resolves the chord in its own scope and passes what
 * it finds, which for the terminal is nothing.
 *
 * ══ A NON-LINK CONTRIBUTES NOTHING ══
 *
 * FR-013: a candidate that does not resolve, and a `file:` hyperlink whose target does not exist,
 * are non-links rather than broken links. They add no items at all — not six disabled ones, which
 * would tell the user throng knows about a file it has just failed to find.
 */
export interface FileLinkMenuItem {
  /** What the item performs. Callers route on this, never on the label. */
  readonly id: 'openLink' | LinkTarget | 'copyLinkAddress';
  readonly label: string;
  readonly disabled: boolean;
  /** Always `contextual`: the run is present only because of what the pointer is over, and leads. */
  readonly section: MenuSection;
  /** The bound chord, where the caller's scope has one. Absent otherwise (FR-046). */
  readonly shortcut?: string;
}

/** FR-030's labels, settled under *Clarifications*: the labels 023 and 044 already ship. */
const TARGET_LABELS: Readonly<Record<LinkTarget, string>> = {
  editor: 'Open in Editor',
  preview: 'Open in Preview',
  osExplorer: 'Open in OS Explorer',
  osDefaultProgram: 'Open in OS Default Program',
};

export function fileLinkMenuItems(
  link: ResolvedLink | null,
  openLinkChord?: string,
): FileLinkMenuItem[] {
  if (link === null) return [];

  const states = linkTargetStates(link);
  const items: FileLinkMenuItem[] = [
    {
      id: 'openLink',
      label: 'Open Link',
      disabled: false,
      section: 'contextual',
      // An empty chord is no chord: an empty bracket after the label is worse than none.
      ...(openLinkChord !== undefined && openLinkChord.length > 0
        ? { shortcut: openLinkChord }
        : {}),
    },
  ];

  for (const target of LINK_TARGETS) {
    const state = states[target];
    if (state === 'absent') continue;
    items.push({
      id: target,
      label: TARGET_LABELS[target],
      disabled: state === 'disabled',
      section: 'contextual',
    });
  }

  items.push({
    id: 'copyLinkAddress',
    label: 'Copy Link Address',
    disabled: false,
    section: 'contextual',
  });
  return items;
}
