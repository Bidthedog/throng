/**
 * Which name a Panel wears (#218) — one rule, in one place, pure.
 *
 * > A panel follows its terminal's name or its file's name, **unless** it is untyped (the
 * > "Select Panel Type" screen is showing) — in which case its placeholder title stands.
 *
 * 048 FR-032 removed the other exception, a user's own rename: a panel is always named by what it
 * holds (panel renaming is gone, and old custom titles migrate away — `panel-title-migration.ts`).
 *
 * This lived as a nested ternary inside the panel header's JSX, which had two costs. It could only
 * be asserted by launching the whole application, so the rule itself was never tested — only its
 * happy paths, through four E2E specs that each re-derived it. And each panel kind had exactly ONE
 * automatic source, falling through to the placeholder the moment that source was empty: a typed
 * panel then showed "Panel X" with a terminal or a file plainly in it, which is the state the rule
 * above says cannot exist.
 *
 * Hence the SECONDARY sources. A terminal's flavour is known from the moment its type is confirmed —
 * before the shell has had any chance to announce a window title — so it names the panel in the gap,
 * and keeps naming it if the announcement never comes. An editor's path comes from the live editor
 * when it has registered and from the panel's own config before that (and if the live state ever
 * lacks one), so a restored editor names itself from what was persisted.
 */
import { editorAutoTitle } from '../editor/path-display.js';
import { FIND_IN_FILES_KIND, findInFilesPanelType } from '../find-in-files/panel-type.js';
import { PREVIEW_KIND } from '../preview/panel-type.js';
import { commandDisplay } from '../terminal/command-capture.js';
import {
  DEFAULT_TERMINAL_TITLE_TEMPLATE,
  parseTitleTemplate,
  renderTitleTemplate,
  type TitleTemplate,
} from '../terminal/title-template.js';
import { countGraphemes, truncateGraphemes } from '../text/grapheme.js';
import { lastFolder, shortenEnd, shortenPath } from '../text/path-shorten.js';
import type { Panel, PreviewPanelConfig } from './model.js';
import { previewPathOf } from './persisted-paths.js';
import { BLANK_PANEL_NAME, isDefaultPanelName } from './unique-name.js';

/** The live values a panel's header can name itself from; all absent is normal. */
export interface PanelTitleSources {
  /** The shell's live OSC 0/2 window title (#89), when one has been announced. */
  terminalTitle?: string | null;
  /** The file the editor holds — live editor state first, else the panel's persisted config. */
  editorFilePath?: string | null;
  /**
   * What a PARENTED preview's parent editor currently displays (044 FR-031).
   * Absent or blank means the preview is standalone. An input rather than a lookup: a preview stores
   * no link to an editor (FR-013), so whoever knows the parent hands its title in.
   */
  previewParentTitle?: string | null;
  /** The file a preview currently shows — live state first; the persisted config is the fallback. */
  previewFilePath?: string | null;
  /**
   * 054 FR-005 — the preview's panel type label ("Markdown Preview"), named when it has no file to be
   * named after. An input rather than a lookup, as `previewParentTitle` is: the provider registry is the
   * caller's, not this rule's.
   */
  previewTypeLabel?: string | null;
  /**
   * 053 FR-001 — what a terminal panel's name is rendered from: the live values, the template as
   * text (its parse is memoised here) and the two shortening limits (FR-012). Absent → the terminal
   * is named as before 053, by its window title or its shell, so a caller that does not pass it is
   * unchanged.
   */
  terminal?: {
    values: TerminalTitleValues;
    template: string;
    limits: { command: number; path: number };
  };
}

/**
 * The raw values a terminal's name is rendered from (053 data-model.md). Raw on purpose: core derives
 * `{command}` and `{app}` from the observed command line and `{path}` / `{folder}` from the
 * directory, so every surface shortens and names them the same way.
 */
