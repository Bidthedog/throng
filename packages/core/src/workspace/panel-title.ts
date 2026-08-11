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
import type { Panel } from './model.js';

/** The live values a panel's header can name itself from; both absent is normal. */
export interface PanelTitleSources {
  /** The shell's live OSC 0/2 window title (#89), when one has been announced. */
  terminalTitle?: string | null;
  /** The file the editor holds — live editor state first, else the panel's persisted config. */
  editorFilePath?: string | null;
}

/** A source counts only when it has visible characters; a blank one would empty the header. */
function usable(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * The name to show for `panel`, given whatever live sources exist right now.
 *
 * Never returns an empty string: every branch ends at `panel.title`, which the layout guarantees.
 */
export function panelDisplayTitle(panel: Panel, sources: PanelTitleSources = {}): string {
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

  // Untyped: the placeholder is what the placeholder is FOR.
  return panel.title;
}
