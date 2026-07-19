# Contract: Product Version

**Traces**: FR-001, FR-002, FR-004, FR-005, FR-006; SC-002.

## Single source

The **root `package.json` `version`** is the one authoritative product version. No other file declares a
product version; workspace `package.json` versions MUST equal the root (guard test).

## `core` API (`packages/core/src/config/product-version.ts`)

```ts
/** The single authoritative product version, read from the one source. */
export function getProductVersion(): string;            // e.g. "1.0.0"

/** True when the version is a placeholder that must not be published. */
export function isPlaceholderVersion(v: string): boolean; // "0.0.0" | "" → true

/** Ordered SemVer comparison: <0 if a<b, 0 if equal, >0 if a>b. */
export function compareVersions(a: string, b: string): number;
```

## Behavioural requirements

- **B1** Every surface (Electron main via `app.getVersion()`, daemon via its generated constant, renderer
  via the preload bridge) reports the value equal to `getProductVersion()` (FR-001).
- **B2** `compareVersions` orders SemVer correctly, including `1.0.0 < 1.0.1 < 1.1.0 < 2.0.0` and equal
  cases (FR-002); used by upgrade/downgrade detection (FR-016a).
- **B3** `isPlaceholderVersion("0.0.0") === true`; a real `"1.0.0"` → `false` (FR-028 condition (a) publish refusal).
- **B4** The Product Version is **distinct** from `BUILD_ID`; changing code without bumping the version
  changes `BUILD_ID` but not the version, and vice versa (FR-006).

## Tests (test-first)

- **unit** — `compareVersions` ordering table; `isPlaceholderVersion` truth table.
- **contract** — a guard asserting all workspace `package.json` versions equal the root, and that the
  generated daemon version constant equals `getProductVersion()`.
- **integration** — the renderer receives, over the preload bridge, a version equal to
  `app.getVersion()`.
