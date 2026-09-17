/**
 * Which name a Panel wears (#218) — one rule, in one place, pure.
 *
 * > A panel follows its terminal's name or its file's name, **unless** it is untyped (the
 * > "Select Panel Type" screen is showing) **or** the user has manually renamed it — in which case
 * > the override stands.
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
import { countGraphemes, truncateGraphemes } from '../text/grapheme.js';
import type { Panel, PreviewPanelConfig } from './model.js';
import { previewPathOf } from './persisted-paths.js';

/** The live values a panel's header can name itself from; all absent is normal. */
export interface PanelTitleSources {
  /** The shell's live OSC 0/2 window title (#89), when one has been announced. */
  terminalTitle?: string | null;
  /** The file the editor holds — live editor state first, else the panel's persisted config. */
  editorFilePath?: string | null;
  /**
   * What a PARENTED preview's parent editor currently displays, custom or derived (044 FR-031).
   * Absent or blank means the preview is standalone. An input rather than a lookup: a preview stores
   * no link to an editor (FR-013), so whoever knows the parent hands its title in.
   */
  previewParentTitle?: string | null;
  /** The file a preview currently shows — live state first; the persisted config is the fallback. */
  previewFilePath?: string | null;
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
 * 400-character window title, a file with a very long stem and a name the user typed all leave
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
 * not compose one for — another kind, a renamed panel, or a preview with no file yet (the
 * placeholder). `name + suffix` is always exactly `panelDisplayTitle`'s result, which is what lets a
 * header render the marker between them without deciding anything about the title itself.
 */
export function previewTitleParts(
  panel: Panel,
  sources: PanelTitleSources = {},
  maxNameLength?: number,
): PreviewTitleParts | null {
  const full = panel.titleIsCustom ? null : previewName(panel, sources);
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
function resolveTitle(panel: Panel, sources: PanelTitleSources): string {
  // A name the user typed outranks everything, and survives a change of file or shell (#89/#97).
  if (panel.titleIsCustom) return panel.title;

  if (panel.kind === 'terminal') {
    const live = usable(sources.terminalTitle);
    if (live) return live;
    // Prefer the captured flavour LABEL ("Command Prompt"); fall back to the flavour id for panels
    // typed before the label was persisted, exactly as the header's type icon does.
    const label = usable(panel.config?.flavourLabel) ?? usable(panel.config?.flavourId);
    return label ?? panel.title;
  }

  if (panel.kind === 'editor') {
    const path = usable(sources.editorFilePath);
    return path ? editorAutoTitle(path) : panel.title;
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

  // Untyped: the placeholder is what the placeholder is FOR.
  return panel.title;
}
