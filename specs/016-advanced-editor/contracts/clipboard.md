# Contract — `IClipboard` (OS seam)

**Requirement**: FR-013a · **Constitution**: Principle II (Platform-Abstracted Core), Principle V
(contract tests for every abstraction).

This is the feature's **one new OS seam**. It exists because deciding the paste mode (FR-015c) requires
reading the **live OS clipboard's text** from core decision logic — a direct OS query from core, which
Principle II forbids.

## Interface (`@throng/core` — `packages/core/src/abstractions/clipboard.ts`)

```ts
/**
 * IClipboard (016, FR-013a) — the OS seam for the system clipboard (Principle II).
 *
 * The clipboard carries PLAIN TEXT ONLY, in both directions: anything copied in throng
 * pastes into any OS application, and anything copied in any OS application pastes into
 * throng. throng's clipboard-MODE record (verbatim / full-line / rectangular) is
 * application state, stays on throng's side of this seam, and MUST NOT be written to the
 * OS clipboard as a custom format.
 *
 * Reads are absence-tolerant: an empty or unreadable clipboard reads as '' and never throws,
 * so a paste degrades to "no throng mode" rather than crashing the editor.
 */
export interface IClipboard {
  /** Replace the clipboard's contents with `text`. */
  writeText(text: string): void;
  /** The clipboard's current text; '' when empty or unreadable. Never throws. */
  readText(): string;
}
```

## Contract suite (`@throng/core/testing` — `runClipboardContract(name, make)`)

Follows the `IFontEnumeration` precedent exactly (`runFontEnumerationContract`). Reachable only via the
`@throng/core/testing` subpath export — deliberately **not** on the production entry point.

Any implementation MUST satisfy:

1. **Round-trip** — `writeText(s)` then `readText()` returns `s`, for ASCII, Unicode (emoji, CJK), and
   text containing `\n` and `\r\n`.
2. **Overwrite** — a second `writeText` replaces the first; no appending.
3. **Empty is legal** — `writeText('')` then `readText()` returns `''`.
4. **Never throws** — `readText()` on an empty/unreadable clipboard returns `''` rather than throwing.
5. **Line endings survive verbatim** — the seam does **not** normalise `\r\n` ↔ `\n`. Normalisation is a
   *document* concern (FR-023a) and belongs above the seam; a seam that silently rewrote line endings
   would make FR-023a untestable.
6. **Idempotent read** — two consecutive `readText()` calls with no intervening write return the same
   value.

## Implementation

`ElectronClipboard` — `packages/ui/src/main/electron-clipboard.ts`.

It lives in **UI main, not `@throng/platform-windows`**, because that package has **no `electron`
dependency** (it is plain Node). This is the established placement for Electron-backed seams —
`ElectronDisplayInfo` and `ElectronShellIntegration` both sit in `ui/src/main/` with contract tests in
`ui/tests/contract/`.

It **constructor-injects** Electron's `clipboard` module, so the contract test can drive it with an
in-memory fake and run outside a real Electron main process.

```ts
export class ElectronClipboard implements IClipboard {
  constructor(private readonly clipboard: Pick<Electron.Clipboard, 'writeText' | 'readText'>) {}
  // …
}
```

**DI**: token `UI_TYPES.Clipboard`, bound in the UI-main composition root
(`packages/ui/src/main/composition-root.ts`) — one container per boundary (Principle IX).

## It must absorb the existing unseamed call sites

`packages/ui/src/main/terminal-ipc.ts` calls Electron's clipboard **directly** today:

- `clipboard.writeText(selection)` (~:201)
- `clipboard.readText()` (~:207)
- `clipboard.writeText(text)` in the `throng:terminal:clipboardWrite` handler (~:220-223)

All three are routed through the seam. Leaving them would make the abstraction a **fiction** — core
logic would still be one import away from the OS, and Principle II would be satisfied only on paper.

## Out of the contract

- **The mode record** (`verbatim` / `full-line` / `rectangular`) — application state, not an OS
  capability. It never crosses this seam and is never written to the OS clipboard.
- **Clipboard-change notification.** Deliberately absent: the mode is validated by **comparing the live
  clipboard text to throng's last write on every paste** (FR-015c), which is self-correcting. No
  observer, no polling (SC-011a).
