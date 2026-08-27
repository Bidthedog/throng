# Phase 0 Research: Notice-Model Integrity

**Feature**: 041 · **Date**: 2026-08-26 · **Spec**: [spec.md](./spec.md)

The spec had no `NEEDS CLARIFICATION` markers — three clarification passes closed thirteen questions
before planning began. So this document is not a list of unknowns resolved. It is the **code reading
that the spec's restoration claims had to be checked against**, and it is here because two of those
claims turned out to be wrong about the code, and one mechanism turned out to be shared between two
issues that the spec treats as separate groups.

Everything below cites the file it was read from. Where a finding contradicts the spec, it says so
and names the requirement.

---

## Finding 1 — #327 and #328 are one root cause, and fixing #327 breaks #328's only de-duplication key

This is the most consequential thing in this document, and it is the reason FR-007b exists.

**How a refused open reaches the user today.** `openFileInTab` (`editor-open.tsx:82`) resolves a
target editor; when the tab has none, it calls `createDedicatedEditor` (`editor-open.tsx:196`), which
does `ws.addPanel(tabId)` and then `setPanelType(newId, 'editor', { filePath })`. The panel exists
*before* anything has tried to read the file. The editor then loads, fails, and `use-editor.ts:597`'s
`maybeWarn` reports the casualty through `useReportPanelFailure`.

The function's own doc comment states the consequence plainly:

> *NOT a report on whether the document loaded … a file that is missing or too large is reported by
> the editor itself, and by then the open HAS happened — the user is looking at that editor and at
> that message.*

So #327 is not an oversight in the notice layer. **The panel is created because nothing asks whether
the file is openable until after there is a panel to ask from.** FR-013 therefore needs a decision
point that does not exist yet — a probe before creation — not a change to how the refusal is
reported.

**Why that breaks #328.** `useReportPanelFailure` opens with:

```ts
const place = locate(layoutRef.current, report.panelId);
if (!place) return;
```

`locate` (`panel-failure-notice.ts:97`) searches the window's layout for the panel. **No panel, no
report** — silently. That guard is correct today (a panel destroyed between failure and render must
not get an invented row, FR-027), but the moment FR-013 stops creating the panel, every refused open
takes that early return and the user is told *nothing at all*. FR-014 forbids exactly that.

**And the row identity has nowhere to go.** `AffectedPanel` (`affected.ts:38`) requires `panelId`,
`tabId`, `tabName`, `tabOrder` and `panelOrder`; `mergeAffected` and `joinedPanels` de-duplicate on
`panelId` alone. With no panel there is no key, so the "at most one row per casualty" rule of FR-007
is not merely unimplemented — it is **unstateable** in the current model.

**Where #328's duplicate row actually comes from.** With `editor.openTarget: 'new'`
(`editor-open.tsx:105`), a not-yet-open file lands in a brand-new panel *every time*. Each attempt
therefore carries a different `panelId`, `mergeAffected` sees a genuinely new panel, and the row is
appended — correctly, by its own rules, for a casualty the model believes is new. Under the default
`lastActive` the second attempt reuses the broken editor, `mergeAffected` returns `existing`
unchanged, and `notification.tsx:472` takes `if (merged === existing) return` — a **silent no-op**
where FR-008 wants a flash.

So the two halves of #328 are:

| Symptom | Mechanism | Requirement |
|---|---|---|
| The row duplicates | a new panel per attempt gives a new de-dup key | FR-007b (key on the casualty, not the panel) |
| The repeat is silent | `merged === existing` returns without telling anyone | FR-008, FR-008a (flash) |

**Decision**: generalise the affected-panel list to a casualty list with an optional panel, keyed on
`(subject, reason)` plus the panel where there is one, and add a raise path that does not require
`locate` to succeed. This is what FR-007b/FR-007c/FR-007d already specify; the research confirms it
was necessary rather than tidy.

**Alternatives rejected.** Keeping `AffectedPanel` and synthesising a placeholder panel id for a
refused open — rejected because it puts a fabricated panel into a list whose `data-panel-id` is
load-bearing for FR-038's "does every listed panel still show its own failure?" assertion, and 030
FR-027 forbids placeholder rows. Reporting refusals through a second, separate notice shape — rejected
by FR-007a, and it would have made #278 and #328 two mechanisms again.