export interface TerminalTitleValues {
  /** The observed command line, as the OS reported it; absent or null while nothing runs. */
  command?: string | null;
  /** The running program's architecture — `x64`, `x86`, `arm64`. */
  arch?: string | null;
  /** The window title the program or shell set (OSC 0/2). */
  title?: string | null;
  /** The shell's label, else its flavour id. */
  shell: string;
  /** The working directory, as the daemon or the shell's OSC 9;9 reported it. */
  cwd?: string | null;
  /** The owning project's name; for a sub-workspace's panel, the sub-workspace's. */
  project?: string | null;
  /** Whether the terminal runs elevated — `{admin}` renders `Admin`. */
  admin: boolean;
}

/**
 * What every preview's name ends with (044 FR-031). Never truncated (FR-032): it is the half of the
 * name that says what the panel IS, and a long file name gives way to it.
 */
export const PREVIEW_TITLE_SUFFIX = ' - Preview';

/**
 * What a Find in Files panel is called while its replace row is DISCLOSED (043 FR-081).
 *
 * The panel type's own label — "Find in Files" — is the other half of the pair and stays where it
 * is, in the type descriptor, because it names the TYPE: it is the New Panel entry's label and the
 * panel-type icon descriptor's. This one names a panel in one of its states, so it lives here, with
 * the rule that chooses between them. Title case throughout, matching the shipped label.
 */
const FIND_AND_REPLACE_IN_FILES_TITLE = 'Find & Replace in Files';

