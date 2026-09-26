# Build guards below E2E: bridge parity and the renderer typecheck

Read when a renderer↔main channel changes, when `ipc-bridge-parity.test.ts` or `renderer-typecheck-gate.test.ts` goes red, or when a renderer type error slipped past `npm run typecheck`.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## The bridge parity guard

`packages/ui/tests/unit/ipc-bridge-parity.test.ts` checks that both ends of the
renderer↔main bridge name the same channels, for all ~98 of them, in milliseconds and
without launching anything.

It exists because "this proves the wiring is live" was the largest single reason 035's
census found for keeping a test at E2E — and the wiring decomposes into three spans, two
of which already had a home:

| Span | Layer that owns it |
| --- | --- |
| renderer action → bridge call | component, against a fake bridge |
| channel agrees across preload ↔ main | **this guard** — previously nothing |
| main handler → real effect | contract (`config-write-patch.contract.test.ts`) |

It scans channel **literals** per directory rather than `ipcMain.handle(...)` call sites.
A first attempt did the latter and reported 34 one-way gaps, every one false: channels
here are routinely registered through a named constant, a helper map, or a `send` inside
a switch, so the call site holds an identifier rather than a string. A constant's
definition is itself a literal in the same tree, so collecting literals needs no import
graph and no parser. Comments are stripped first, because this codebase deliberately
documents channels it has **removed** — and without stripping, those comments read as
live one-way channels.

It found one on the day it was written: `throng:terminal:flavourMissing` is forwarded to
the renderer by `daemon-events.ts` and has no preload listener, so it reaches nobody. All
five of its siblings are wired. `KNOWN_ONE_WAY` records it with the reason, and fails if
an entry there is ever fixed without being removed.

## Type-checking covers the renderer too

`npm run typecheck` runs **two** checks: `tsc -b` for the main/preload/core reference graph, then
`npm run typecheck:renderer` (`tsc -p packages/ui/tsconfig.renderer.json`) for the renderer —
`packages/ui/src/renderer`, every `.tsx`, the whole editor and preferences UI. The renderer is
*built* by Vite (which strips types without checking them), so it needs its own `tsc` pass; the gate
now runs it, and CI's "Lint & type-check" job runs `npm run typecheck`, so a renderer type error
fails locally and on CI.

This was once a hole (issue #82): `tsc -b` walks `packages/ui/tsconfig.json`, which includes only
`src/main`/`src/preload`, so the renderer was never checked — a type error there compiled, shipped,
and failed at runtime with a green `typecheck`. It had bitten: a call passing the wrong argument
shape left the editor's keymap rebuilt with an undefined dependency, so Tab and Shift+Tab threw from
the moment the user changed any key binding. A guard now keeps the gate honest —
`packages/ui/tests/unit/renderer-typecheck-gate.test.ts` fails if the renderer check is ever unwired
from `npm run typecheck`.

You can still run just the renderer's check while iterating:

```
npm run typecheck:renderer
```