---

## Finding 2 — FR-018b's premise is false: the detail is genuinely never rendered

The spec says:

> **FR-018b**: … `editor-missing-notice.ts` currently documents its detail as *"copied and logged,
> never rendered (FR-034)"* while a path is plainly rendered. The comment is the part that is wrong.

**The comment is correct.** The row render (`notification.tsx:855`) emits `{row.label}` and nothing
else; `row.detail` is carried in `AffectedRow` and consumed only by `affectedDetails`
(`affected.ts:160`), which feeds the log record, and by `noticeToText` for Copy. There is no code path
that renders `detail` to the DOM. `missingFileDetail` (`editor-missing-notice.ts:89`) is therefore
described accurately by its own comment.

What a row *does* render is `formatSubject({ kind: 'panel', name: panel.panelName, … })` — the
**panel's name**, not a path.

**This does not overturn FR-018.** Rendering the subject's project-relative path on a row was a
deliberate clarification decision (session 2026-08-26, Q2), and it is a better one now than it looked
then: after FR-013 a refused open has *no panel*, so `panelName` — the only thing a row renders
today — does not exist for it. A panel-less row has to render something, and the project-relative
path is the thing the user would recognise.

**Decision**: keep FR-018, FR-018a and FR-018c as written. **FR-018b must be rewritten** — it
instructs a comment correction that would make an accurate comment inaccurate. The truthful version:
the comment stays, `detail` continues to carry the absolute path to Copy and the log, and FR-018's
relative path arrives as a **separate rendered field on the row**, not by promoting `detail` into the
DOM. Recorded here and applied to the spec in the analyze step.

---

## Finding 3 — #278's storm is a cause-key collision, and it needs no debounce

`useErrorNotice(error, 'explorer-error', …)` (`file-tree.tsx:144`) means the explorer holds a
**single** error slot, so five simultaneous strips are impossible. Five *notices* are not.

Main classifies a filesystem failure against `subjectOf(raw)` (`files-service.ts:557`) — the last
segment of the first path the errno quotes — producing a cause key of `path-missing:<folder>`. Five
expanded folders that vanish together produce **five different subjects**, hence five different cause
keys. `notification.tsx:536`'s `shouldSuppressForCause` compares cause keys for equality, so it
matches none of them, and the duplicate check above it compares message *and* subject — also
different per folder. Five notices, by the rules as written.

This is exactly what 029 FR-019 forbids and what FR-003c fixes: the suppression decision has to be
made **before** the cause key is minted, by asking whether an ancestor of the removed folder is also
absent. That question is answerable from the path and the filesystem alone, which is why FR-003c can
forbid buffering — no ordering guarantee is needed, because no event needs to see another event.

**Decision**: decide suppression per event by an upward absence check bounded at the project root.
**Alternatives rejected**: a coalescing window (grouping by time, forbidden by 030 FR-036 and by
FR-003b); raise-then-amend (forbidden by FR-003d, and it changes a subject after the user has read
it).

**The raw `ENOENT` on screen** is the second half of #278 and is a different defect in the same path:
the errno reaches the notice as the message rather than as `detail`. `panel-failure-notice.ts` gets
this right already — its doc comment is explicit that the raw error rides on the row as `detail` — so
the fix is at the explorer's raise site, not in the notice model.

---

## Finding 4 — the keyboard route has no blockers

- **`Ctrl+Alt+M` is unbound.** Confirmed by search over `keybindings.ts`; no chord in the file uses it.
- **`EVERYWHERE` is `{ editor, terminal, explorer }`** (`keybindings.ts:138`), and the whole `focus.*`
  family is already scoped that way (`keybindings.ts:161–166`). FR-020a needs no new scope concept.
- **The affected list is already a tab stop.** `notification.tsx:845` renders the container with
  `tabIndex={0}`. FR-021 and FR-023 are therefore already satisfied structurally; what is missing is
  a *route to it* and a *cue that it is there* (FR-025), which is precisely how 030 FR-060a describes
  the gap.

