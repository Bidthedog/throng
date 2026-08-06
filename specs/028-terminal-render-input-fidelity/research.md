# Research: Terminal Render & Input Fidelity (028)

**Date**: 2026-07-31 · **Constitution**: v4.3.1 · **Spec**: [spec.md](./spec.md)

The spec is diagnosis-gated (FR-001): no fix may be designed against an inferred mechanism. This
document records what the code actually does, measured by reading the shipped paths end to end.

---

## D1 — #162: why a terminal comes back wrong from a tab switch

### The decisive fact: an inactive tab is not hidden, it is destroyed

`packages/ui/src/renderer/workspace/tab-group.tsx:738` renders **only the active tab's** split tree:

```tsx
{activeTab ? <SplitTree node={activeTab.root} tabId={activeTab.id} path={[]} /> : null}
```

So switching tabs **unmounts every panel in the outgoing tab and mounts every panel in the incoming
one**. A terminal panel does not become hidden — its xterm is disposed, its view is detached from the
daemon session, and returning to that tab constructs a brand-new xterm that re-attaches.

This falsifies the spec's own framing in one useful way: FR-016's "must not run for a terminal the
user cannot currently see" is nearly vacuous (there are no hidden terminals in a tab), and the
2-second repaint's `container.offsetParent === null` guard only ever fires for a collapsed pane. What
matters is not *hiding*, it is **teardown and rebuild**.

### What a rebuild replays

The daemon keeps, per session (`terminal-service.ts:40,413`):

```ts
const MAX_SCROLLBACK = 64 * 1024;
session.scrollback = (session.scrollback + chunk).slice(-MAX_SCROLLBACK);
```

A **raw byte tail**, sliced at a fixed byte count. On re-attach it is handed back and written into the
fresh xterm (`use-terminal.ts:744`). Three consequences, each independently sufficient to garble:

1. **The slice cuts mid-escape-sequence.** `slice(-65536)` lands wherever it lands. The replay can
   begin halfway through a CSI or OSC sequence, which xterm parses as garbage — and an OSC cut before
   its terminator swallows the following output as a string payload.
2. **The alternate-screen switch falls out of the window.** A full-screen program (Claude Code, vim,
   tmux) emits `CSI ?1049h` once, on entry. After 64 KB of output that byte sequence is long gone from
   the tail, so the replay paints the program's *absolute-positioned delta updates* onto the **normal**
   buffer. Overlapping glyphs and fragments of earlier frames are exactly what that produces.
3. **Absolute positioning assumes the old width.** The tail is full of `CSI row;col H`. Replayed into a
   view of a different width, every one of them lands in the wrong place — the reporter's
   "differently-sized tabs" condition (FR-019a), and the reason wrapping looks wrong.

### Why nothing self-heals it, and why a resize does

`recomputeGrid` (`terminal-service.ts:451`) returns early when the grid has not moved:

```ts
if (cols === session.grid.cols && rows === session.grid.rows) return;
```

No grid change → no `host.resize` → **no SIGWINCH** → the running program is never told to redraw. It
believes its screen is intact and continues to send only deltas. So:

- **The 2-second `term.refresh()` cannot fix it.** `refresh` re-renders visible rows *from the buffer*,
  and the buffer is what is wrong. This confirms the issue reporter's own instinct and rules out the
  render layer.
- **A divider drag fixes it instantly.** It changes the grid, which reaches `host.resize`, which
  SIGWINCHes the program, which repaints its entire screen from its own authoritative state.

Every reported symptom follows: worst with Claude Code (alt screen, absolute positioning, high output
volume so the 64 KB window turns over in seconds), worst when switching between two tabs of one
project (each switch is a teardown/rebuild), and cured every time by a resize.

**Decision**: the fix is to make a rebuilt view ask the program to repaint, rather than to reconstruct
the program's screen from a byte tail that cannot represent it. Plus one bounded correctness fix to
the tail itself so a replay never begins mid-sequence.

