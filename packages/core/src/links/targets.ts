import type { ResolvedLink } from './types.js';

/**
 * 045 FR-030 — which of the four link targets applies to a given link, as one pure function
 * (`data-model.md` §3).
 *
 * ══ THREE STATES, AND WHY THE THIRD EXISTS ══
 *
 * `absent` and `disabled` are not degrees of the same thing. Principle VI draws the line: an item is
 * DISABLED when it is meaningful for this thing but unavailable right now — the user can see what
 * they would get and what stands in the way — and ABSENT when it is meaningless, where drawing it
 * greyed out would only ask the user to work out why it could never apply.
 *
 * That is why **preview is the only target that can be disabled**. A disabled preview provider is
 * one setting away from working, so the item names a real destination the user can reach (044
 * FR-062). "Open in Editor" on a folder, by contrast, is not one setting away from anything.
 *
 * ══ WHAT THIS FUNCTION DOES NOT DECIDE ══
 *
 * Executability. FR-039 is a rule about what a GESTURE does — it sends a click on an `.exe` to the
 * file manager instead of running it — and `default-action.ts` owns it. The menu item is still
 * offered and still runs the file when the user chooses it deliberately, so `executable` must not
 * change a single state here; a case asserts exactly that.
 */
export type LinkTarget = 'editor' | 'preview' | 'osExplorer' | 'osDefaultProgram';

export type TargetState = 'offered' | 'disabled' | 'absent';

/** FR-030's order, which is the order the menu draws them in (FR-031). */
export const LINK_TARGETS: readonly LinkTarget[] = [
  'editor',
  'preview',
  'osExplorer',
  'osDefaultProgram',
];

export function linkTargetStates(link: ResolvedLink): Readonly<Record<LinkTarget, TargetState>> {
  // FR-055's structural half: throng's own two destinations require an in-project FILE, and no
  // other clause in this feature can reach them, so nothing outside the project can be opened in an
  // editor or a preview by any gesture, item or setting.
  const throngCanOpen = link.kind === 'file' && link.inProject;

  return {
    editor: throngCanOpen ? 'offered' : 'absent',
    preview: !throngCanOpen
      ? 'absent'
      : link.preview === 'enabled'
        ? 'offered'
        : link.preview === 'disabled'
          ? 'disabled'
          : 'absent',
    // Always. Every link names a location the file manager can show, including a folder and
    // including a file outside every project — which is why it needs a reveal policy of its own
    // (FR-035a) rather than either of the two confinements that already exist.
    osExplorer: 'offered',
    osDefaultProgram: link.kind === 'file' ? 'offered' : 'absent',
  };
}
