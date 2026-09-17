/**
 * The preview provider registry, and the one decision every preview affordance is drawn from (044,
 * FR-001 – FR-004, FR-012, FR-062, FR-070 – FR-073, data-model §1 – §2).
 *
 * This is the FR-070 seam. A surface — the status bar, a menu, Files & Folders, the layout restore —
 * asks the registry and `previewAffordance`; none of them names a provider. Adding one is writing its
 * descriptor and adding it to `providers/index.ts`.
 *
 * Validation happens at construction, and the shipped registry is constructed at module load, so a
 * conflict fails on the first import in every process (FR-072) — at startup, not at the first
 * Markdown file someone happens to open.
 *
 * Pure: no OS, no DOM.
 */
import { isUnderPath } from '../fs/path-id.js';
import type { PreviewProviderDescriptor, PreviewProviderRegistry } from './provider.js';
import type { PreviewSettings } from './settings-types.js';

const ID = /^[a-z][a-zA-Z0-9]*$/;
const EXTENSION = /^\.[a-z0-9][a-z0-9.+-]*$/;
/** Leaves every provider has, generated from its registration (FR-071); a declaration may not shadow them. */
const RESERVED_LEAVES = new Set(['enabled', 'defaultOpenAction']);

function validate(provider: PreviewProviderDescriptor): void {
  const { id } = provider;
  if (!ID.test(id)) throw new Error(`Preview provider id "${id}" must match ${ID}`);
  if (provider.extensions.length === 0) throw new Error(`Preview provider "${id}" claims no extensions`);
  for (const ext of provider.extensions) {
    if (!EXTENSION.test(ext)) {
      throw new Error(`Preview provider "${id}" claims "${ext}", which is not a lower-case dot-prefixed extension`);
    }
  }

  const leaves = new Set<string>();
  for (const setting of provider.settings ?? []) {
    if (RESERVED_LEAVES.has(setting.leaf)) {
      throw new Error(`Preview provider "${id}" declares the reserved setting "${setting.leaf}"`);
    }
    if (leaves.has(setting.leaf)) {
      throw new Error(`Preview provider "${id}" declares the setting "${setting.leaf}" twice`);
    }
    leaves.add(setting.leaf);
  }

  if (provider.remoteImagesSetting !== undefined) {
    const named = provider.settings?.find((s) => s.leaf === provider.remoteImagesSetting);
    if (named?.control !== 'toggle') {
      throw new Error(
        `Preview provider "${id}" names "${provider.remoteImagesSetting}" as its remote images setting, which is not one of its toggles`,
      );
    }
  }

  if (provider.kind === 'text' && provider.sourceMimeTypes !== undefined) {
    throw new Error(`Preview provider "${id}" is a text provider and must not declare sourceMimeTypes`);
  }
  if (provider.kind === 'binary' && (provider.sourceMimeTypes?.length ?? 0) === 0) {
    throw new Error(`Preview provider "${id}" is a binary provider and must declare sourceMimeTypes`);
  }
}

/** The file name's last segment, lower-cased. */
function fileNameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).toLowerCase();
}

/** Throws on an invalid descriptor, a duplicate id, or an extension claimed twice (FR-072). */
export function createPreviewProviderRegistry(
  providers: readonly PreviewProviderDescriptor[],
): PreviewProviderRegistry {
  const byId = new Map<string, PreviewProviderDescriptor>();
  const byExtension = new Map<string, PreviewProviderDescriptor>();

  for (const provider of providers) {
    validate(provider);
    if (byId.has(provider.id)) throw new Error(`Preview provider "${provider.id}" is registered twice`);
    byId.set(provider.id, provider);
    for (const ext of provider.extensions) {
      const claimant = byExtension.get(ext);
      if (claimant !== undefined) {
        throw new Error(`Preview providers "${claimant.id}" and "${provider.id}" both claim "${ext}"`);
      }
      byExtension.set(ext, provider);
    }
  }

  // Longest first, so a multi-part extension (`.tar.gz`) wins over its own tail (`.gz`).
  const extensions = [...byExtension.keys()].sort((a, b) => b.length - a.length);
  const list = Object.freeze([...byId.values()]);

  return {
    list: () => list,
    get: (id) => byId.get(id),
    forPath(path) {
      const name = fileNameOf(path);
      // A name must be LONGER than the extension: `.md` alone is a dotfile called "md", not a file of
      // that type — the same reading `editorAutoTitle` gives a dotfile.
      const ext = extensions.find((e) => name.length > e.length && name.endsWith(e));
      return ext === undefined ? undefined : byExtension.get(ext);
    },
  };
}

