/**
 * Name a LIST of panels exactly as each of them names itself (#294).
 *
 * `panelDisplayTitle` has been the one rule since #218, and the tab popover was already calling it
 * — with `undefined` where the live sources go:
 *
 *     panels.map((panel) => panelDisplayTitle(panel, undefined, maxNameLength))
 *
 * With no sources the rule can only fall through to the placeholder, so every automatically named
 * panel was listed wrongly: an editor as "Panel 3" rather than its file, a terminal as its flavour
 * rather than the live window title — which is where a Claude session's name appears, and so the
 * one users most need to read. A manually renamed panel looked right, because an override takes a
 * different branch and needs no sources at all. That is what made it look like a popover quirk
 * rather than a missing argument.
 *
 * ══ WHY A HOOK AND NOT A `.map` AT THE CALL SITE ══
 *
 * The panel header reads its two sources with per-panel hooks (`useTerminalTitle`,
 * `useEditorState`). A popover lists whatever panels a tab holds, so the count varies between
 * renders and per-panel hooks cannot be called in that loop. This subscribes ONCE to each store's
 * version and then reads the values plainly, which is the same information with a fixed number of
 * hook calls.
 */
import {
  defaultPanelTypeRegistry,
  panelDisplayTitle,
  type Panel,
  type PanelTitleSources,
} from '@throng/core';
import { getEditorState, useEditorStateVersion } from '../editor/editor-state.js';
import { useTerminalCommandVersion } from '../terminal/command-store.js';
import { useTerminalCwdVersion } from '../terminal/cwd-store.js';
import { terminalTitleSource, useTerminalTitleContextVersion } from '../terminal/title-context.js';
import { getTerminalTitle, useTerminalTitleVersion } from '../terminal/title-store.js';

/**
 * The file an editor names itself after: the live editor state when it has registered, and the
 * panel's own persisted config otherwise.
 *
 * Both halves matter and the header says why: `setPanelType(editor, …)` writes the path onto the
 * panel synchronously while the live state registers a beat later, so a freshly opened editor has
 * only the config — and a restored editor whose live state has no path yet has only the config too.
 */
function editorFilePath(panel: Panel): string | null {
  const live = getEditorState(panel.id)?.filePath;
  if (typeof live === 'string' && live.length > 0) return live;
  return typeof panel.config?.filePath === 'string' ? panel.config.filePath : null;
}

/**
 * The live sources `panelDisplayTitle` names `panel` from, read from the two stores RIGHT NOW,
 * without subscribing to either.
 *
 * A plain function, not a hook, so a surface that names a panel at a MOMENT rather than on a render
 * — a failure notice raised from a timer or an IPC answer (048 FR-032, T084) — derives exactly the
 * sources the header and this popover do instead of a second copy of them. A caller that renders the
 * name subscribes itself (`useTerminalTitleVersion` / `useEditorStateVersion`), as the hook below does.
 */
export function panelTitleSources(panel: Panel): PanelTitleSources {
  const terminal = terminalTitleSource(panel);
  return {
    terminalTitle: getTerminalTitle(panel.id),
    editorFilePath: editorFilePath(panel),
    // 053 — a terminal is named from the template over its live values (command, directory, title)
    // and the window's settings; `undefined` for any other kind, and before the context is fed.
    ...(terminal ? { terminal } : {}),
  };
}

/**
 * The name `panel` wears at this moment (048 FR-032 / FR-130) — what its header shows, never the
 * raw stored `panel.title`, which is a generated fallback ("Blank Panel 3") that exists only to keep
 * names unique.
 */
export function currentPanelTitle(panel: Panel): string {
  return panelDisplayTitle(panel, panelTitleSources(panel));
}

/** One panel's row in a list that describes a tab. */
export interface PanelListEntry {
  /** The name the panel wears, bounded by `maxNameLength` when one is set. */
  name: string;
  /** Theme icon token for the panel's type, or `null` when it has no type or no icon (#304). */
  icon: string | null;
  /** The type's own name, for the icon's tooltip — an icon alone names nothing. */
  typeLabel: string | null;
}

/**
 * The panel's type, from the REGISTRY (#304).
 *
 * `PanelKind` is `'terminal' | (string & {})` and the panel-type registry is the documented open
 * extension point (005 FR-002), so a hard-coded map here would silently omit the next type someone
 * registers — and omit it in the one surface whose job is to say what a tab contains.
 *
 * The label is taken verbatim rather than shortened: the panel header's own kind marker shows the
 * same registry string (asserted in `editor-basics.e2e.ts:44`), and two surfaces naming one thing
 * differently is exactly #294.
 *
 * ══ AN UNTYPED PANEL GETS NEITHER ══
 *
 * It has no type — the "Select Panel Type" form is what it is showing — and its NAME is already the
 * bare placeholder, so the row is just `Panel 4` with no icon, and that absence is the information.
 */
function panelType(panel: Panel): { icon: string | null; typeLabel: string | null } {
  if (panel.kind === undefined) return { icon: null, typeLabel: null };
  const desc = defaultPanelTypeRegistry.get(panel.kind);
  if (desc === undefined) return { icon: null, typeLabel: null };
  return { icon: desc.icon ?? null, typeLabel: desc.label };
}

/**
 * Each panel's row, in the order given: what it is called, and what type it is.
 *
 * `maxNameLength` bounds the NAME and nothing else. The bound exists so a shell announcing a
 * 400-character window title cannot widen the strip or this surface; an icon is a fixed size and
 * cannot.
 */
export function usePanelDisplayNames(panels: Panel[], maxNameLength?: number): PanelListEntry[] {
  // Subscribe to both stores. The values are read below rather than returned from these, so the
  // number of hook calls does not depend on how many panels there are.
  useTerminalTitleVersion();
  useEditorStateVersion();
  // 053 FR-013 — and the other sources of a terminal's templated name.
  useTerminalCommandVersion();
  useTerminalCwdVersion();
  useTerminalTitleContextVersion();

  return panels.map((panel) => ({
    name: panelDisplayTitle(panel, panelTitleSources(panel), maxNameLength),
    ...panelType(panel),
  }));
}
