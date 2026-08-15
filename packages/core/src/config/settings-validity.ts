/**
 * What is wrong with this settings document, in words a user can act on (032, FR-019/FR-019a).
 * Pure — no OS, no DOM, no filesystem.
 *
 * ══ WHY THIS EXISTS ══
 *
 * The JSON editor could say two things: "Invalid JSON — not applied", or nothing. Neither tells a
 * user what to change. The information needed to say it has been sitting in `SETTINGS_METADATA` all
 * along — every enumerated setting declares its `allowedValues`, every bounded one its range — and
 * the settings FORM already reads it to build its controls. The JSON editor simply never asked.
 *
 * So this reads the same registry the form reads. That is the point rather than a convenience: a
 * second list of allowed values would be a second thing to keep in step, and it would be wrong the
 * first time someone added an option.
 *
 * ══ WHAT IT DELIBERATELY DOES NOT DO ══
 *
 * It does not correct anything. The bounds guard corrects on READ, which is right for a document
 * being loaded and wrong for one being typed: silently clamping what the user is halfway through
 * writing is how the caret got pulled out from under them in the first place. This reports, and the
 * user fixes it.
 */
import { DEFAULT_APP_SETTINGS } from './app-settings.js';
import { getAtPath, type FieldDescriptor } from './metadata.js';
import { SETTINGS_METADATA } from './settings-metadata.js';

/**
 * One thing wrong with the document, named the way the user would name it.
 *
 * The parts are kept SEPARATE rather than pre-joined into a sentence, because the two surfaces that
 * render them want different things: the notice italicises the key, and the clipboard wants plain
 * text. A single formatted string would force one of them to unpick it.
 */
export interface SettingsProblem {
  /** Dotted path of the offending value, e.g. `panes.projects.maxWidth`. */
  key: string;
  /** The setting's human label from the registry, so the message is not a field name. */
  label: string;
  /** What is wrong, as a sentence fragment: "must be one of: …", "must be between …". */
  reason: string;
  /** The value found, for the message. */
  found: unknown;
  /** The value found, ready to read — quoted if it is a string, so `""` is visible as a value. */
  foundText: string;
}

export type SettingsValidity =
  /** The document does not parse at all. Nothing else can be said about it. */
  | { kind: 'unparseable'; message: string; position?: number; line?: number; column?: number }
  /** It parses but is not a JSON object, so no key of it can be addressed. */
  | { kind: 'not-an-object'; message: string }
  /** It parses, and these values are outside what the registry declares. Empty means valid. */
  | { kind: 'checked'; problems: SettingsProblem[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Where the parse gave up, in line/column the editor can point at.
 *
 * `JSON.parse`'s message carries a character offset ("at position 42"), and modern V8 adds
 * "(line 3 column 7)" outright. Both are parsed opportunistically: the position is genuinely useful
 * — a document with one stray brace is otherwise a hunt — and where the engine does not supply it,
 * saying so plainly beats inventing one.
 */
function locate(message: string, text: string): { position?: number; line?: number; column?: number } {
  const lineColumn = /line (\d+) column (\d+)/.exec(message);
  if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) };

  const positionMatch = /position (\d+)/.exec(message);
  if (!positionMatch) return {};
  const position = Number(positionMatch[1]);
  // Derive line/column from the offset ourselves, because an offset into a 200-line document is not
  // something a person can act on.
  const before = text.slice(0, position);
  const line = before.split('\n').length;
  const column = position - (before.lastIndexOf('\n') + 1) + 1;
  return { position, line, column };
}

/** The bound a descriptor actually enforces — the control's range unless a hard bound overrides it. */
function boundsOf(d: FieldDescriptor): { lo?: number; hi?: number } {
  return { lo: d.hardMin ?? d.min, hi: d.hardMax ?? d.max };
}

/** Format a value for a message without dumping a whole object into it. */
function show(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value === undefined) return 'nothing';
  if (isRecord(value) || Array.isArray(value)) return Array.isArray(value) ? 'a list' : 'an object';
  return String(value);
}

