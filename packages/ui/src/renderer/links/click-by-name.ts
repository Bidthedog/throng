import {
  defaultOpenActionFor,
  isLinkInProject,
  samePath,
  type LinkHoverDestination,
  type PreviewProviderRegistry,
  type PreviewSettings,
} from '@throng/core';
import { absolutePathByName } from './path-by-name.js';

/** FR-030's tri-state, decided by extension alone — no disk (the renderer's half of what main's
 *  `FileLinkResolver.previewStateOf` answers for an actual resolved path). `'none'` is "no provider
 *  claims this", not "the provider is off". Used to draw the Link menu's Open Preview row while main
 *  has not yet answered (FR-170c). */
export function previewStateByExtension(
  registry: PreviewProviderRegistry,
  settings: PreviewSettings,
  text: string,
): 'none' | 'enabled' | 'disabled' {
  const provider = registry.forPath(text);
  if (provider === undefined) return 'none';
  return settings.providers[provider.id]?.enabled === true ? 'enabled' : 'disabled';
}

/** FR-168b — a location written with a trailing separator, or the project root itself, by name alone
 *  (no disk): what gates the Link menu's Open In ▸ / Open Preview rows before main has answered. */
export function folderByGrammarByName(text: string, projectRoot: string | null | undefined): boolean {
  if (/[\\/]$/.test(text)) return true;
  const root = projectRoot ?? null;
  if (root === null) return false;
  const absolute = absolutePathByName(text);
  return absolute !== null && samePath(absolute, root);
}

/**
 * 045 round four — where a Ctrl+click on a detected path or a `file:` target will LAND, judged from the
 * text alone (FR-155: nothing is resolved to draw, hover or word a link), and — since FR-168 — what
 * that destination is WORDED as.
 *
 * `clickTargetByName`'s coarse two-way split (open in throng / reveal) is what the tooltip used to
 * stop at. FR-168 widens the wording to name which editor, or a preview, so this file now composes the
 * full {@link LinkHoverDestination} — `linkDestinationByName` is what `hovered-link.ts` and
 * `link-decorations.ts` call; `clickTargetByName` stays for a caller that only needs the coarse split.
 *
 * A location written with a trailing separator, or the project root itself, is a folder by grammar
 * (FR-158d) and shows in OS Explorer; an absolute location outside the owning project shows in OS
 * Explorer; anything else — a relative path, an absolute one inside the project — opens in throng. A
 * relative path is worded from the project's reading UNLESS the caller names the terminal's live
 * working directory and it lies outside the project (FR-168a) — the by-name trade research R35 accepts,
 * because choosing among a relative path's several readings needs the disk. The follow itself is still
 * main's to decide (`throng:links:follow`).
 */
export type ClickTarget = 'editor' | 'preview' | 'osExplorer';

export function clickTargetByName(
  text: string,
  projectRoot: string | null | undefined,
  /** FR-168a: the panel's live working directory, where the caller has one. */
  baseDirectory?: string,
): ClickTarget {
  if (/[\\/]$/.test(text)) return 'osExplorer';
  const root = projectRoot ?? null;
  const absolute = absolutePathByName(text);
  if (absolute === null) {
    if (baseDirectory !== undefined && root !== null && !isLinkInProject(baseDirectory, root)) {
      return 'osExplorer';
    }
    return 'editor';
  }
  if (root !== null && samePath(absolute, root)) return 'osExplorer';
  return isLinkInProject(absolute, root) ? 'editor' : 'osExplorer';
}

/** What {@link linkDestinationByName} needs beyond `clickTargetByName`'s three inputs. */
export interface LinkDestinationByNameArgs {
  readonly text: string;
  readonly projectRoot: string | null | undefined;
  /** FR-168a — a terminal's live cwd; absent for an editor, which always has a base. */
  readonly baseDirectory?: string;
  /** 023 FR-025/FR-026 — `editor.openTarget`, live. */
  readonly openTarget: 'lastActive' | 'new';
  /** FR-051: whether this file's own default open action is Preview — by extension alone, no disk. */
  readonly previewRegistry?: PreviewProviderRegistry;
  readonly previewSettings?: PreviewSettings;
  /**
   * FR-110 / SC-016: a link carrying a position always opens in an editor, whatever a provider claims
   * for its extension — a preview cannot reveal a line and column.
   */
  readonly hasPosition?: boolean;
}

/** FR-168's full destination, judged by name — the tooltip's, the hint's and the mark's one source. */
export function linkDestinationByName(args: LinkDestinationByNameArgs): LinkHoverDestination {
  const click = clickTargetByName(args.text, args.projectRoot, args.baseDirectory);
  if (click === 'osExplorer') return { kind: 'osExplorer' };
  if (
    args.hasPosition !== true &&
    args.previewRegistry !== undefined &&
    args.previewSettings !== undefined &&
    defaultOpenActionFor(args.previewRegistry, args.previewSettings, args.text) === 'preview'
  ) {
    return { kind: 'preview' };
  }
  return { kind: 'editor', openTarget: args.openTarget };
}

/*
 * `absoluteByName` lived here. Review round four (I2): it knew `X:\…`, `\\…` and `file:` and NOT the
 * Git Bash / WSL drive forms, so `/d/temp/x.txt` fell into the RELATIVE arm and was worded "open in
 * throng active editor" while the click revealed it in OS Explorer. It moved to `path-by-name.ts`,
 * beside the readout's own by-name reading, so the two cannot drift apart again.
 */
