# Contract: Editor Metadata Registry (core, pure)

**Module**: `packages/core/src/config/metadata.ts` (+ `settings-metadata.ts`, `keybindings-metadata.ts`,
`theme-metadata.ts`). Zero OS/DOM. The single source of truth the visual editors render from (FR-025a) and
the enforcement point for FR-047/048.

## Types

```ts
type ControlKind =
  | 'number' | 'text' | 'toggle' | 'select' | 'multiselect' | 'array'
  | 'colour' | 'font-family' | 'font-size' | 'enum' | 'icon' | 'chord';

interface FieldDescriptor {
  key: string;            // dotted path (settings) | ActionId (keybindings) | token (theme)
  label: string;          // FR-027
  description: string;    // FR-027
  group: string;          // labelled section (FR-026/030/038)
  control: ControlKind;   // FR-028/029/038
  allowedValues?: readonly (string | number)[]; // FR-029 (select/multiselect/enum)
  min?: number; max?: number; step?: number;     // number/font-size
  itemControl?: ControlKind;                      // array element control
}

type MetadataRegistry = readonly FieldDescriptor[];
```

## Guarantees (unit-tested)

1. **Completeness (FR-047)** — for each registry, *every* configurable key has exactly one descriptor:
   - `SETTINGS_METADATA` covers every leaf of `DEFAULT_APP_SETTINGS`.
   - `KEYBINDINGS_METADATA` covers every `ActionId`.
   - `THEME_METADATA` covers every token present in `THRONG_THEME` (colours, fonts, typography roles, icons).
   A missing descriptor (or a descriptor for a non-existent key) **fails the test**.
2. **Enumerated values are constrained (FR-029)** — any descriptor with `allowedValues` uses `select`,
   `multiselect`, or `enum` (never `text`), and its `allowedValues` equals the type's allowed set.
3. **Control matches type (FR-028/038)** — booleans → `toggle`; numeric → `number`/`font-size`; colour
   tokens → `colour`; font family → `font-family`; string-set → `select`/`enum`; string arrays → `array`;
   icon tokens → `icon`; actions → `chord`.
4. **Stable identity** — `key` is unique within a registry.

## Consumers

- Renderer `preferences/form-controls.tsx` renders a control per descriptor by `control`.
- Renderer groups descriptors by `group` into labelled sections.
- Validation reads `allowedValues`/`min`/`max` to gate immediate-apply (FR-017).
- **The registry doubles as the Settings search index (FR-049).** `config/settings-search.ts` searches a
  descriptor's `key`, `label` and `description`; the field's *current value* is supplied by the caller via
  `valueOf` (the registry holds no values). A descriptor therefore makes a setting **searchable for free** —
  there is no second list to keep in sync, and the FR-047 completeness test is unaffected (a blank query
  yields every descriptor).
