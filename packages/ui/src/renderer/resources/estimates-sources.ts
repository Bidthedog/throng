/**
 * Where the estimates reporter gets its figures (055 FR-024, FR-024b, research R9): this window's layout
 * and the registries of live editor views and terminal buffers, turned into a `WorkspaceContext` and the
 * renderer's share of each panel's memory.
 *
 * Only the renderer's part is here. A document's text lives in UI main, which adds its own figure per
 * document (and says which linked panel owns it); the daemon's scrollback is the daemon's. The `pid` of
 * a renderer estimate is left `0` — the renderer cannot know its own OS process id, and main stamps it
 * from the sending window's web contents.
 */
import {
  PREVIEW_KIND,
  collectPanels,
  editorRendererBytes,
  extrapolatedNodes,
  previewRendererBytes,
  terminalRendererBytes,
  type Panel,
  type Tab,
  type WorkspaceLayout,
} from '@throng/core';
import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import type { ProjectDto } from '@throng/ipc-contract';
import type {
  PanelEstimate,
  WorkspaceContext,
  WorkspaceContextPanel,
  WorkspaceContextProject,
  WorkspaceContextTab,
} from '@throng/ipc-contract';
import { getEditorView } from '../editor/editor-views.js';
import { getPreviewState } from '../preview/preview-store.js';
import { getTerminalBufferSize } from '../terminal/buffer-registry.js';
import { sampleSyntaxTree } from './syntax-tree-size.js';
import { currentPanelTitle } from '../workspace/use-panel-display-names.js';

export interface WorkspaceFacts {
  readonly projects: readonly ProjectDto[];
  readonly activeProjectId: string | null;
  readonly loadedIds: ReadonlySet<string>;
  /** This window's layout; `null` before it has loaded. */
  readonly layout: WorkspaceLayout | null;
  /** Which sub-workspace this window is, if it is one (its tabs name it). */
  readonly subWorkspaceName: string | null;
  /**
   * The saved layouts of the projects this window is NOT showing (T092), by project id: what the context
   * needs to place their tabs and panels. Only the main window reads them; a sub-workspace window has none.
   */
  readonly otherLayouts?: ReadonlyMap<string, WorkspaceLayout>;
}

/**
 * The project a tab belongs to for the hierarchy: the one most of its panels came from (a sub-workspace
 * tab may mix projects, and its own layout names none — T090), else the layout's. A project throng does
 * not know — a deleted one, a terminal with no project — is `null`: the "No project" group (T099).
 */
function tabProject(panels: readonly Panel[], layoutProject: string, known: ReadonlySet<string>): string | null {
  const counts = new Map<string, number>();
  for (const p of panels) counts.set(p.originProjectId, (counts.get(p.originProjectId) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, n] of counts) {
    if (n > bestCount) {
      best = id;
      bestCount = n;
    }
  }
  const id = best ?? layoutProject;
  return known.has(id) ? id : null;
}

/** Every project, and the tabs and panels this window has open (FR-020c). */
export function buildWorkspaceContext(facts: WorkspaceFacts): WorkspaceContext {
  const projects: WorkspaceContextProject[] = facts.projects.map((p, listOrder) => ({
    id: p.id,
    name: p.name,
    state: p.id === facts.activeProjectId ? 'active' : facts.loadedIds.has(p.id) ? 'loaded' : 'unloaded',
    listOrder,
  }));
  const known = new Set(facts.projects.map((p) => p.id));
  const tabs: WorkspaceContextTab[] = [];
  const panels: WorkspaceContextPanel[] = [];

  /** Add one layout's tabs and panels. `mounted` is whether THIS window has them open. */
  const add = (layout: WorkspaceLayout, mounted: boolean, only?: (tab: Tab) => boolean): void => {
    for (const tab of layout.tabs) {
      if (only !== undefined && !only(tab)) continue;
      const tabPanels = collectPanels(tab.root);
      tabs.push({
        id: tab.id,
        projectId: tabProject(tabPanels, layout.projectId, known),
        name: tab.title,
        subWorkspaceName: facts.subWorkspaceName,
        mounted,
      });
      for (const panel of tabPanels) {
        if (only !== undefined && panel.kind !== 'terminal') continue;
        panels.push({
          id: panel.id,
          tabId: tab.id,
          projectId: known.has(panel.originProjectId) ? panel.originProjectId : null,
          // The name its own header shows (D2): the live sources, as #294 fixed for the tab popover.
          name: currentPanelTitle(panel),
          kind: panel.kind ?? 'untyped',
          mounted,
        });
      }
    }
  };

  // Everything in a layout this window holds is mounted in this window.
  if (facts.layout !== null) add(facts.layout, true);

  // The other projects' tabs and panels exist, and show, but are not open here (T092). A loaded project
  // keeps all of them; an unloaded one keeps only what a kept terminal can be in: its terminal panels, and
  // the tabs holding one — a layout cannot say a shell is still running, the roster places it.
  if (facts.subWorkspaceName === null && facts.otherLayouts !== undefined) {
    for (const [projectId, layout] of facts.otherLayouts) {
      if (projectId === facts.activeProjectId || layout === facts.layout) continue;
      if (facts.loadedIds.has(projectId)) add(layout, false);
      else add(layout, false, (tab) => collectPanels(tab.root).some((p) => p.kind === 'terminal'));
    }
  }
  return { projects, tabs, panels };
}