**Constitution VI — "every panel action has a menu item".** No `focus.*` command has a menu item;
`context-menu.tsx` contains none of them. The family is navigational keyboard input, which Principle
VI exempts in as many words ("continuous or navigational input whose home is the keyboard or mouse").
`focus.notice` follows that precedent, and it is not a *panel* action at all — it acts on a notice.
**Decision**: no menu item; rebindable and documented via `keybindings-metadata.ts` (FR-027), which
is what the exemption requires.

---

## Finding 5 — the flash has a home, and the timer is already owned

`notification.tsx:639` arms the dismissal timer per notice id in `timers.current`, and `dismiss`
clears it. FR-008a's two halves — pulse the card, restart that timer — both sit inside the provider
that already owns the notice list and its clocks. The spec's assumption that "flash is a small
addition to an existing surface" holds.

Two places currently return silently where a flash belongs, and both are the same decision seen at
different scales:

| Site | Today | Under FR-008 |
|---|---|---|
| `notification.tsx:472` | `if (merged === existing) return` — a repeat of a listed casualty | flash |
| `notification.tsx:521` | `if (duplicate) return` — an identical notice raised again | flash |

`announceGrowth` (`notification.tsx:367`) already exists for the *growth* announcement and is
explicitly documented as not re-reading the panel names. FR-011a's pure-repeat announcement is a
sibling of it, and FR-011c's one-per-pulse bound is what keeps it from becoming the audible form of
the row-stacking #328 is about.

---

## Finding 6 — the two refusal paths (FR-013c)

`packages/core/src/editor/drop.ts` (74 lines) holds `DropRejection`; `packages/ui/src/main/editor-service.ts`
(198 lines) holds the load-result reason. They share reason *names* — `binary`, `too-large`,
`out-of-tree`, `folder` — and `NOT_A_MISSING_FILE` (`editor-missing-notice.ts:55`) enumerates that set
once, which is the piece that already stops the two drifting on classification.

**Decision**: do not converge the two types. FR-013c only requires the same observable outcome, and
merging two independently-tested types to satisfy a requirement about behaviour is the change that is
larger than the requirement (Constitution VIII, YAGNI). The shared `NOT_A_MISSING_FILE` set is the
single point of truth for *what counts as a refusal*; the probe FR-013 needs consults that set from
both entry points.

---

## Consolidated decisions

| # | Decision | Rationale | Rejected |
|---|---|---|---|
| 1 | Generalise `AffectedPanel` → casualty with optional panel, key on `(subject, reason, panel?)` | FR-013 removes the only key the current model has | placeholder panel ids; a second notice shape |
| 2 | Probe openability **before** creating a panel | the panel is created before anything reads the file | reporting after creation and then destroying the panel — a panel that flashes into existence is worse than one that stays |
| 3 | Per-event upward absence check for removal suppression | no ordering guarantee, and time-grouping is forbidden | coalescing window; raise-then-amend |
| 4 | Flash at both silent-return sites, one announcement per pulse | the two returns are the same decision at two scales | announcing every repeat; a repeat counter (FR-008d) |
| 5 | `focus.notice`, `Ctrl+Alt+M`, EVERYWHERE, no menu item | matches the whole `focus.*` family; Principle VI exempts navigation | adding notices to the `focus.cycle` ring (FR-020c) |
| 6 | Leave `DropRejection` and the load-result reason as two types | FR-013c asks for one outcome, not one type | converging them |
| 7 | **Rewrite FR-018b** — the comment it corrects is accurate | verified against the render path | leaving it, which would instruct a wrong edit |

---

## Open risks carried into implementation

- **The probe is a new IPC round-trip on a hot path.** Opening a file from the tree already awaits
  `editor.openInto`; the openability probe should ride with it rather than adding a second await, or
  every open pays for the refusal case.
- **`missing` is not a refusal (FR-015).** The probe must return "openable" for a missing file, or the
  recovery path that lets a missing file's panel hold a recovered buffer is destroyed. This is the
  single easiest way to break something 018 shipped.
- **Workspace restore creates panels legitimately (FR-017).** The probe must sit on the *open a file*
  action, not on panel creation, or restoring a workspace containing a since-grown file would silently
  drop its panel.
