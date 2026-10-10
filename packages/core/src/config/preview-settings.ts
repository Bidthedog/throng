/**
 * `editor.previews` — defaults, descriptors and parse, GENERATED from a provider registry (044,
 * FR-035b, FR-050 – FR-065, FR-071, FR-092, FR-114; data-model §3, §14.1; research R15).
 *
 * Every function takes the registry as a parameter. That is the FR-070/FR-071 claim made structural:
 * a provider's enabled toggle, its default open action and its own settings follow from registering
 * it, and nothing here names one. `app-settings.ts` and `settings-metadata.ts` call these once over
 * `SHIPPED_PREVIEW_PROVIDERS`; a test passes a registry of its own (SC-003).
 *
 * ══ THE IMPORT CYCLE, AND WHY THIS MODULE DOES NOT CLOSE IT ══
 *
 * `settings-metadata.ts` imports `app-settings.ts`, so `app-settings.ts` can never import the
 * registry back (see `settings-read.ts`). Both need this module — the defaults and parse on one side,
 * the descriptors on the other — so this module imports NEITHER: only the metadata TYPES and the
 * preview types, none of which import config. Keep it that way, or one of the two halves reads
 * `undefined` at module-init time and silently describes nothing.
 *
 * ══ RANGES LIVE ON THE DESCRIPTORS, NOT IN THE PARSE ══
 *
 * #227's rule: a declared range is enforced by the read-side guard (`applyDeclaredBounds`), and a
 * clamp repeated here would be a second copy of the number that only one reader could see. The parse
 * owns the TYPE and the floor — a negative delay is meaningless rather than small — and nothing else.
 *
 * Pure: no OS, no DOM.
 */
import type { FieldDescriptor } from './metadata.js';
import type {
  PreviewProviderDescriptor,
  PreviewProviderRegistry,
  ProviderSettingDeclaration,
} from '../preview/provider.js';
import type {
  DefaultOpenAction,
  PreviewCopyFormat,
  PreviewOpenTarget,
  PreviewSettings,
  ProviderSettings,
} from '../preview/settings-types.js';

/** The copy formats, in the order the control offers them (FR-035b). */
export const PREVIEW_COPY_FORMATS: readonly PreviewCopyFormat[] = ['rich', 'plain'];

/** A text provider's default open actions, in the order the control offers them (FR-050). */
export const DEFAULT_OPEN_ACTIONS: readonly DefaultOpenAction[] = ['editor', 'preview'];

const GROUP = 'Editor';
const SUBGROUP = 'Previews';
const PREFIX = 'editor.previews';

/*
 * The two delays' shipped values and slider shapes.
 *
 * `updateDelayMs`: 50 across 0–5000 is exactly the 1% the aimable-slider rule
 * (`slider-descriptors.test.ts`) requires, and 300 sits on a stop at 0 + 50×6.
 *
 * `maxWaitMs`: the contract wrote step 50 here too, but 50 across 0–10000 is 0.5% — two hundred
 * indistinguishable positions, and the rule fails it (the auto-save delay was widened for the same
 * reason in 018). 100 is the smallest legal step, and the shipped 1000 still lands on 0 + 100×10.
 */
