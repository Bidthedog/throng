/**
 * An editor's preview affordance — the one reading of core's `previewAffordance` that every editor
 * surface draws from (044 FR-001, FR-002, FR-004, FR-012, FR-062).
 *
 * Three surfaces offer a preview of the file an editor shows: the status-bar button, the body's
 * right-click menu and the header's. They ask the same question about the same panel, so they ask it
 * here — with the provider registry INJECTED (`PreviewProviderRegistryContext`, never a named
 * provider, contracts/preview-provider-seam.md §3), the live preview settings, and whether the file
 * already has a preview in any window (`preview-open-store`, compare form).
 *
 * `projectRoot` is the editor's OWN project root. A sub-workspace-owned editor has none, and an editor
 * outside its project's root is outside the project: both are `absent` (FR-004, Principle I).
 */
import {
  previewAffordance,
  type PreviewAffordance,
  type PreviewProviderRegistry,
  type PreviewSettings,
} from '@throng/core';
import { useAppSettings } from '../config/config-store.js';
import { usePreviewProviders } from '../preview/provider-registry-context.js';
import { isPreviewOpen, usePreviewOpen } from '../preview/preview-open-store.js';

export interface EditorPreviewInputs {
  registry: PreviewProviderRegistry;
  settings: PreviewSettings;
  /** The file the editor shows; `null`/`undefined` for a document with no file on disk. */
  filePath: string | null | undefined;
  projectRoot: string | null | undefined;
  previewOpen: boolean;
}

/** The affordance, from values already in hand. */
export function editorPreviewAffordance(inputs: EditorPreviewInputs): PreviewAffordance {
  return previewAffordance({
    registry: inputs.registry,
    settings: inputs.settings,
    absPath: inputs.filePath ?? undefined,
    projectRoot: inputs.projectRoot ?? undefined,
    isFolder: false,
    previewOpen: inputs.previewOpen,
    surface: 'editor',
  });
}

/**
 * The affordance as it stands NOW, for a surface built on demand (a menu opened by right-click) that
 * must not capture a value from the last render.
 */
export function currentEditorPreviewAffordance(
  inputs: Omit<EditorPreviewInputs, 'previewOpen'>,
): PreviewAffordance {
  return editorPreviewAffordance({
    ...inputs,
    previewOpen: inputs.filePath ? isPreviewOpen(inputs.filePath) : false,
  });
}

/** The affordance for a rendered surface, re-rendering when the settings or the open set change. */
export function useEditorPreviewAffordance(
  filePath: string | null | undefined,
  projectRoot: string | null | undefined,
): PreviewAffordance {
  const { registry } = usePreviewProviders();
  const settings = useAppSettings().editor.previews;
  const previewOpen = usePreviewOpen(filePath);
  return editorPreviewAffordance({ registry, settings, filePath, projectRoot, previewOpen });
}

/**
 * The status-bar button's tooltip while the provider is off (FR-001, FR-062): what is wrong, and the
 * setting that puts it right. Built from the provider's `displayName`, never a named provider.
 */
export function previewDisabledTitle(providerDisplayName: string): string {
  return `${providerDisplayName} previews are turned off — Preferences → Editor → Previews`;
}