/** A source counts only when it has visible characters; a blank one would empty the header. */
function usable(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * The name to show for `panel`, given whatever live sources exist right now, bounded by
 * `maxNameLength` when one is given (031, FR-037, N8).
 *
 * The bound is applied to the RESULT rather than to each source, which is the whole reason it lives
 * here. #218 made this function the one place a panel's name is decided, so a shell announcing a
 * 400-character window title, a file with a very long stem and a long placeholder title all leave
 * through the same return — and each of them is a name that must fit the tab strip. Capping in the
 * header component instead would bound whichever source that component happened to be rendering.
 *
 * Omitting `maxNameLength` leaves the name unbounded, so callers that have no limit to apply — and
 * every caller that predates the setting — behave exactly as they did.
 *
 * ══ ONE EXCEPTION TO THE BOUND: A PREVIEW AT A SHORT LIMIT (044 FR-032) ══
 *
 * A preview's title is `<name> - Preview`, the suffix is never cut, and the name keeps at least one
 * character. So at a `maxNameLength` of 10 or less — the suffix's own length, and the setting's
 * minimum is 10 — the result is LONGER than the limit by the name characters that remain. That
 * supersedes 031 FR-037's hard bound for preview titles only: " - Preview" alone names nothing. A
 * header that marks truncation must mark the NAME, not the end of the title; it gets the two halves
 * apart from {@link previewTitleParts}.
 *
 * Never returns an empty string: every branch ends at `panel.title`, which the layout guarantees,
 * and `truncateGraphemes` cannot empty a non-empty name at any limit of one or more.
 */
export function panelDisplayTitle(
  panel: Panel,
  sources: PanelTitleSources = {},
  maxNameLength?: number,
): string {
  const parts = previewTitleParts(panel, sources, maxNameLength);
  if (parts !== null) return `${parts.name}${parts.suffix}`;
  const title = resolveTitle(panel, sources);
  return maxNameLength === undefined ? title : truncateGraphemes(title, maxNameLength);
}

/** A preview title in its two halves (044 FR-032). */
export interface PreviewTitleParts {
  /** The name half, already bounded — the part a truncation marker belongs on. */
  name: string;
  /** Always {@link PREVIEW_TITLE_SUFFIX}, whole. */
  suffix: string;
  /** Whether `name` was shortened to fit, so the header draws `name… - Preview`. */
  nameTruncated: boolean;
}

/**
 * The halves of the title {@link panelDisplayTitle} gives a preview, or `null` for any panel it does
 * not compose one for — another kind, or a preview with no file yet (the
 * placeholder). `name + suffix` is always exactly `panelDisplayTitle`'s result, which is what lets a
 * header render the marker between them without deciding anything about the title itself.
 */
export function previewTitleParts(
  panel: Panel,
  sources: PanelTitleSources = {},
  maxNameLength?: number,
): PreviewTitleParts | null {
  const full = previewName(panel, sources);
  if (full === null) return null;
  const name = boundPreviewName(full, maxNameLength);
  return { name, suffix: PREVIEW_TITLE_SUFFIX, nameTruncated: name !== full };
}

/**
 * The NAME half of a preview's title (044 FR-031), or `null` when this is not a preview or it has no
 * file to be named after — which falls through to the placeholder like any other panel.
 *
 * Parented: whatever the parent editor displays. Standalone: the name an editor would derive for the
 * file, from the live path first and the persisted config second — `previewPathOf`, so a restored
 * preview names itself after the same file it attaches to.
 */
function previewName(panel: Panel, sources: PanelTitleSources): string | null {
  if (panel.kind !== PREVIEW_KIND) return null;
  const parent = usable(sources.previewParentTitle);
  if (parent) return parent;
  const path =
    usable(sources.previewFilePath) ?? previewPathOf(panel.config as PreviewPanelConfig | undefined);
  return path ? editorAutoTitle(path) : null;
}

/**
 * A preview's NAME half, shortened so that name plus suffix fits `maxNameLength` (044 FR-032).
 *
 * The limit applies to the whole title wherever it leaves room for a name at all. At or below the
 * suffix's own length — and `tabs.maxNameLength`'s minimum, 10, is exactly that length — the name
 * keeps one character and the title runs over by it, as the amended FR-032 sanctions.
 */
function boundPreviewName(name: string, maxNameLength: number | undefined): string {
  if (maxNameLength === undefined) return name;
  const budget = Math.max(1, Math.floor(maxNameLength) - countGraphemes(PREVIEW_TITLE_SUFFIX));
  return truncateGraphemes(name, budget);
}

/** The unbounded precedence — the #218 rule itself, unchanged by the limit that now wraps it. */
/**
 * The name a panel falls back to when nothing it holds names it (048 FR-130): its stored title, except
 * that a GENERATED one ("Blank Panel 2", or a legacy "Panel 3") is shown as plain "Blank Panel". The
 * number exists only to keep stored names unique (FR-033); the user never needs to see it.
 */
function fallbackTitle(panel: Panel): string {
  return isDefaultPanelName(panel.title) ? BLANK_PANEL_NAME : panel.title;
}

/**
 * Parsed templates by text (053 T010). Every panel and every render asks for the same one or two
 * templates, so each is parsed once. An unparsable text maps to the default's parse (FR-008: a
 * persisted invalid template renders as the default). Cleared rather than evicted when it grows —
 * only a user typing templates one after another could fill it.
 */
const PARSED_TEMPLATES = new Map<string, TitleTemplate>();
const MAX_PARSED_TEMPLATES = 32;

function compiledTemplate(text: string): TitleTemplate {
  const cached = PARSED_TEMPLATES.get(text);
  if (cached) return cached;
  const parsed = parseTitleTemplate(text);
  const root = parsed.ok ? parsed.root : compiledTemplate(DEFAULT_TERMINAL_TITLE_TEMPLATE);
  if (PARSED_TEMPLATES.size >= MAX_PARSED_TEMPLATES) PARSED_TEMPLATES.clear();
  PARSED_TEMPLATES.set(text, root);
  return root;
}

/**
 * An absolute Windows path to a program, anywhere in a window title. cmd titles itself
 * `C:\WINDOWS\system32\cmd.exe - ping …`, and elevated shells prefix `Administrator: `.
 */
const EXECUTABLE_PATH = /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*([^\\/:*?"<>|\r\n]+?)\.(?:exe|com|bat|cmd)\b/gi;

/** 053 FR-011 — `{title}` names a program the way `{app}` does: by its bare name, never its full path. */
function withoutExecutablePaths(title: string): string {
  return title.replace(EXECUTABLE_PATH, '$1');
}

/**
 * A terminal's name from its template (053 FR-001, FR-003, FR-012). Trimmed; an empty render names
 * the panel by its shell, as `{shell}` alone would. `null` only when there is not even a shell to
 * name it by, so the caller's own fallback applies.
 */
function terminalTemplateTitle(panel: Panel, source: NonNullable<PanelTitleSources['terminal']>): string | null {
  const { values, template, limits } = source;
  const shell =
    usable(values.shell) ?? usable(panel.config?.flavourLabel) ?? usable(panel.config?.flavourId) ?? '';
  const { command, app } = commandDisplay(values.command ?? '');
  const cwd = values.cwd ?? '';
  const rendered = renderTitleTemplate(compiledTemplate(template), {
    command: shortenEnd(command, limits.command),
    app,
    arch: values.arch ?? '',
    title: withoutExecutablePaths(values.title ?? ''),
    shell,
    path: shortenPath(cwd, limits.path),
    folder: lastFolder(cwd),
    project: values.project ?? '',
    admin: values.admin ? 'Admin' : '',
  }).trim();
  return usable(rendered) ?? usable(shell);
}

function resolveTitle(panel: Panel, sources: PanelTitleSources): string {
  if (panel.kind === 'terminal') {
    if (sources.terminal) {
      const named = terminalTemplateTitle(panel, sources.terminal);
      if (named) return named;
    }
    const live = usable(sources.terminalTitle);
    if (live) return live;
    // Prefer the captured flavour LABEL ("Command Prompt"); fall back to the flavour id for panels
    // typed before the label was persisted, exactly as the header's type icon does.
    const label = usable(panel.config?.flavourLabel) ?? usable(panel.config?.flavourId);
    return label ?? fallbackTitle(panel);
  }

  if (panel.kind === 'editor') {
    const path = usable(sources.editorFilePath);
    return path ? editorAutoTitle(path) : fallbackTitle(panel);
  }

  /*
   * Find in Files (043 FR-060) — the one kind whose name never falls through to the placeholder.
   *
   * A search panel with no term yet is still plainly a search panel, so "Panel 7" is wrong at every
   * moment of its life rather than only once a term exists. The label comes from the panel type's
   * own descriptor, which is already what the header's icon and type label resolve through, so the
   * name is stated once.
   *
   * The term is read from `panel.config` and needs NO new `PanelTitleSources` field (R30): the panel
   * writes all five query fields there on every change, and the editor branch above already treats
   * `panel.config` as a legitimate source. A third live source would be a second copy of a value the
   * panel persists anyway — free to disagree with the one the restore path reads.
   *
   * Nothing here truncates the term. `panelDisplayTitle` bounds its RESULT, which is the whole
   * reason #218 put the rule in one function: a 400-character term is capped by exactly the
   * mechanism that caps a 400-character shell title.
   */
  if (panel.kind === FIND_IN_FILES_KIND) {
    /*
     * FR-081 — and the name says whether REPLACE is disclosed.
     *
     * Read exactly as the term is, off `panel.config`, and for the same reason (R30): `replaceShown`
     * is already persisted there — `findInFilesConfigOf` writes it on every change and
     * `findInFilesQueryFrom` reads it back — so `PanelTitleSources` gains no field and there is no
     * second live copy free to disagree with the one the restore path uses.
     *
     * `=== true` rather than a truthiness test, matching `findInFilesQueryFrom`'s own read: `config`
     * is `Record<string, unknown>` on disk, and "the replace row is open" is not something to infer
     * from a non-empty string a restored blob happens to hold.
     *
     * The find-and-replace form is a LITERAL rather than a derivation of the type's label, and that
     * is the point of FR-081's last clause: `findInFilesPanelType.label` is also the New Panel
     * entry's label and the type icon descriptor's, so it must not move — a menu entry cannot read
     * "Find & Replace in Files" because some panel elsewhere has its replace row open. The composed
     * string belongs to the PANEL, so it is composed here, where a panel's name is decided.
     */
    const label = panel.config?.replaceShown === true
      ? FIND_AND_REPLACE_IN_FILES_TITLE
      : findInFilesPanelType.label;
    const term = usable(panel.config?.term);
    return term === null ? label : `${label}: ${term}`;
  }

  // 054 FR-005 — a preview with no file to be named after is still plainly a preview of its type.
  if (panel.kind === PREVIEW_KIND) return usable(sources.previewTypeLabel) ?? fallbackTitle(panel);

  // Untyped: the placeholder is what the placeholder is FOR.
  return fallbackTitle(panel);
}
