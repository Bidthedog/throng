# Contract — Theme token naming & description convention (US5, FR-018/019/020)

## Exports (`@throng/core`)
- `THEME_PROPERTY_VOCABULARY: readonly string[]` — the closed set of label-suffix properties (data-model §3).
- `assertNamingConvention(registry: MetadataRegistry): void` — throws, naming every token whose label/description violates the rules.

## Rules
- **Label**: `<Context> <Property>` in Title Case. `<Property>` ∈ `THEME_PROPERTY_VOCABULARY` (which contains no synonym pairs — `Text` not `Foreground`; `Font Size` for typography, `Size`/`Width` for pixel dims). `<Context>` non-empty (≥1 word) — a bare property (`"Size"`, `"Background"`) is a violation. Icon labels are exempt from the `<Property>` suffix (they are named nouns) but must still be Title Case and non-empty.
- **Description**: one sentence, present tense, length ≥ 20; MUST NOT match `/["“]?.+["”]? colour token/i`; MUST NOT equal `mechanicalCopy(key).description`.

## Guard behaviour
- `assertNamingConvention(THEME_METADATA)` passes for the shipped registry.
- A fabricated descriptor `{ label: 'Size', … }` (no context) or `{ description: 'The "X" colour token.' }` makes it throw, naming the token.
- Wired into `theme-copy.test.ts` so the build fails on any violating token.

## Non-goals
- Does not rename token **identifiers** for cosmetic reasons; identifiers change only where §4/§5 require (removed/added tokens).