/**
 * The saved layouts of `projectIds`, read from the daemon through the workspace client the renderer
 * already has (T092 — no new IPC). A project with no saved layout is left out (`restored` is false: the
 * daemon returns a synthesised empty one, which holds nothing), and so is one whose read fails — the
 * monitor then simply lacks that project's tabs this time, and the next report tries again.
 */
export async function loadOtherLayouts(
  projectIds: readonly string[],
  load: (projectId: string) => Promise<{ layout: WorkspaceLayout; restored: boolean }>,
): Promise<Map<string, WorkspaceLayout>> {
  const out = new Map<string, WorkspaceLayout>();
  const results = await Promise.all(projectIds.map((id) => load(id).then((r) => [id, r] as const, () => null)));
  for (const entry of results) if (entry !== null && entry[1].restored) out.set(entry[0], entry[1].layout);
  return out;
}

/**
 * What a preview panel's estimate reads: the elements it has rendered, the spans among them, and the
 * length of the source it rendered. The length comes from the preview store, where it is a string's
 * `length` — the rendered `textContent` cost a string as long as the document on every read (25 ms on a
 * 5 MB preview). The counts are walks of the panel's elements: ~35 ns an element each, 14 ms on the
 * largest preview calibrated (404,000 elements).
 */
function previewDomSize(panelId: string): { elements: number; spans: number; sourceChars: number } | undefined {
  const root = document.querySelector(`[data-panel-id="${CSS.escape(panelId)}"]`);
  if (root === null) return undefined;
  const content = getPreviewState(panelId)?.content;
  return {
    elements: root.getElementsByTagName('*').length,
    spans: root.getElementsByTagName('span').length,
    sourceChars: content?.kind === 'text' ? content.text.length : 0,
  };
}

function estimateFor(panel: Panel): PanelEstimate | undefined {
  const base = { panelId: panel.id, source: 'renderer', pid: 0 } as const;
  switch (panel.kind) {
    case 'terminal': {
      const size = getTerminalBufferSize(panel.id);
      if (size === undefined) return undefined;
      return { ...base, target: 'buffers', memoryBytes: terminalRendererBytes(size.lines, size.cols, size.styledLines) };
    }
    case 'editor': {
      const view = getEditorView(panel.id);
      if (view === undefined) return undefined;
      const state = view.state;
      const chars = state.doc.length;
      // The most complete tree there is: a forced full parse (folding and headings run one) leaves its
      // result on the parse context, while the state's own field keeps the tree it was created with
      // until the next edit. `ensureSyntaxTree` with no time, once the parse is done, hands that over
      // without parsing anything.
      const tree = (syntaxTreeAvailable(state, chars) ? ensureSyntaxTree(state, chars, 0) : null) ?? syntaxTree(state);
      const sample = sampleSyntaxTree(tree);
      const trees = extrapolatedNodes(sample.trees, sample.chars, chars);
      const buffered = extrapolatedNodes(sample.nodes - sample.trees, sample.chars, chars);
      return { ...base, target: 'panel', memoryBytes: editorRendererBytes(chars, trees, buffered, view.viewportLineBlocks.length) };
    }
    case PREVIEW_KIND: {
      const dom = previewDomSize(panel.id);
      if (dom === undefined) return undefined;
      return { ...base, target: 'panel', memoryBytes: previewRendererBytes(dom.elements, dom.spans, dom.sourceChars) };
    }
    default:
      return undefined;
  }
}

/** The renderer's share of the memory of every panel of the layout that has one. */
export function collectRendererEstimates(layout: WorkspaceLayout | null): PanelEstimate[] {
  if (layout === null) return [];
  const out: PanelEstimate[] = [];
  for (const tab of layout.tabs) {
    for (const panel of collectPanels(tab.root)) {
      const e = estimateFor(panel);
      if (e !== undefined) out.push(e);
    }
  }
  return out;
}
