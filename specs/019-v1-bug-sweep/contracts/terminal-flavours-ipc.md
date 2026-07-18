# Contract: The detected-flavour surface

**Feature**: 019 | Governs FR-016, FR-017 (C10) | **Tested by**: `packages/ui/tests/e2e/preferences-terminal-flavours.e2e.ts`

Hiding a built-in is a **one-way door** today: the only IPC surface, `listFlavours()`, already subtracts
`disabledBuiltins` (`shell-detection-service.ts:27-35` → `flavour.ts:33,42-43`), so a picker built from
it cannot offer an already-hidden built-in back. The two callers want different questions answered:
*"what can I launch?"* and *"what does this machine have?"*.

---

## 1. Main — `ShellDetectionService` (`packages/ui/src/main/shell-detection-service.ts`)

```ts
export interface DetectedFlavour {
  id: string;        // the built-in id: 'cmd' | 'windows-powershell' | 'pwsh' | 'git-bash' | …
  label: string;     // 'Command Prompt' — what the picker shows a human
  file: string;      // the detected executable, for diagnostics
}

export interface ShellDetectionService {
  listFlavours(): Promise<TerminalFlavour[]>;          // EXISTS — the PANEL DROPDOWN's source. UNCHANGED.
  listDetectedFlavours(): Promise<DetectedFlavour[]>;  // NEW — the RAW detected built-ins.
}
```

### `listDetectedFlavours()` — MUST

- return the built-ins as `IShellDetection.detectInstalledShells()` reported them, **with nothing
  subtracted**: not `disabledBuiltins`, not user flavours, not a merge (**FR-017**)
- re-detect (or re-read settings) per call, as `listFlavours` already does (`:26-32`), so the editor is
  never showing a stale catalogue after a hot reload
- stay in **UI main**: detection is a Principle II seam (`WindowsShellDetection`), the daemon performs
  no detection, and the renderer is sandboxed

### `listDetectedFlavours()` — MUST NOT

- be reachable from the panel-type form. Only the settings editor consumes it

**Why a distinct method and not `listFlavours({ includeHidden: true })` (C10)**: a flag invites a caller
to accidentally offer hidden flavours to users in the dropdown itself — the exact behaviour the user
switched off. A distinct method cannot be misused that way, and the shape of the answer differs anyway
(a `TerminalFlavour` carries `source` and resolved `defaultParams`; a picker wants neither).

## 2. IPC + preload

| Channel | Handler | Consumer |
|---|---|---|
| `throng:terminal:listFlavours` | **exists** (`main.ts:595`) | the panel-type form (`use-flavours.ts:18`) |
| `throng:terminal:listDetectedFlavours` | **NEW**, beside it | the Settings tab only |

```ts
// preload.cts — beside the existing terminal.listFlavours (global.d.ts:103)
listDetectedFlavours: () => ipcRenderer.invoke('throng:terminal:listDetectedFlavours'),
// renderer/global.d.ts
listDetectedFlavours: () => Promise<DetectedFlavourDto[]>;
```

## 3. Renderer — the picker's options

`terminals.disabledBuiltins` becomes `control: 'multiselect'` and takes its options from the existing
**dynamic-options seam** in `settings-tab.tsx:135-145` — the hook 016 generalised for precisely this
("a third such field would have meant a third `d.key === …` in the JSX"):

```ts
if (d.key === 'terminals.disabledBuiltins') return detectedFlavourIds;   // fetched once, like themes (:88-104)
```

**MUST**
- offer **every detected built-in**, including the ones currently hidden — shown **checked** (FR-017).
  The catalogue is the *detected* set, never the *visible* set
- render checkboxes (or a `<select>`), each **labelled** with the flavour's human label. The RED test
  finds `cmd` by `label` text matching `/cmd|Command Prompt/i` — never by position, because "the first
  checkbox" would pass against a picker offering the wrong set entirely (`:125-129`)
- write the checked ids back as `string[]`, unchanged in shape

**MUST NOT**
- render any free-text element inside `control-terminals.disabledBuiltins`. The RED test enumerates the
  control's root **and** its descendants and asserts **zero** `TEXTAREA` / `INPUT:text` (`:68-101`) —
  007 FR-029: never a free-text field where an enumeration exists
- fail closed when detection returns nothing: an empty catalogue renders an empty picker, never a text
  box

## 4. Observable contract

| Journey | Expectation | Test |
|---|---|---|
| open Prefs with `disabledBuiltins:['cmd']` seeded | no free-text element; ≥1 checkbox/select; offered set contains `cmd` | RED (`:86-115`) |
| check Command Prompt | `settings.json` `terminals.disabledBuiltins` contains `cmd` | RED (`:117-148`) |
| …then look again | `cmd` is **still offered**, and **checked** | RED (`:139`) — the one-way door |
| uncheck it | the id leaves `settings.json` | RED (`:141-144`) |

Config root is driven by `THRONG_CONFIG_ROOT` (`:113`), so the assertions read the real file the app
wrote — not a UI echo.
