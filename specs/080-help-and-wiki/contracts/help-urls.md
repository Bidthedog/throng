# Contract: help URLs and how they open

**Module**: `packages/core/src/help/help-urls.ts` · FR-009, FR-010, FR-011, FR-014

```ts
export const HELP_BASE_URL = 'https://throng-ide.com/guide/';

/** The guide's start page. */
export function startPageUrl(base?: string): string;            // → `${base}`

/** A task's section. Throws on a (page, anchor) pair not in GUIDE_MAP. */
export function helpUrl(task: { page: GuidePageSlug; anchor: string }, options?: { base?: string; map?: readonly GuideTask[] }): string;
                                                                   // → `${base}${page}/#${anchor}`

/** A setting's section of the preferences reference. Throws on an unknown key. */
export function settingHelpUrl(key: SettingKey, base?: string): string;
                                                                   // → `${base}reference/preferences/#${key}`
```

```ts
/** The inverse, for the release-notes check: a guide URL's page and anchor, or null. */
export function parseHelpUrl(url: string, base?: string): { page: GuidePageSlug; anchor: string } | null;
```

- `base` defaults to `HELP_BASE_URL`; the renderer passes the injected effective base (R7). It always
  ends in `/`.
- No other module in the app writes a `throng-ide.com/guide` URL. A unit test greps the app's source and
  fails on one.

## Opening

| Caller | Opens | Route |
|---|---|---|
| Cog menu → **Help** | `startPageUrl()` | `window.throng.openExternal` (`throng:openExternal`, `http(s)` only) |
| `help.open` (F1) in any window, outside a terminal | `startPageUrl()` | same |
| A (?) on a setting row | `settingHelpUrl(key)` | same |
| A (?) on an audited surface (stage 2) | `helpUrl(task)` | same |

The route never consults the default open action for HTML and never opens a preview panel. When
`shell.openExternal` rejects for a `throng:openExternal` request, main logs `open-external failed: <url>:
<reason>` and raises one notice in the window that asked, naming the URL, with a **Copy** action that puts
the URL on the clipboard (FR-011). A second failure for the same URL while that notice is shown flashes
it rather than adding another (CLAUDE.md, *One condition, one notice*).

## Key binding

| Action id | Default | Scope | Menu item |
|---|---|---|---|
| `help.open` | `F1` | every scope except `terminal` | Cog menu → **Help** (section `application`, icon `help`) |

Listed in `docs/key-bindings.md` under the Application group, with its scope.

## Iteration 1 (FR-026, FR-028)

| Function | URL | Throws |
|---|---|---|
| `settingHelpUrl(key, base?)` | `<base>reference/preferences/<slug(group)>/#<key>` | unknown key |
| `keyBindingHelpUrl(actionId, base?)` | `<base>reference/key-bindings/<slug(group)>/#<actionId>` | unknown action id |
| `themeTokenHelpUrl(key, base?)` | `<base>reference/theme-settings/<slug(group)>/#<key>` | unknown token |
| `referenceSlug(heading)` | GitHub's heading slug — the one rule the builder also uses | — |

`<group>` is the descriptor's `group` in its metadata registry; a unit test proves each group is a `##`
heading of the same text in its reference file.