const UPDATE_DELAY = { shipped: 300, min: 0, max: 5000, step: 50 } as const;
const MAX_WAIT = { shipped: 1000, min: 0, max: 10000, step: 100 } as const;
const COPY_FORMAT_SHIPPED: PreviewCopyFormat = 'rich';
/** FR-114: editor → preview scroll sync ships on. */
const SYNC_SCROLL_SHIPPED = true;
const DEFAULT_OPEN_ACTION_SHIPPED: DefaultOpenAction = 'editor';
/** 047 FR-015a — a standalone preview reuses the last active one by default. */
const OPEN_TARGET_SHIPPED: PreviewOpenTarget = 'lastActive';
/** The two values, in the order the control offers them. */
export const PREVIEW_OPEN_TARGETS: readonly PreviewOpenTarget[] = ['lastActive', 'new'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function providerKey(id: string, leaf: string): string {
  return `${PREFIX}.providers.${id}.${leaf}`;
}

/** One provider's shipped settings: enabled, a default open action for text, and its own leaves. */
function providerDefaults(provider: PreviewProviderDescriptor): ProviderSettings {
  // Every provider ships ENABLED. FR-065 requires it of Markdown, and the descriptor has no field to
  // say otherwise — none is added until a provider actually needs to ship off.
  const out: ProviderSettings = { enabled: true };
  if (provider.kind === 'text') {
    // 044 FR-050 ships Editor; a provider may declare Preview instead (Mermaid, 054 MT-04).
    out.defaultOpenAction = provider.defaultOpenAction ?? DEFAULT_OPEN_ACTION_SHIPPED;
    out.openTarget = OPEN_TARGET_SHIPPED;
  }
  for (const s of provider.settings ?? []) out[s.leaf] = s.default;
  return out;
}

/** The shipped `editor.previews` section for `registry`. A fresh object every call. */
export function previewSettingsDefaults(registry: PreviewProviderRegistry): PreviewSettings {
  return {
    updateDelayMs: UPDATE_DELAY.shipped,
    maxWaitMs: MAX_WAIT.shipped,
    copyFormat: COPY_FORMAT_SHIPPED,
    syncScroll: SYNC_SCROLL_SHIPPED,
    providers: Object.fromEntries(registry.list().map((p) => [p.id, providerDefaults(p)])),
  };
}

/** The descriptor for one of a provider's own declared settings (FR-071). */
function ownSettingDescriptor(
  provider: PreviewProviderDescriptor,
  s: ProviderSettingDeclaration,
  enabledWhen: FieldDescriptor['enabledWhen'],
): FieldDescriptor {
  const d: FieldDescriptor = {
    key: providerKey(provider.id, s.leaf),
    label: `${provider.displayName}: ${s.label}`,
    description: s.description,
    group: GROUP,
    subgroup: SUBGROUP,
    subsection: provider.displayName,
    // A bounded number takes the slider (018 SC-007's converse guard: bounds imply the control).
    control:
      s.control === 'number' && typeof s.min === 'number' && typeof s.max === 'number'
        ? 'slider'
        : s.control,
    enabledWhen,
  };
  if (s.allowedValues !== undefined) d.allowedValues = s.allowedValues;
  if (s.optionLabels !== undefined) d.optionLabels = s.optionLabels;
  if (s.min !== undefined) d.min = s.min;
  if (s.max !== undefined) d.max = s.max;
  if (s.step !== undefined) d.step = s.step;
  return d;
}

/**
 * Every `editor.previews.*` descriptor for `registry`, under `Editor → Previews` (FR-061).
 *
 * A provider's default open action and own settings carry `enabledWhen` on its enabled toggle, so
 * they are drawn DISABLED, not hidden, while it is off — the existing single-condition mechanism, and
 * no new descriptor field. A binary provider has no default-open-action descriptor at all (FR-051).
 */
export function previewSettingsDescriptors(
  registry: PreviewProviderRegistry,
  trailing: Readonly<Record<string, readonly FieldDescriptor[]>> = {},
): FieldDescriptor[] {
  const out: FieldDescriptor[] = [
    {
      key: `${PREFIX}.updateDelayMs`,
      label: 'Preview update delay',
      description:
        'How long a preview beside an editor waits after you stop typing before it shows your changes, in milliseconds. Zero updates it on every change.',
      group: GROUP,
      subgroup: SUBGROUP,
      control: 'slider',
      min: UPDATE_DELAY.min,
      max: UPDATE_DELAY.max,
      step: UPDATE_DELAY.step,
    },
    {
      key: `${PREFIX}.maxWaitMs`,
      label: 'Preview maximum wait',
      description:
        'The longest a preview beside an editor goes without showing your changes while you keep typing, in milliseconds. A value below the update delay behaves as the update delay.',
      group: GROUP,
      subgroup: SUBGROUP,
      control: 'slider',
      min: MAX_WAIT.min,
      max: MAX_WAIT.max,
      step: MAX_WAIT.step,
    },
    // FR-113, FR-114. Deliberately NO `enabledWhen`: it applies to every text provider, so no one
    // provider being off may draw it disabled. The description names both directions (FR-121) and the
    // two other places the same setting is switched from (FR-122f), so the key binder's search and a
    // reader of this row both find the menu item and the status-bar button.
    {
      key: `${PREFIX}.syncScroll`,
      label: 'Synchronise preview and editor scrolling',
      description:
        "Keep a preview and its editor at the same place in the file, in both directions: scrolling either one scrolls the other. Also switched by Synchronise Scrolling in the editor's and the preview's menus, and by the Synchronise Scrolling button on their status bars.",
      group: GROUP,
      subgroup: SUBGROUP,
      control: 'toggle',
    },
    // 054 contract order (menus-commands-controls-054.md "Preferences layout"): scrolling, then copy.
    {
      key: `${PREFIX}.copyFormat`,
      label: 'Preview copy format',
      description:
        'What Copy puts on the clipboard from a preview: formatted text that keeps headings, lists and links when pasted into a document, or plain text alone.',
      group: GROUP,
      subgroup: SUBGROUP,
      control: 'select',
      allowedValues: PREVIEW_COPY_FORMATS,
      optionLabels: { rich: 'Rich text', plain: 'Plain text' },
    },
  ];

  for (const provider of registry.list()) {
    const enabledKey = providerKey(provider.id, 'enabled');
    const enabledWhen = { key: enabledKey, is: true };
    // 054 FR-050 — every row of a provider sits in its own subsection, named for it.
    const subsection = provider.displayName;
    out.push({
      key: enabledKey,
      label: `${provider.displayName}: ${provider.enabledLabel ?? 'Enabled'}`,
      description:
        provider.enabledDescription ??
        `Offer previews of ${provider.displayName} files. When off, every preview of these files closes and their preview commands are shown disabled.`,
      group: GROUP,
      subgroup: SUBGROUP,
      subsection,
      control: 'toggle',
    });
    if (provider.kind === 'text') {
      out.push({
        key: providerKey(provider.id, 'defaultOpenAction'),
        label: `${provider.displayName}: Default open action`,
        // 054 FR-030 (T029) — Find in Files follows it now; only Open In's editor targets do not.
        description: `What opening a ${provider.displayName} file from File Explorer, Quick Open or a Find in Files result does: open it in an editor, or open its preview. Open In's editor targets always open an editor.`,
        group: GROUP,
        subgroup: SUBGROUP,
        subsection,
        control: 'select',
        allowedValues: DEFAULT_OPEN_ACTIONS,
        optionLabels: { editor: 'Editor', preview: 'Preview' },
        enabledWhen,
      });
      // 054 FR-051 – FR-053 — 047 FR-015a's "Open previews in", one per provider, labelled with its name
      // (FR-052). Governs where a STANDALONE open lands; a file already previewed is always focused
      // instead (047 FR-013), whatever this says.
      out.push({
        key: providerKey(provider.id, 'openTarget'),
        label: `${provider.displayName}: Open previews in`,
        description: `Where a ${provider.displayName} preview opens: Last Active reuses the most recently used ${provider.displayName} preview in the tab you are looking at; otherwise a new preview opens.`,
        group: GROUP,
        subgroup: SUBGROUP,
        subsection,
        control: 'select',
        allowedValues: PREVIEW_OPEN_TARGETS,
        optionLabels: { lastActive: 'Last Active', new: 'New Preview Panel' },
        enabledWhen,
      });
    }
    for (const s of provider.settings ?? []) out.push(ownSettingDescriptor(provider, s, enabledWhen));
    // Rows the caller files under this provider (`editor.markdownSectionsOpen`, FR-051), keys unchanged.
    for (const d of trailing[provider.id] ?? []) out.push({ ...d, group: GROUP, subgroup: SUBGROUP, subsection });
  }
  return out;
}

/** A whole, non-negative number, or the fallback. */
function nonNegative(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback;
}

/** One declared own leaf, tolerant of a wrong type or an undeclared option. */
function ownLeaf(s: ProviderSettingDeclaration, v: unknown): boolean | string | number {
  if (s.control === 'toggle') return typeof v === 'boolean' ? v : s.default;
  if (s.control === 'number') return typeof v === 'number' && Number.isFinite(v) ? v : s.default;
  if (typeof v !== 'string') return s.default;
  return s.allowedValues === undefined || s.allowedValues.includes(v) ? v : s.default;
}

const openTargetOf = (v: unknown): PreviewOpenTarget | undefined =>
  PREVIEW_OPEN_TARGETS.includes(v as PreviewOpenTarget) ? (v as PreviewOpenTarget) : undefined;

/**
 * `legacyOpenTarget` — the retired top-level leaf (047 FR-015a), migrated into every text provider that
 * has no valid value of its own (054 FR-053). The provider's own value wins, so a second parse of the
 * output changes nothing.
 */
function parseProvider(
  provider: PreviewProviderDescriptor,
  raw: unknown,
  legacyOpenTarget: PreviewOpenTarget | undefined,
): ProviderSettings {
  const fallback = providerDefaults(provider);
  if (!isRecord(raw)) {
    if (provider.kind === 'text' && legacyOpenTarget !== undefined) fallback.openTarget = legacyOpenTarget;
    return fallback;
  }
  const out: ProviderSettings = {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
  };
  // FR-051: a binary provider has no such leaf, so one written by hand is not carried.
  if (provider.kind === 'text') {
    out.defaultOpenAction = DEFAULT_OPEN_ACTIONS.includes(raw.defaultOpenAction as DefaultOpenAction)
      ? (raw.defaultOpenAction as DefaultOpenAction)
      : fallback.defaultOpenAction;
    out.openTarget = openTargetOf(raw.openTarget) ?? legacyOpenTarget ?? OPEN_TARGET_SHIPPED;
  }
  for (const s of provider.settings ?? []) out[s.leaf] = ownLeaf(s, raw[s.leaf]);
  return out;
}

/**
 * Parse `editor.previews`, tolerantly per leaf: a bad value takes its own default and never its
 * neighbours'. Never throws.
 *
 * An UNKNOWN provider id is PRESERVED — a hand-added key, or one a later build wrote, is legitimate,
 * and a settings write persists what this returns. Every reader looks providers up through the
 * registry, so a preserved entry is ignored on read.
 */
export function parsePreviewSettings(raw: unknown, registry: PreviewProviderRegistry): PreviewSettings {
  if (!isRecord(raw)) return previewSettingsDefaults(registry);
  const rawProviders = isRecord(raw.providers) ? raw.providers : {};
  const providers: Record<string, ProviderSettings> = {};
  for (const [id, value] of Object.entries(rawProviders)) {
    if (registry.get(id) === undefined && isRecord(value)) {
      providers[id] = structuredClone(value) as ProviderSettings;
    }
  }
  for (const provider of registry.list()) {
    providers[provider.id] = parseProvider(provider, rawProviders[provider.id], openTargetOf(raw.openTarget));
  }
  return {
    updateDelayMs: nonNegative(raw.updateDelayMs, UPDATE_DELAY.shipped),
    maxWaitMs: nonNegative(raw.maxWaitMs, MAX_WAIT.shipped),
    copyFormat: PREVIEW_COPY_FORMATS.includes(raw.copyFormat as PreviewCopyFormat)
      ? (raw.copyFormat as PreviewCopyFormat)
      : COPY_FORMAT_SHIPPED,
    syncScroll: typeof raw.syncScroll === 'boolean' ? raw.syncScroll : SYNC_SCROLL_SHIPPED,
    providers,
  };
}

/** The maximum wait as it BEHAVES: never shorter than the update delay (FR-060a). */
export function effectiveMaxWaitMs(s: PreviewSettings): number {
  return Math.max(s.maxWaitMs, s.updateDelayMs);
}

/**
 * What opening `path` does by default (FR-050 – FR-052, FR-062).
 *
 * `editor` unless the file's provider is ENABLED and its default open action is Preview. A binary
 * provider's default open action IS Preview (FR-051), so an enabled binary provider answers
 * `preview`. A disabled provider answers `editor` and leaves its stored choice exactly where it was,
 * so re-enabling restores it (FR-062).
 */
export function defaultOpenActionFor(
  registry: PreviewProviderRegistry,
  s: PreviewSettings,
  path: string,
): DefaultOpenAction {
  const provider = registry.forPath(path);
  if (provider === undefined) return 'editor';
  const settings = s.providers[provider.id];
  if (settings?.enabled !== true) return 'editor';
  if (provider.kind === 'binary') return 'preview';
  return settings.defaultOpenAction === 'preview' ? 'preview' : 'editor';
}

/**
 * 054 FR-051 — where a standalone preview of `path` opens: its text provider's own Open previews in, else
 * `'lastActive'` (the shipped value) for a file no text provider claims.
 */
export function previewOpenTargetFor(
  registry: PreviewProviderRegistry,
  s: PreviewSettings,
  path: string,
): PreviewOpenTarget {
  const provider = registry.forPath(path);
  if (provider === undefined) return OPEN_TARGET_SHIPPED;
  return s.providers[provider.id]?.openTarget ?? OPEN_TARGET_SHIPPED;
}

/**
 * Whether main may let an `https:` image through (FR-092, research R6): true while any ENABLED
 * provider declares a remote-images setting that is on. Main never names Markdown.
 */
export function remoteImagesPermitted(registry: PreviewProviderRegistry, s: PreviewSettings): boolean {
  return registry.list().some((provider) => {
    if (provider.remoteImagesSetting === undefined) return false;
    const settings = s.providers[provider.id];
    return settings?.enabled === true && settings[provider.remoteImagesSetting] === true;
  });
}

/**
 * FR-063's trigger: the ids of REGISTERED providers whose `enabled` went true → false between two
 * settings. A provider absent from `previous` did not turn off, and an unregistered id is ignored
 * whatever its flag did. Pure; main calls it on every settings change.
 */
export function providersTurnedOff(
  previous: PreviewSettings,
  next: PreviewSettings,
  registry: PreviewProviderRegistry,
): readonly string[] {
  return registry
    .list()
    .filter((p) => previous.providers[p.id]?.enabled === true && next.providers[p.id]?.enabled === false)
    .map((p) => p.id);
}