/**
 * Check one value against one descriptor. `null` when there is nothing wrong with it.
 *
 * ABSENCE IS NOT A PROBLEM, which is the same rule the bounds guard opens by stating. A key the
 * document simply omits takes its shipped default, and reporting it would make every settings file
 * written before a release that adds a setting "invalid" — locking the user out of the editor over
 * a document that works perfectly.
 */
function checkValue(d: FieldDescriptor, value: unknown): SettingsProblem | null {
  if (value === undefined) return null;

  const problem = (reason: string): SettingsProblem => ({
    key: d.key,
    label: d.label,
    reason,
    found: value,
    foundText: show(value),
  });

  const { lo, hi } = boundsOf(d);
  if (typeof lo === 'number' || typeof hi === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return problem(`must be a number${rangeText(lo, hi)}`);
    }
    if (typeof lo === 'number' && value < lo) return problem(`must be${rangeText(lo, hi)}`);
    if (typeof hi === 'number' && value > hi) return problem(`must be${rangeText(lo, hi)}`);
    return null;
  }

  /*
   * An `allowedValues` set is checked only when one is DECLARED and non-empty.
   *
   * `editor.languageByExtension`'s column is a select with no declared set, because its valid values
   * are the languages known at runtime rather than a static list. Treating "no set" as "empty set"
   * would report every user mapping as invalid and make the document unleavable.
   */
  if (d.allowedValues && d.allowedValues.length > 0) {
    if (!d.allowedValues.includes(value as string | number)) {
      // The options are listed UNQUOTED and the found value IS quoted, so the two cannot be confused
      // at a glance: `must be one of: none, single, double. Found "doubles".` The quotes are doing
      // work — they make a trailing space or an empty string visible rather than invisible.
      return problem(`must be one of: ${d.allowedValues.join(', ')}`);
    }
    return null;
  }

  const shipped = getAtPath(DEFAULT_APP_SETTINGS, d.key);
  if (typeof shipped === 'boolean' && typeof value !== 'boolean') {
    return problem('must be true or false');
  }

  return null;
}

function rangeText(lo?: number, hi?: number): string {
  if (typeof lo === 'number' && typeof hi === 'number') return ` between ${lo} and ${hi}`;
  if (typeof lo === 'number') return ` at least ${lo}`;
  if (typeof hi === 'number') return ` at most ${hi}`;
  return '';
}

/**
 * Check a settings document's TEXT, reporting every value the registry says is wrong.
 *
 * Every problem, not the first — a user fixing one value at a time, each round trip revealing the
 * next, is the worst version of this. The registry is walked rather than the document, so an
 * unknown key is simply not this function's business (a hand-added key is legitimate, and the write
 * path preserves it).
 *
 * Table-shaped settings (`control: 'map'`) are not descended into. Their columns declare per-cell
 * rules, and reporting `editor.indentByLanguage.python.indentWidth` by name is a level of detail
 * this notice does not need to reach in order to be useful — the bounds guard still corrects those
 * on read. Stated here rather than left implicit, because a reader will otherwise assume it was
 * missed.
 */
/** Facts the checker cannot derive from the registry, because they are true only at run time. */
export interface SettingsCheckContext {
  /**
   * The themes that actually exist on disk.
   *
   * `appearance.theme` is a `select` whose valid values are "the themes on disk (populated at
   * runtime)", so the registry declares NO `allowedValues` for it — correctly, since it cannot know
   * them. That left the one settings value whose valid set is genuinely dynamic entirely unchecked,
   * and a name that named nothing sailed through as valid.
   *
   * Omitted or empty means "not known yet", and nothing is checked. Permissive on purpose: the list
   * arrives over IPC after the editor mounts, and blocking the user during that gap would report a
   * problem that does not exist.
   */
  knownThemes?: readonly string[];
}

export function checkSettingsText(text: string, context?: SettingsCheckContext): SettingsValidity {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'unparseable', message, ...locate(message, text) };
  }

  if (!isRecord(parsed)) {
    return {
      kind: 'not-an-object',
      message: 'The document must be a JSON object — it starts with { and ends with }.',
    };
  }

  const problems: SettingsProblem[] = [];
  for (const d of SETTINGS_METADATA) {
    if (d.control === 'map' || (d.columns?.length ?? 0) > 0) continue;
    const problem = checkValue(d, getAtPath(parsed, d.key));
    if (problem) problems.push(problem);
  }

  const themeProblem = checkActiveTheme(parsed, context?.knownThemes);
  if (themeProblem) problems.push(themeProblem);

  return { kind: 'checked', problems };
}

