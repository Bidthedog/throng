/**
 * Revert All Preferences, expressed as a KEY-SCOPED plan (032, FR-001a). Pure — no OS, no DOM.
 *
 * ══ WHY THIS IS NOT `revertAll` ══
 *
 * {@link revertAll} produces a write plan of whole documents: restore `settings.json`,
 * `keybindings.json` and every theme touched this session to the raw text captured when the
 * Preferences window opened. That sounds like exactly what "revert every editor" means, and for two
 * of the three documents it is.
 *
 * For settings it is not, and the reason is that `settings.json` is not only the preferences
 * editor's document. It also carries MAIN-WINDOW state — `newProject.lastProjectFolder` is written
 * by the project list, in the other window, while Preferences is open. Restoring the file wholesale
 * therefore discards a folder the user chose *after* opening Preferences: not something they asked
 * for, not something the confirmation warns about, and not something they would connect to the
 * button they pressed.
 *
 * ══ THE KEY SET, DEFINED RATHER THAN LEFT TO THE IMPLEMENTER ══
 *
 * The keys to revert are the settings leaves that carry a `SETTINGS_METADATA` descriptor —
 * equivalently, every leaf except `SETTINGS_INTERNAL_KEYS`, which is exactly where
 * `newProject.lastProjectFolder` lives. That is the same registry the completeness gate already
 * walks, so it stays correct without maintenance: a setting added tomorrow is reverted because it
 * declared a descriptor, not because somebody remembered this file.
 *
 * ══ THE KEY THAT WAS NOT THERE AT SNAPSHOT TIME ══
 *
 * A descriptor-carrying key absent from the captured document has three defensible meanings — leave
 * it, delete it, or reset it to the shipped default. This picks **reset to shipped default**, for
 * two reasons. It is the only one expressible without reviving the `remove` variant that was cut
 * under YAGNI. And it matches what "revert to how this window opened" means to a user: the window
 * opened showing the shipped default for that key, because that is what the app runs on when a
 * document omits it.
 */
import { DEFAULT_APP_SETTINGS } from './app-settings.js';
import type { ConfigChange } from './config-patch.js';
import { getAtPath, leavesOfDeclared } from './metadata.js';
import { SETTINGS_INTERNAL_KEYS, SETTINGS_METADATA } from './settings-metadata.js';
import { revertAll, type OnEntrySnapshot, type WritePlan } from './theme-reset.js';

/**
 * What Revert All must write: key-scoped changes for `settings`, whole documents for the rest.
 *
 * The plan is deliberately MIXED. Keybindings and themes keep the document channel — no defect has
 * been reported against either, and `writePatch` refuses them outright (`unsupported-doc`) precisely
 * so an unsupported write cannot appear to work.
 */
export interface RevertPlan {
  /** Key-scoped changes to `settings.json` — every descriptor-carrying leaf, and nothing else. */
  settingsChanges: ConfigChange[];
  /** Whole documents: `keybindings.json` and each theme captured this session. */
  documents: WritePlan;
}

/**
 * The settings leaves Revert All owns.
 *
 * Derived from the SHIPPED defaults rather than from the snapshot, so the key set is the same
 * whatever state the user's file happens to be in — a hand-deleted section does not shrink what
 * "revert everything" covers.
 */
function revertableLeaves(): string[] {
  return leavesOfDeclared(DEFAULT_APP_SETTINGS, SETTINGS_METADATA).filter(
    (key) => !SETTINGS_INTERNAL_KEYS.includes(key),
  );
}

/**
 * Turn an on-entry snapshot into the plan that restores it.
 *
 * An unparseable captured settings document yields NO settings changes — not an empty document, not
 * the defaults. The snapshot is the only record of what to revert to; if it cannot be read there is
 * nothing to revert to, and writing anything would be inventing a target. The other documents are
 * unaffected, because they were captured separately and are restored verbatim.
 */
export function planRevertAll(snapshot: OnEntrySnapshot): RevertPlan {
  // Everything except settings, restored exactly as it was captured.
  const documents = revertAll(snapshot).filter((entry) => entry.id.kind !== 'settings');

  let captured: unknown;
  try {
    captured = JSON.parse(snapshot.settings);
  } catch {
    return { settingsChanges: [], documents };
  }
  if (captured === null || typeof captured !== 'object' || Array.isArray(captured)) {
    return { settingsChanges: [], documents };
  }

  const settingsChanges = revertableLeaves().map((key): ConfigChange => {
    const at = getAtPath(captured, key);
    return {
      path: key.split('.'),
      // Absent at snapshot time → the shipped default, which is what the window was showing.
      value: at === undefined ? getAtPath(DEFAULT_APP_SETTINGS, key) : at,
    };
  });

  return { settingsChanges, documents };
}