**Alternatives considered**:

- *Replay a server-side headless emulator's screen state.* Correct in principle and much larger: it
  needs a full terminal emulator in the daemon, kept in step per session, and it still cannot know
  what a program would draw. Rejected as disproportionate; recorded here as the end-state answer if
  the nudge proves insufficient.
- *Repaint harder in the renderer.* Ruled out by measurement — the buffer is wrong, so no amount of
  re-rendering it helps. This is what the issue warned against and what the 2s timer already proves.
- *Suppress the replay entirely for a running session.* Loses the scrollback users expect on return to
  a tab; the normal-buffer history is genuinely useful and genuinely correct.

---

## D2 — the forced repaint: what actually makes a program redraw

A program redraws its whole screen when the PTY tells it the window changed. The only portable trigger
is a **grid change**, which is why the manual nudge works. To force one without leaving the terminal a
different size, the grid is moved and restored: `rows-1`, then back to `rows`. Both are real resizes
to the program (two SIGWINCHes, two full repaints — the second at the correct size), and the terminal
ends where it began, so no layout, scrollback, cursor or selection state is disturbed.

`rows` is nudged rather than `cols` deliberately: a column change makes a shell **reflow** its wrapped
lines, which is visible churn; a row change does not reflow anything on the normal buffer, and on the
alternate screen the program repaints wholesale either way.