/**
 * `appearance.theme` must name a theme that EXISTS (032, FR-019c).
 *
 * ══ WHY THIS IS NOT PART OF THE REGISTRY WALK ══
 *
 * Every other check above is registry-driven, which is what makes a newly added setting guarded
 * because it declared a bound rather than because somebody remembered it. This one cannot be: the
 * valid set is the themes on disk, and the registry — correctly — declares no `allowedValues` for a
 * list it cannot know.
 *
 * So it is the one hand-written check here, and it earns that by being the one setting whose valid
 * set is genuinely dynamic.
 *
 * ══ WHY IT MATTERS MORE THAN A WRONG VALUE USUALLY DOES ══
 *
 * A theme name that names nothing does not merely produce a wrong colour. The Themes tab's JSON
 * document IS the active theme's file, so an active theme with no file leaves that editor open on an
 * empty, unparseable buffer the user never touched — and every exit refused, including *Discard and
 * close*. Reported as: "the user is stuck on the Themes page forever. The only way out is closing
 * throng entirely."
 *
 * The user cannot create a theme from this editor, only select one that exists — so refusing the
 * name is refusing something that was never possible, not withdrawing a capability.
 */
function checkActiveTheme(
  parsed: Record<string, unknown>,
  knownThemes: readonly string[] | undefined,
): SettingsProblem | null {
  // Not known yet → nothing checked. See `SettingsCheckContext.knownThemes`.
  if (!knownThemes || knownThemes.length === 0) return null;

  const value = getAtPath(parsed, 'appearance.theme');
  // Absence is not malformation, here as everywhere: an omitted theme takes the shipped default.
  if (value === undefined) return null;
  if (typeof value === 'string' && knownThemes.includes(value)) return null;

  // The label comes from the registry rather than being spelled again here, so the notice reads the
  // way the row in the form reads.
  const label = SETTINGS_METADATA.find((d) => d.key === 'appearance.theme')?.label ?? 'Theme';
  return {
    key: 'appearance.theme',
    label,
    reason: `must be one of: ${knownThemes.join(', ')}`,
    found: value,
    foundText: show(value),
  };
}

/** True iff the document may be left as it stands (FR-018). */
export function isSettingsTextValid(text: string, context?: SettingsCheckContext): boolean {
  const validity = checkSettingsText(text, context);
  return validity.kind === 'checked' && validity.problems.length === 0;
}

/**
 * One problem as a single plain-text line.
 *
 * `"Remove a project" (confirmations.destroyProject) must be one of: none, single, double. Found
 * "doubles".`
 *
 * The label is quoted because it is prose the user recognises from the form; the key is bare because
 * it is what they must find in the file. A surface with rich text italicises the key and otherwise
 * renders exactly this — one wording, two presentations, rather than two wordings that drift.
 */
export function formatSettingsProblem(problem: SettingsProblem): string {
  return `"${problem.label}" (${problem.key}) ${problem.reason}. Found ${problem.foundText}.`;
}

/**
 * The whole notice, as lines: one line per offending value.
 *
 * Returned as data rather than as a rendered string so the caller decides the markup, and so a test
 * can assert on the individual lines rather than on a paragraph.
 */
export function describeSettingsValidity(validity: SettingsValidity): string[] {
  switch (validity.kind) {
    case 'unparseable': {
      const where =
        validity.line !== undefined && validity.column !== undefined
          ? ` at line ${validity.line}, column ${validity.column}`
          : '';
      // The parser's own message is kept: it names the character it did not expect, which is the
      // one fact a person needs and the one we cannot reconstruct.
      return [`This is not valid JSON${where}.`, validity.message];
    }
    case 'not-an-object':
      return [validity.message];
    case 'checked':
      return validity.problems.map(formatSettingsProblem);
  }
}
