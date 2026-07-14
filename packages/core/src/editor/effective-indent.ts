import type { EditorSettings } from '../config/app-settings.js';
import type { InferredIndent } from './indent-infer.js';
import type { IndentProfile } from './languages.js';

/**
 * Which indentation a document actually uses (016, FR-018/FR-018a/FR-018d).
 *
 * Three sources, and the order between them is the requirement:
 *
 *   1. **What the FILE already does** — inferred from its existing lines. A document's indentation
 *      is a FACT about that document, and it outranks every preference. A setting that overruled it
 *      would silently mix tabs and spaces into a file the user never asked to convert, one keystroke
 *      at a time, and they would find out at review.
 *   2. **The language's convention** — Go indents with tabs, Python with four spaces.
 *   3. **The global default** — everything else.
 *
 * Inference decides the STYLE, and the width when that style is spaces. It has no opinion about
 * `tabWidth`, and cannot: how wide a tab is DRAWN is a display preference, invisible in the file
 * (FR-018e). So that always comes from the settings, whatever the file turns out to do.
 *
 * This is also why opening a file must never REFORMAT it (FR-018d): the editor adopts the file's
 * style; it does not impose its own.
 */
export function effectiveIndent(args: {
  /** What the document's existing lines already do — {@link inferIndent}'s answer. */
  inferred: InferredIndent;
  /** The document's resolved language id. */
  languageId: string;
  settings: EditorSettings;
}): IndentProfile {
  const { inferred, languageId, settings } = args;
  const base = settings.indentByLanguage[languageId] ?? settings.indent;

  if (!inferred) return { ...base };
  if (inferred.style === 'tabs') return { ...base, style: 'tabs' };
  return { ...base, style: 'spaces', indentWidth: inferred.width };
}

/** The literal string one indent level inserts — a tab, or N spaces. */
export function indentUnitOf(profile: IndentProfile): string {
  return profile.style === 'tabs' ? '\t' : ' '.repeat(profile.indentWidth);
}