/** Any provider claiming the path, enabled or not. */
export function providerFor(
  registry: PreviewProviderRegistry,
  path: string,
): PreviewProviderDescriptor | undefined {
  return registry.forPath(path);
}

/**
 * The provider for a path only while it is enabled (FR-062). A provider with no entry in `settings`
 * counts as disabled: settings are generated from the same registry, so a missing entry means the
 * two came from different registrations, and "not previewable" is the safe reading of that.
 */
export function enabledProviderFor(
  registry: PreviewProviderRegistry,
  settings: PreviewSettings,
  path: string,
): PreviewProviderDescriptor | undefined {
  const provider = registry.forPath(path);
  return provider !== undefined && settings.providers[provider.id]?.enabled === true ? provider : undefined;
}

export type PreviewAffordance =
  /** FR-001, FR-003, FR-004, FR-073 — meaningless here, so not shown. */
  | { state: 'absent' }
  /** FR-001, FR-003, FR-062 — one setting away from working, so shown disabled. */
  | { state: 'disabled'; reason: 'provider-disabled'; provider: PreviewProviderDescriptor }
  /** FR-012 — the file already has its one preview. */
  | { state: 'disabled'; reason: 'preview-open'; provider: PreviewProviderDescriptor }
  | { state: 'enabled'; provider: PreviewProviderDescriptor };

/**
 * Whether, and how, to offer a preview of a file — first match wins:
 *
 * | # | Condition                                              | Result                          |
 * |---|--------------------------------------------------------|---------------------------------|
 * | 1 | no `absPath`, a folder, or not inside `projectRoot`    | `absent` (FR-003, FR-004)       |
 * | 2 | no provider claims the extension                       | `absent` (FR-001, FR-003)       |
 * | 3 | `surface: 'editor'` and the provider is `binary`       | `absent` (FR-073)               |
 * | 4 | the provider is disabled                               | `disabled` / `provider-disabled`|
 * | 5 | a preview of the file is open                          | `disabled` / `preview-open`     |
 * | 6 | otherwise                                              | `enabled`                       |
 *
 * The status-bar button draws `preview-open` as pressed and ENABLED (FR-014); that is a rendering of
 * this answer, not a different answer.
 */
export function previewAffordance(args: {
  registry: PreviewProviderRegistry;
  settings: PreviewSettings;
  /** `undefined`: an editor with no file on disk. */
  absPath: string | undefined;
  projectRoot: string | undefined;
  isFolder: boolean;
  previewOpen: boolean;
  surface: 'editor' | 'explorer';
}): PreviewAffordance {
  const { absPath, projectRoot } = args;
  if (absPath === undefined || args.isFolder || projectRoot === undefined || !isUnderPath(absPath, projectRoot)) {
    return { state: 'absent' };
  }
  const provider = args.registry.forPath(absPath);
  if (provider === undefined) return { state: 'absent' };
  if (args.surface === 'editor' && provider.kind === 'binary') return { state: 'absent' };
  if (args.settings.providers[provider.id]?.enabled !== true) {
    return { state: 'disabled', reason: 'provider-disabled', provider };
  }
  if (args.previewOpen) return { state: 'disabled', reason: 'preview-open', provider };
  return { state: 'enabled', provider };
}