**Decision**: one daemon operation, `terminal.repaint`, performs the nudge. Both the automatic path
(#162, on attach) and the manual action (#163) route through it — one mechanism, one place to be
correct, which is also what FR-047 demands (it must work when the measured size is unchanged).

**Alternatives considered**: sending the program a redraw key (`Ctrl+L`) — rejected outright, it is
*input*, it means different things in different programs, and FR-044 forbids injecting input. Asking
xterm to `reset()` — destroys scrollback, forbidden by FR-043.

---

## D3 — #187: why the wheel is dead in a full-screen program

xterm.js scrolls the viewport on a wheel event **on the normal buffer**. On the **alternate screen**
there is no scrollback to scroll, so xterm forwards wheel notches as arrow keys only when the program
has enabled DEC private mode 1007 (*alternate scroll mode*). Claude Code does not enable 1007 — so the
wheel reaches xterm, xterm has nothing to scroll and no mandate to translate, and nothing happens.
That is the whole of the reported "wheel does nothing", and it is a *design* gap rather than a
corruption: the pre-existing `conformGrid` repaint (`use-terminal.ts:646-660`) fixed a genuinely
different case (a never-rendered viewport with no scroll area) and could never have fixed this one.

Pressing `PageUp` "primes" it only incidentally: it is Claude that scrolls, not throng.

**Decision**: attach a custom wheel handler and decide explicitly, per FR-035/035a:

| Buffer | Program claimed mouse reporting | Behaviour |
|---|---|---|
| normal | no | xterm scrolls the viewport (unchanged) |
| normal | yes | the program receives the wheel (unchanged) |
| alternate | no | **translate to arrow keys** — 3 per notch, matching the platform scroll step |
| alternate | yes | the program receives the wheel (unchanged) |

Mouse reporting is already observable: `use-terminal.ts:517` snoops `CSI ? … h/l` for the win32-input
gate, so modes 1000/1002/1003/1006 can be tracked at the same seam with no new machinery.

**Alternatives considered**: enabling xterm's own alternate-scroll option — it is keyed off the
program enabling 1007, which is the thing that is not happening. Scrolling throng's scrollback while
on the alt screen — rejected in clarification: the view would jump between two unrelated contexts.

---

## D4 — #200: where a keystroke can be lost

Two candidate paths survive reading:

1. **Focus lands late.** On mount the view calls `focusIfActive(term)` (`use-terminal.ts:560`) and
   again after the async attach resolves (`:778`). A tab switch rebuilds the panel, so a user who
   clicks and types in the same beat can produce a `keydown` before xterm's hidden textarea holds
   focus; that key goes to `document.body` and is lost. This fits the report exactly — *first*
   character only, after a switch into the panel.
2. **A write races the attach.** `term.onData → bridge.write` is wired at mount, before attach
   resolves. A write arriving for a session mid-attach is handled by the daemon against an existing
   session, so this is the weaker candidate — but it is cheap to fence.

**Decision**: make the panel's own pointer-down synchronously move focus into the terminal's input
surface, and fence both paths with counters (FR-009) so a test can prove *which* one fired. Prove the
fix with a fast deterministic gate (FR-024a) that activates a panel and types in the same tick.

---

## D5 — #198: the alternate screen is still the only untested condition

Recorded on the issue and unchanged by this reading: on the normal buffer all four link shapes open
exactly once, and xterm's `Linkifier2` consults registered providers only where no OSC link matched,
so the two-handler mechanism the issue proposes cannot fire there. Feature 026 committed four "exactly
once" fences (`packages/ui/tests/e2e/terminal-link-once.e2e.ts`, on master).

**Decision**: extend the fence to the alternate screen by driving the terminal to the alt screen and
emitting the hyperlink directly (the condition under test is the screen buffer, not who wrote the
bytes). Per FR-055b–c the disposition is then gated on the maintainer's own hand-verified check.

---

## D6 — observability (FR-009)

**Decision**: a per-session counter record in the renderer, incremented at each reconciliation trigger
and at each input write/ack, exposed on `window.__throngTerminalDiagnostics` for tests. No allocation
per keystroke (integers on a plain object), nothing surfaced in the UI, no persistence.

Its real job is enforcement: FR-014b says a reproduction must not pass merely because the backstop
fired, and that is only checkable if the backstop's firings are counted.

---

## Test layers available in this repo

`vitest` projects **unit / integration / contract** (`vitest.config.ts`), and **Playwright-Electron**
E2E (`packages/ui/tests/e2e`). There is no component-test stack — no jsdom React renderer — so
renderer behaviour is proven by pure-logic unit tests over extracted decision functions plus E2E
against the real app. Tasks are shaped to those four layers only.

---

## D7 — the nudge corrupted the screen it existed to repair (found during implementation)

The first cut of `terminal.repaint` issued both resizes in the same tick: `rows-1`, then `rows`. It
passed every unit test and both new E2E specs run on their own.

Under **parallel load** it failed every time. Three rapid `Ctrl+F5` presses became six interleaved
resizes, and ConPTY had not finished repainting at the intermediate size before the next one arrived.
The half-finished repaint left a row filled with **one repeated character** — the last cell of the
row above, smeared across the grid. That is precisely the symptom #162 describes, produced by #162's
own fix.

It was found because the redraw action's E2E asserts the fence line is still on screen afterwards
rather than merely that the menu item exists — an assertion about the *state that would diverge*
(FR-006b) rather than a proxy. The received text named the mechanism outright: 32 identical
characters where a line of output should be.

**Fix**, both parts load-bearing:

1. **The restore happens on a later tick** (`REPAINT_RESTORE_MS = 60`), so the program can act on the
   first window change before the second arrives. One row smaller for 60ms is imperceptible.
2. **A repaint already in flight coalesces further requests** rather than stacking on them, so a user
   leaning on the chord cannot outpace the terminal.

Verified 12/12 under 6-way parallel load, where it had failed on every run.

**Separately**, reserved terminal chords now cancel the browser default. Returning `false` from
xterm's key handler stops xterm processing but does not `preventDefault`, which was harmless while
every reserved chord was one Chromium ignores — `Ctrl+F5` is its **hard-reload** accelerator, so a
redraw request could have torn down the whole renderer instead.

## D8 — which probes reddened, and which proved nothing (T005, FR-006d/006e/006f)

The diagnosis fences were written to fail against `master` first. Recording which ones actually did
matters more than usual here, because the ones that did NOT are the reason this feature took as long
as it did.

**Reddened, and kept.**

| Probe | What it caught |
| --- | --- |
| `terminal-tab-switch-render` | the core of #162 — a rebuilt terminal showing what the byte tail said rather than what the program believed |
| `terminal-altscreen-fidelity` | clicking into an alternate-screen terminal wiped it; a rebuilt view no longer knew which screen the program was on |
| `terminal-redraw-action` | the redraw action itself, and that a requested redraw is not mistaken for a screen clear |

**Never reddened, and since removed.** `terminal-modified-keys` and `terminal-word-editing` were the
branch's first two chord probes, and neither could ever have failed for the reported defect.
`terminal-word-editing` says so in its own header — *"these PASS against the pre-fix build as well —
verified by disabling `encodeModifiedKey`"* — because at a PowerShell prompt both chords already
worked; the defect lived in a negotiated program. `terminal-modified-keys` asserted only that the
bytes differed from an unmodified key, which is true of almost any encoding, right or wrong.

Both were deleted once `terminal-editing-matrix` covered the same chords by OUTCOME across all four
shells, and `terminal-kitty-editing-keys` pinned the negotiated encodings exactly. `terminal-refresh`
was retargeted in the same pass: it asserted the periodic repaint was non-destructive, and the
periodic repaint no longer exists, so it now pins that no timer fires and an idle terminal does not
need one.

**Did not redden, and were deleted.** Five stand-in programs — fixtures negotiating kitty, owning the
alternate screen, or repainting only on resize — passed every assertion while the reported chords
stayed broken in the real program. Each stand-in was a guess at what Claude Code does, and each was
close enough to pass and wrong enough to prove nothing. They were removed rather than left green:
a fixture that cannot fail is worse than no fixture, because it reads as coverage.

What replaced them is `terminal-claude-keys.e2e.ts`, which drives the real binary, and the
`terminal-editing-matrix` chord table, which makes the SHELL compute the answer rather than asserting
on bytes. The general lesson is recorded because it cost the most: **a byte-level assertion answers a
question nobody asked.** "throng sent 0x08" and "the word was deleted" are different claims, and
three separate fixes were declared on the strength of the first while the user's chord stayed broken.

**Conditions ruled out for the issue comments (FR-006f).**

- **#162** — not a rendering bug in xterm, and not a resize bug. The screen is reconstructed from a
  replayed byte tail that cuts mid-sequence and ages out the alternate-screen switch; the program is
  the only authority for its own screen, which is why a divider drag cures it and a buffer repaint
  never does.
- **#187** — not a lost event. The gesture arrives; xterm has nowhere to send it, because the
  alternate screen has no scrollback and the program never enabled DEC 1007.
- **#200** — not a mangled character but an absent one: the key landed on `document.body` because
  focus arrived by two late routes, and nothing downstream can recover input that was never terminal
  input.
- **#198** — does not reproduce at the `openExternal` seam. Measured for all three link shapes on the
  normal screen, and now on the alternate screen too (T004), which was the last untested condition.

## D9 — the backstop is removed, not retuned (T028a, FR-014/014a/014c)

The periodic repaint began as the primary self-heal, at two seconds. It was reduced to eight, and is
now **gone entirely** — at the maintainer's call, and consistent with what D1 established.

The reasoning is the same one that invalidated it as a cure: the timer called `term.refresh()`, which
re-renders the visible rows **from the buffer**. When the buffer itself is what is wrong — which is
exactly the #162 condition, a screen reconstructed from a byte tail that cannot describe it — painting
it again paints the same wrong thing. It could never have fixed the defect it was aimed at, and
nothing measured here was ever fixed by it firing.

What replaced it is event-driven and already in place: a rebuilt view asks the program to redraw, and
the program is the authority. So there is no period left to state, and no period to unit-test. The
requirement is instead asserted the other way round, in `terminal-input-idle.e2e.ts`: the backstop
counter must read **zero**, so a reproduction can never pass because a timer happened to fire
(FR-014b).
