/**
 * Open In's two preview rows — *Last Preview Panel* and *New Preview Panel* — described once, for every
 * surface that draws them (047 US2, FR-014, FR-076, FR-080; 060 FR-048).
 *
 * The File Explorer drew these from logic of its own; 060 FR-048 puts the same two rows on a Find in Files
 * result and file heading, and two surfaces each computing the affordance, the reuse candidate and its name
 * are two implementations, of which one drifts — `editor/open-in-targets.ts`' reason, applied to previews.
 *
 * Split as that module is: {@link readPreviewOpenIn} samples the stores at one moment, and
 * {@link previewOpenInRows} is pure over what it returned.
 */
import {
  collectPanels,
  panelDisplayTitle,
  previewAffordance,
  previewPathOf,
  previewTitleParts,
  truncateGraphemes,
  wasTruncated,
  PREVIEW_KIND,
  type PreviewAffordance,
  type PreviewPanelConfig,
  type WorkspaceLayout,
} from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';
import { candidateFor } from './last-active-preview.js';
import { getPreviewState } from './preview-store.js';

type AffordanceArgs = Parameters<typeof previewAffordance>[0];

/** What the two rows turn on: whether the file can be previewed at all, and the panel a reuse would take. */
export interface PreviewOpenInFacts {
  affordance: PreviewAffordance;
  /** The header name of the preview *Last Preview Panel* would reuse; `null` when there is none. */
  lastPreviewTitle: string | null;
}

/**
 * 047 FR-080 — Last Preview Panel's name: the panel's name without the header's " - Preview" (the item already
 * says it), cut to this many characters whatever the tab limit.
 */
const LAST_PREVIEW_NAME_MAX = 16;

/**
 * Read the facts for `absPath` from the live stores. `previewOpen` is main's answer to "does this file have
 * its one preview?" (044 FR-012), awaited by the caller in the same moment as anything else it asks main.
 */
export function readPreviewOpenIn(args: {
  layout: WorkspaceLayout | null | undefined;
  registry: AffordanceArgs['registry'];
  settings: AffordanceArgs['settings'];
  absPath: string;
  projectRoot: string;
  previewOpen: boolean;
}): PreviewOpenInFacts {
  const { layout, registry, absPath } = args;
  const affordance = previewAffordance({
    registry,
    settings: args.settings,
    absPath,
    projectRoot: args.projectRoot,
    isFolder: false,
    previewOpen: args.previewOpen,
    surface: 'explorer',
  });
  // 047 US2 (FR-014) — a preview standing in the VISIBLE tab this window could reuse, read now: a panel
  // closing between renders must not leave the row offering a reuse that no longer exists.
  const tabId = layout?.activeTabId;
  const activeTab = tabId !== undefined ? layout?.tabs.find((t) => t.id === tabId) : undefined;
  const candidatePanel =
    tabId !== undefined && activeTab !== undefined
      ? (() => {
          const panels = collectPanels(activeTab.root);
          // 054 FR-007 — per type: only a preview showing a file of THIS file's provider is reused, the
          // same rule `openPreview` applies (the run's current file, else the persisted one).
          const providerId = registry.forPath(absPath)?.id;
          const shownProvider = (pid: string): string | undefined => {
            const config = panels.find((p) => p.id === pid)?.config as PreviewPanelConfig | undefined;
            const shown = getPreviewState(pid)?.filePath ?? previewPathOf(config);
            return shown === undefined ? undefined : registry.forPath(shown)?.id;
          };
          const id = candidateFor(
            tabId,
            (pid) => panels.some((p) => p.id === pid && p.kind === PREVIEW_KIND),
            providerId === undefined ? undefined : { id: providerId, of: shownProvider },
          );
          return id === null ? undefined : panels.find((p) => p.id === id);
        })()
      : undefined;
  if (candidatePanel === undefined) return { affordance, lastPreviewTitle: null };
  // 047 FR-076 — that panel's NAME, as its header shows it: `panelDisplayTitle` over the same sources the
  // header hands it (the live path a followed link moved, or the parent editor's title).
  const candidateState = getPreviewState(candidatePanel.id);
  const titleSources = {
    previewFilePath: candidateState?.filePath,
    previewParentTitle: candidateState?.parent?.title,
  };
  const name = previewTitleParts(candidatePanel, titleSources)?.name ?? panelDisplayTitle(candidatePanel, titleSources);
  return {
    affordance,
    lastPreviewTitle: wasTruncated(name, LAST_PREVIEW_NAME_MAX) ? `${truncateGraphemes(name, LAST_PREVIEW_NAME_MAX)}…` : name,
  };
}

/**
 * The two rows, or none where a preview could never mean anything (a type no provider claims, outside the
 * project — 044 FR-003, FR-004). Drawn DISABLED, never hidden, while the provider is off (FR-062); one
 * Current Preview row instead when the file already has its one preview (060 FR-049). *Last Preview Panel*
 * is also disabled with nothing to reuse, and names what it would reuse when there is something (FR-076).
 */
export function previewOpenInRows(
  facts: PreviewOpenInFacts,
  open: { lastActive: () => void; new: () => void },
): MenuAction[] {
  if (facts.affordance.state === 'absent') return [];
  /*
   * 060 FR-049 — the file already has its one preview (044 FR-012), so there is one place for it to go:
   * that preview. One live Current Preview row replaces the pair, as Current Editor replaces Last Active /
   * New Editor (FR-045). It takes the Last Active route on purpose: `preview.open` answers an already-
   * previewed file by focusing that preview (044 FR-004), wherever it is.
   */
  if (facts.affordance.state === 'disabled' && facts.affordance.reason === 'preview-open') {
    return [
      {
        label: 'Current Preview',
        icon: 'preview',
        section: 'navigate',
        group: 'preview',
        onClick: () => open.lastActive(),
      },
    ];
  }
  const disabled = facts.affordance.state === 'disabled';
  return [
    {
      label: facts.lastPreviewTitle === null ? 'Last Preview Panel' : `Last Preview Panel (${facts.lastPreviewTitle})`,
      icon: 'preview',
      section: 'navigate',
      group: 'preview',
      disabled: disabled || facts.lastPreviewTitle === null,
      onClick: () => open.lastActive(),
    },
    {
      label: 'New Preview Panel',
      icon: 'preview',
      section: 'navigate',
      group: 'preview',
      disabled,
      onClick: () => open.new(),
    },
  ];
}
