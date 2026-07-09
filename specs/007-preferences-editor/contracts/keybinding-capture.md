# Contract: Key-binding capture (core, pure)

**Module**: `packages/core/src/config/chord-capture.ts` (builds on `keybindings.ts`
`eventToToken`/`normalizeToken`/`resolveAction`). Implements FR-032/033/033a/034. Pure; the capture modal
(renderer) writes the resulting `keybindings.json` via `config.write` (immediate-apply).

## Functions

```ts
captureToken(ev: { key: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }): string;
//   canonical 'Ctrl+Shift+Alt+<KEY>' token (reuses eventToToken); shown live on key-down (FR-032)

isBindableChord(token: string): boolean;
//   true iff token has ≥1 modifier (Ctrl/Alt/Shift/Meta) AND a non-modifier key (FR-033a).
//   A bare key ('A', 'F2') or a lone modifier → false (rejected, not saved).

findConflict(bindings: Record<string, string[]>, token: string, exceptAction: ActionId): ActionId | null;
//   the other action already bound to token, or null (FR-034 detection)

applyReplace(bindings, action: ActionId, token: string): Record<string, string[]>;
//   set action's chord(s) to [token] (FR-033 replace; multi-chord stays a JSON-only affordance)

applyReassign(bindings, fromAction: ActionId, toAction: ActionId, token: string): Record<string, string[]>;
//   remove token from fromAction, then replace toAction with token (FR-034 Reassign)
```

## Guarantees (unit-tested)

1. **Minimum chord (FR-033a)** — `isBindableChord` requires modifier + key; bare keys and lone modifiers are
   rejected. The modal does not close/save on an invalid capture (it surfaces "a modifier is required").
2. **Replace (FR-033)** — on a valid, conflict-free key-up, the action's existing chord(s) are replaced by
   the captured token.
3. **Conflict (FR-034)** — if `findConflict` is non-null, the modal MUST warn and require **Reassign**
   (`applyReassign` removes it from the other action) or **Cancel** — never a silent duplicate or steal.
4. **Reserved combos (edge case)** — a combination that cannot be bound (reserved OS/window control) is
   surfaced as unavailable and not saved (the modal treats it like an invalid capture).

## Metadata

`keybindings-metadata.ts` supplies each `ActionId`'s label, description, and group for the grouped list
(FR-030); the completeness test asserts every `ActionId` has a descriptor.

---

## Delta — 2026-07-08

- **Additive capture** — on key-up the captured chord is **added** to the action's chords (`applyAdd`,
  dedup on identical), not replacing (`applyReplace` retained for JSON/programmatic paths only).
- **`applyRemove(bindings, action, token)`** — removes a single chord (per-pill `×` / context-menu Remove).
- **`isBindableChord`** — now true for **any single non-excluded key** (single keys allowed). `EXCLUDED_KEYS`
  = Escape, Space, Shift, Control, Enter, CapsLock, Tab, NumLock, and lone modifiers; reserved OS combos
  (`isReservedChord`, FR-032a) remain separately excluded.
