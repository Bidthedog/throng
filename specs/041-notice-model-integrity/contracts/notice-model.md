# Contract: the notice model, after 041

**Feature**: 041 · **Supersedes nothing.** This is a delta against
[030's `contracts/notice-api.md`](../030-failure-presentation/contracts/notice-api.md); every shape it
does not mention is unchanged.

Two audiences: the raise sites that report a casualty, and the surfaces that render one. The rule
that makes this a contract rather than a description is that **both halves must agree about
identity** — the raiser decides what a casualty *is*, and the renderer de-duplicates on that decision.

---

## 1. `AffectedCasualty` (widens `AffectedPanel`)

A **union of two forms** (FR-007e), not one shape with everything optional:

```ts
/** Unchanged from today's AffectedPanel, plus two optional fields. */
export interface AffectedPanel {
  panelId: string;
  panelName: string;
  tabId: string;
  tabName: string;
  tabOrder: number;
  panelOrder: number;
  subject?: string;
  reason?: string;
  /** The project-relative path (FR-018). */
  displayPath?: string;
  /** Absolute path + raw error. Copy and the log only — never rendered (FR-018c). */
  detail?: string;
}

/** A refused open (FR-013): no panel exists, so the pair IS the identity. */
export interface AffectedSubject {
  panelId?: undefined;
  subject: string;
  reason: string;
  displayPath?: string;
  detail?: string;
}

export type AffectedCasualty = AffectedPanel | AffectedSubject;
```

**The union is the enforcement.** A panel-less row cannot omit its identity, and a panelled row is
byte-identical to today's — so **no existing caller changes and no existing test is rewritten**. That
is not convenience: those tests exist to prove the old behaviour, and a widening that edits them can
no longer prove it was preserved.

### Identity — a fallback, not a composite

```ts
export function casualtyKey(c: AffectedCasualty): string {
  return c.panelId ?? `${c.subject}${NUL}${c.reason}`;
}
```

**The panel supersedes the pair** (FR-007aa). Not a shortcut — a notice consolidates one cause or one
operation (030 FR-035/036), and within one of those a given panel fails once, so `reason` cannot
separate two rows sharing a panel. Folding it in would undo 030 FR-037a. The same panel defeated by a
*different* cause is a different **notice**, decided by `groupKey`; row identity is only asked inside
a notice, where the cause is already fixed.

### The emitted shape widens too

`groupAffected` returns what the renderer consumes, and `AffectedRow` requires `panelId: string`:

```ts
export interface AffectedRow {
  panelId?: string;        // WAS required
  label: string;
  displayPath?: string;    // NEW — what a panel-less row renders
  detail?: string;
}

// UNCHANGED signature — still the panelled rows, still grouped by tab.
export function groupAffected(...): readonly AffectedTabGroup[];

// NEW sibling — the panel-less rows, ordered by casualtyKey.
export function ungroupedAffected(...): readonly AffectedRow[];
```

**A sibling function, not a changed return.** `groupAffected` has four consumers — `affectedDetails`
inside `affected.ts` itself, `notice-text.ts`, `notification.tsx` — and five destructuring sites in
`affected.test.ts`. Changing its return breaks all nine, which collides head-on with the widening's
own rule that no pre-existing test is edited. It is also the honest shape: grouping rows by tab and
listing rows that have no tab are two operations, not one with a wider result.

Panel-less rows do **not** go into a synthetic tab group with a blank label either — a blank label
already means something else (`affected.test.ts` asserts a blank-named tab keeps its rows under an
empty heading), and reusing it makes two different things indistinguishable.

The renderer keys panelled rows on `panelId` as today and panel-less rows on `casualtyKey`.

**`affectedDetails` must project both.** It currently flat-maps `groupAffected` alone, so a
panel-less casualty's absolute path would never reach the diagnostics log — a silent breach of
FR-005a, and the quietest possible one, because the value that goes missing is never rendered.

> `NUL` is `String.fromCharCode(0)`. Never write the byte as a literal in source — it makes git treat
> the file as binary and every subsequent change to it becomes invisible to review.

### Merge

`mergeAffected` and `joinedPanels` change **only** their key function, from `p.panelId` to
`casualtyKey(p)`. Their contract is otherwise word-for-word 030's, including the load-bearing
identity return:

> Returns the ORIGINAL array when nothing joined, and that identity is load-bearing rather than an
> optimisation.

That return is what 041 now hangs the flash on (§3), so it becomes more load-bearing, not less.

---

## 2. Rendering

| Row | Renders | Grouped under |
|---|---|---|
| has a panel | `formatSubject({ kind: 'panel', … })` | its tab, in `tabOrder` / `panelOrder` |
| no panel | `displayPath`, same formatter, same per-part truncation | nothing — one ungrouped section, after every tab group, ordered by `casualtyKey` |

**Invariant (FR-004, 029 FR-016, 030 FR-034)**: no raw system error string is rendered on any notice.
`detail` reaches Copy (`noticeToText`) and the diagnostics log (`affectedDetails`) and reaches the DOM
by no path at all. This is true today and the widening must not change it.

---

## 3. `flash(noticeId)` — the new transition

Called where the model previously returned silently.

| Site | Today | After |
|---|---|---|
| `mergeAffected` returned the original array | `return` | `flash(target.id)` |
| an identical notice is raised again | `return` | `flash(existing.id)` |

```ts
function flash(id: string): void;   // FR-008a
```

**Exactly two effects, and no others:**

1. **Pulse** the notice card — a transient class, cleared on animation end.
2. **Restart** that notice's dismissal timer from its configured timeout.

**Nothing is added, nothing changes, no count is rendered** (FR-008d). The list does not move, does
not scroll, and does not take focus (FR-010).

| Display mode | Behaviour |
|---|---|
| `timed` | pulse + restart the timer (FR-008a, FR-008b) |
| `dismiss` | pulse only — there is no timer (FR-008c) |
| `never` | **not raised, not pulsed** (FR-008c) — the silenced shadow's existing behaviour is unchanged |

### Absorption (FR-008e)

A repeat arriving while a pulse is in flight is absorbed: the timer is restarted, no second pulse is
queued. A queue of pulses would make the notice twitch for as long as the user kept trying.

### Announcement (FR-011a, FR-011b, FR-011c)

**One announcement per pulse.** Polite, naming the recurring subject, and it **must not** contain the
casualty list — 030 FR-032a stands. A repeat absorbed into a running pulse is not separately
announced.

> The bound is the pulse, deliberately, and not a duration: it introduces no timing constant, and it
> gives a guard that counts utterances against pulses rather than racing a clock.

---

## 4. `focus.notice`

```ts
'focus.notice': EVERYWHERE            // keybindings.ts COMMAND_SCOPES
'focus.notice': ['Ctrl+Alt+M']        // keybindings.ts default chords
```

| Property | Value | Requirement |
|---|---|---|
| Scope | `EVERYWHERE` = `{ editor, terminal, explorer }` | FR-020a |
| Default chord | `Ctrl+Alt+M` — unbound today, neither constitutional tier | FR-020b |
| Target | the **most recent** live notice | FR-020 |
| Repeat press | **idempotent** — same notice, never cycles | FR-020d |
| In `focus.cycle` ring | **no** | FR-020c |
| No notice on screen | nothing happens; **no notice is raised to say so** | FR-024 |
| A notice arrives while one is focused | focus does not move | FR-020e |
| Menu item | **none** — the whole `focus.*` family is navigational, exempt under Constitution VI | see research Finding 4 |

### Focus return

| Event | Focus goes to |
|---|---|
| Escape | the element focused **before the binding was pressed** (FR-022) |
| Escape after tabbing on to another notice | still that element — the origin is captured at the press and is not re-captured by Tab (FR-022a) |
| Escape when the origin is destroyed | a real focusable surface, never the document body (FR-022b) |
| the focused notice is dismissed or times out | where it came from, never the body (FR-026) |
| Tab | out of the notice — focus is never trapped (FR-023) |

The affected-list container already carries `tabIndex={0}`, so FR-021 and FR-023 hold structurally
today. What 041 adds is the route (FR-020) and a **visible affordance that the list is focusable
before focus arrives** (FR-025).

---

## 5. The refusal rides on `OpenDecision` — **no new IPC method**

The obvious design is a new `probeOpenable` call. It is the wrong one, and the reason is arithmetic:
every open path already awaits `editor.openInto`, so a separate probe makes an *accepted* file cost
two round-trips to save the refused one a panel. Instead the answer joins the decision the caller
already switches on.

```ts
// packages/core/src/editor/open-registry.ts — one new variant
export type OpenDecision =
  | { action: 'focus'; panelId: string; windowId: string }
  | { action: 'open' }
  | { action: 'refuse'; reason: RefusalReason };   // NEW
```

`openInto` already returns `focus` (the file is open elsewhere) or `open` (go ahead). `refuse` is the
third truthful answer to the same question, and a caller that fails to handle it **fails to
compile** — which is the enforcement, rather than a convention every future entry point has to
remember. FR-013a binds *every* entry point, and this is what makes that cheap to hold.

| Path | `action` |
|---|---|
| a text file within the project | `open` |
| already open elsewhere | `focus` |
| **a missing file** | **`open`** |
| binary / too-large / out-of-tree / folder | `refuse`, with that reason |

**A missing file returns `open`.** Its recovery path — a panel holding a recovered buffer that can be
saved back — is unchanged by this feature (FR-015), and flipping this one branch destroys something
018 shipped. It is the single highest-value assertion in the integration suite.

`openOrFocus` stays pure; the refusal needs a `stat`, so **main** performs it in `editor-coordinator.ts`
and returns the variant.

### `NOT_A_MISSING_FILE` moves to `@throng/core`

It currently lives in `packages/ui/src/renderer/editor/editor-missing-notice.ts` — a **renderer**
module. Main cannot import that, and the enumeration of what counts as a refusal is a pure domain
decision with two consumers in two processes, which is precisely Constitution II's test.

It moves to `packages/core/src/editor/`, **re-exported from its current home** so no existing caller
changes. It remains the single enumeration; nothing restates it.

### Callers (FR-013a)

Every entry point that would **create** a panel:

| Entry point | File | Already awaits `openInto`? |
|---|---|---|
| open from Files & Folders | `editor-open.tsx` → `openFileInTab` → `createDedicatedEditor` | yes |
| `openTarget: 'new'` | `editor-open.tsx` → `openFileInNewEditor` | via `openFileInTab` |
| Quick Open | its open call, via the same `openFileInTab` | yes |
| a drop that would create a panel | `openFileInPanel`'s `createDedicatedEditor` fallback | yes |

Every one of them already awaits `openInto`, which is why the `refuse` variant reaches all four for
free and why the performance goal ("no added round-trip") is met rather than merely asserted.

**Not** a drop onto an existing panel — it creates nothing and is unaffected (FR-013b). **Not**
workspace restore or an explicit new-panel command — they are not open-a-file actions (FR-017).

### Reporting a refusal with no panel

`useReportPanelFailure` today opens `const place = locate(…); if (!place) return;`. That guard must
stay for a panel that was destroyed mid-flight, but a refusal that never had a panel must **not** take
it — it reports a panel-less casualty carrying `subject`, `reason` and `displayPath`.

> This is the single highest-risk line in the feature. Getting it wrong turns "no panel is created"
> into "no panel and no notification", which is worse than the bug being fixed.

---

## 6. Removal suppression

```ts
function isSuppressedByAncestor(
  removedPath: string,
  projectRoot: string,
  isAbsent: (path: string) => boolean,     // INJECTED — see below
): boolean;                                                                          // FR-003c
```

Walks up from `removedPath`, bounded at `projectRoot`, and returns `true` when any ancestor is also
absent.

**`isAbsent` is a parameter, not an import**, for two reasons that happen to agree. It lives in
`@throng/core`, where a filesystem call would breach Constitution II (Platform-Abstracted Core) and
Constitution IX (the composition root supplies the implementation). And SC-006f's permutation sweep —
every arrival order of five events — is only affordable as a unit test if the absence answer is a
function the test supplies rather than a directory tree it has to build.

- **Decidable from the removal alone.** No dependence on having seen the ancestor's event, and **no
  buffering** — a wait is the grouping by time that FR-003b and 030 FR-036 forbid.
- **Order-independent by construction**, which is what SC-006f measures by permuting arrival order
  rather than by waiting.
- A notice is **never raised and then amended** to name a different subject (FR-003d).

**The renderer MUST call this, not re-decide.** `use-explorer-data.ts` resolves absence for the
ancestors `ancestorsWithinRoot` names — that walk is shared, so a call site cannot probe paths the
predicate never reads — and then asks this function. It first shipped with its own equivalent loop,
which meant the rule had two statements and the tests exercised the one production did not run: every
assertion in `ancestor-suppression.test.ts`, SC-001 and SC-006f included, stayed green with the
renderer's suppression deleted outright (T062). One statement of a rule is the point of putting it in
core at all, and `explorer-storm-suppression.test.ts` is what now fails if the call goes away.

Suppression is a **presentation** rule: a suppressed casualty still reaches the diagnostics log, at
the cause's own level, never demoted to debug (FR-005a, FR-005b). One removal defeating five tree
nodes is **one notice and five log entries**.
