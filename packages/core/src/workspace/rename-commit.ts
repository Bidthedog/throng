/**
 * What committing the inline rename box actually does (#297) — one rule, in one place, pure.
 *
 * The box has three outcomes and only two of them were reachable. Committing a name renamed the
 * panel; committing the unchanged seed did nothing; and committing a BLANK box also did nothing,
 * because blank fails the same guard the unchanged seed does. So a user who had renamed a panel and
 * wanted its automatic name back had no way to say so from the box they were already typing in —
 * they had to find Reset Name in the panel menu.
 *
 * ══ THE CONDITION THIS REPLACES IS LOAD-BEARING, AND #176 IS WHY ══
 *
 *     if (trimmed.length > 0 && trimmed !== seed.trim()) { …rename… }
 *
 * A newly added Panel opens straight INTO rename mode, so simply clicking away — to pick a panel
 * type, to drag a file in — blurs the box and commits its unchanged default. Before #176 that
 * marked the panel `titleIsCustom`, and a custom title outranks every automatic one, so the
 * terminal's live window title and the editor's file name were suppressed on exactly the panels a
 * user had just created. A user who typed nothing has renamed nothing.
 *
 * That is why `reset` is gated on the panel ALREADY being renamed. A fresh panel has
 * `titleIsCustom` false, so the click-away path still resolves to `none` and still changes no
 * state — widening this to "blank always resets" would put a state change back on the very path
 * #176 was closed to protect.
 */

/** What the caller should do with a committed rename box. */
export type RenameCommit =
  /** Change nothing, and in particular do not mark the panel as renamed. */
  | { kind: 'none' }
  /** Clear the override so the panel names itself again — identical to Reset Name. */
  | { kind: 'reset' }
  /** Claim and apply this name. */
  | { kind: 'rename'; name: string };

/**
 * @param raw            what the box holds, untrimmed
 * @param seed           the name the box was opened with
 * @param titleIsCustom  whether the panel already carries a user rename
 */
export function renameCommit(raw: string, seed: string, titleIsCustom: boolean): RenameCommit {
  const trimmed = raw.trim();

  // Blank means "I want the automatic name back" — but only from someone who had replaced it.
  if (trimmed.length === 0) return titleIsCustom ? { kind: 'reset' } : { kind: 'none' };

  // Unchanged is not a rename, whether it was typed or merely blurred past (#176).
  if (trimmed === seed.trim()) return { kind: 'none' };

  return { kind: 'rename', name: trimmed };
}
