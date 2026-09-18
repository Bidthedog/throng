# Contract: detection, resolution and project membership

**Feature**: 045 | **Requirements**: FR-003 – FR-013, FR-020 – FR-026, FR-070 – FR-073

One set of rules, used by both panel types (FR-010). Everything here is a **pure function in
`packages/core`**; every OS fact it needs arrives as a parameter or through a port
([platform-ports.md](./platform-ports.md)). Types are in [../data-model.md](../data-model.md) §1–§2.

---

## §1 Detection — what becomes a candidate

`detectPathCandidates(line, claimed)` scans one line of text and returns zero or more
`LinkCandidate`s. Guarantees:

| # | Guarantee | FR |
|---|---|---|
| D1 | Every form in FR-003a–f is recognised without markup | FR-003 |
| D2 | A span overlapping any range in `claimed` (the web-link ranges) yields no candidate | FR-009 |
| D3 | `text` never contains a position; `position` and `positionText` carry it | FR-004 |
| D4 | Trailing `)` `]` `,` `.` `:` `;` are excluded unless they are part of a path that resolves | FR-005 |
| D5 | An unbalanced enclosing bracket is excluded; a balanced pair inside a path is kept | FR-005 |
| D6 | A path in matching quotes is one candidate, spaces included, quotes excluded | FR-005 |
| D7 | Scanning is over the given line only; nothing reads the buffer, the document or the disk | FR-071, FR-073 |
| D8 | The function is total and side-effect free — the same line always yields the same candidates | FR-010 |

**Ambiguity is expressed as two candidates, not resolved here.** `C:\x\foo.ts:42:7` yields the
reading *with* the position and the reading *without*, in that order. `foo.ts(42,7)` likewise.
§2 R7 picks.

**D2 is why the file provider runs after the web one.** The terminal passes the ranges
`TERMINAL_URL_REGEX` matched; the editor passes the ranges its own URL scan matched. A span is never
both (FR-009), and the rule is stated once rather than falling out of alternation order.

---

## §2 Resolution — candidate to one absolute location

`resolveCandidate(candidate, ctx)` is pure and returns an **ordered list of absolute paths to try**.
Main walks the list and takes the first that exists (FR-006, FR-020). `ctx` carries
`{ baseDirectory?, projectRoot: string | null, pathForms: IPathForms }`.

| # | Rule | FR |
|---|---|---|
| R1 | The list is tried in order and the **first location that exists wins**; an empty list, or a list where none exists, is a non-link | FR-006, FR-024 |
| R2 | A drive form (`D:\…`, `D:/…`) and a UNC form (`\\s\h\…`, `//s/h/…`) map to themselves, **exactly as written** — see the amendment below | FR-003b, FR-003c |
| R3 | `/<letter>/…` and `/mnt/<letter>/…` map to that drive, via `IPathForms.fromDriveForm` | FR-025 |
| R4 | `~/…` maps through `IPathForms.fromHomeForm` | FR-025 |
| R5 | A **relative** path is tried against `baseDirectory` first, then `projectRoot` | FR-022, FR-023 |
| R6 | A **leading-`/`** path that is not a drive form is tried against `projectRoot` **first**, then as the platform's own meaning | FR-024 |
| R7 | The reading **with** a position is tried before the reading without; whichever resolves first decides whether the trailing `:42:7` was a position or part of the name | Edge case |
| R8 | A `file:` URI (a hyperlink target, or FR-003f text) is percent-decoded, host→UNC, no-host/`localhost`→local, by `IPathForms.fromFileUrl` | FR-012 |
| R9 | On Windows, a POSIX path with no project-root match and no drive form is **not otherwise mapped** — no WSL filesystem access | FR-025, Out of scope |
| R10 | An untitled buffer supplies no `baseDirectory`, so R5 tries the project root alone | FR-022 |
| R11 | `projectRoot === null` (a panel with no owning project) still resolves absolute forms; R5/R6's project-root attempt is simply absent | FR-021 |

**Ordering matters and is testable**: R6 before the platform reading is #394's own `/test.txt`
example; R5's base-directory-first is the compiler-error case (US1 scenario 8).

### Amendment 2026-09-18 — R2 said "separators normalised by `IPathForms`", and that was not buildable

R2 as first written required a native drive or UNC form to come back with its separators normalised
**by `IPathForms`**. [platform-ports.md](./platform-ports.md) §1 gives that port exactly four
members — `homeDirectory`, `fromDriveForm`, `fromFileUrl`, `fromHomeForm` — and **none of them
normalises separators**. So the rule named a mechanism that does not exist, and an implementer had
two ways to resolve it. This settles which, and it is the second:

**A form the platform already understands is passed through exactly as the user wrote it.**
`D:/x/foo.ts` resolves to `D:/x/foo.ts`, and `//s/h/foo.ts` to `//s/h/foo.ts`. R2's clause about
`IPathForms` is kept for the spellings that genuinely need mapping — `/d/x`, `/mnt/d/x`, `~/x` and a
`file:` URI all come back from the port in the platform's own separators, because the port builds
those strings. Only the pass-through case changes.

Three reasons, in the order they decided it:

1. **FR-026's second sentence forbids the alternative.** "The shared rules … MUST NOT name an
   operating system." Rewriting `/` to `\` in `core/src/links/resolve.ts` means naming a separator,
   which is naming a platform. FR-026's first sentence puts *mapping between spellings* behind the
   port, and a form that needs no mapping is not an instance of it — `D:/x` and `D:\x` are one
   spelling the platform accepts two ways, not two spellings one of which must become the other.
2. **Nothing downstream can be confused by it.** Every comparison that could be — project membership
   (M6), document identity, the open-file registry, navigation history — already runs through
   `isUnderPath` / `samePath` / `normaliseForCompare`, which fold separators and case. US1 scenario
   3's five spellings therefore open one file whatever the resolved string looks like, which is what
   that scenario actually asks for.
3. **It is better for FR-032.** Copy Link Address copies the resolved path, and a user who wrote
   `D:/x/foo.ts` gets back what they were looking at rather than a respelling of it.

**What would have had to change for the other reading**: a fifth member on `IPathForms`, its doc
comment in §1, PF13 in the contract suite, and the Windows implementation — for a cosmetic
difference no FR asks for. Adding a port member with one caller and no second in sight is the
YAGNI half of Principle VIII, so the artifact is corrected rather than the code.

`packages/core/tests/unit/link-resolve.test.ts` asserts the pass-through directly, with this
reasoning beside it.

---

## §3 Project membership

| # | Rule | FR |
|---|---|---|
| M1 | `inProject` is true iff the **resolved** path lies inside the owning project's root, compared the way the platform compares paths | FR-021 |
| M2 | How the link was written never affects the verdict — `test.txt`, `/test.txt`, `C:\throng\test.txt` and `/c/throng/test.txt` all give the same answer for the same file | FR-021, US1 scenario 3 |
| M3 | A panel with no owning project judges **every** target outside a project | FR-021 |
| M4 | A panel in a sub-workspace judges against its **original** project (`Panel.originProjectId`) | Principle XI, edge case |
| M5 | A symlink or junction under the root is judged on the **location the link names**, not its destination — `realpath` is not consulted | Edge case |
| M6 | The comparison is `isUnderPath` (`core/src/fs/path-id.ts:97`). **No new normaliser is written.** | Principle VIII |

M6 is a hard rule, not a preference: `path-id.ts`'s own docstring records three existing near-copies
of this comparison. A fourth would be the DRY violation that file warns about.

---

## §4 What resolution is allowed to cost

| # | Rule | FR |
|---|---|---|
| P1 | No existence check runs on the terminal's output path or the editor's typing path | FR-071 |
| P2 | The **only** caller of the existence check is the link provider's `provideLinks` (terminal) or the visible-range `ViewPlugin` (editor) | FR-071, FR-073 |
| P3 | A location whose existence is not yet known is **not a link**: not underlined, not followable, no menu items | FR-006, FR-071 |
| P4 | An answer is cached per `(kind, text, baseDirectory, panelId)` and dropped when the location changes or the TTL expires | FR-070 |
| P5 | An unreachable network location never blocks: the request is asynchronous and the pointer, output, typing and scrolling never wait on it | FR-071 |
| P6 | A file created after the text was printed becomes a link on the **next** hover | FR-070 |

**P1/P2 are proved structurally, not by timing** (research R14): the provider module registers no
`onData`/`onWriteParsed` hook, and a unit test pushes 50,000 lines through a fake terminal and
asserts the resolver port received **zero** calls. SC-004's 5% wall-clock ceiling is measured in
the quickstart and deliberately not asserted.

---

## §5 What is never a link

| Input | Result | FR |
|---|---|---|
| Text that resolves to nothing | no underline, no gesture, no menu items | FR-006 |
| A span already claimed as a web link | web link only | FR-009 |
| An OSC 8 target with scheme `javascript:`, `data:`, `mailto:` or unknown | inert, exactly as today | FR-013 |
| A `file:` OSC 8 target that does not resolve | inert; no link targets, no menu items | FR-013 |
| Anything, while that panel type's detection switch is off — **detected paths only** | inert; explicit hyperlinks and web links keep working | FR-060 |

A `file:` URI **never** reaches the OS URL opener. `ui/tests/unit/external-url.test.ts` keeps
`file:` in its `INJECTIONS` list and must not change (FR-037).

### Note 2026-09-18 (T130) — an inert OSC 8 scheme now draws xterm's hover underline

The three inert rows above are unchanged in what they *do*, and changed in what they *look like*.
Handing a `file:` hyperlink to the link handler at all requires xterm's
`linkHandler.allowNonHttpProtocols` (see [../data-model.md](../data-model.md) §8), and that option is
per-handler, not per-scheme: turning it on hands over **every** non-`http(s)` target, so
`javascript:`, `data:`, `mailto:` and unknown schemes are now underlined on hover where before xterm
discarded them before it built a range.

They remain inert on every gesture — `classifyTerminalLinkTarget` closes by default, so nothing
follows them, no link items appear on the menu and nothing reaches the OS URL opener. The underline
is the whole of the difference, and it is the price of US2 existing at all rather than an oversight:
without the option the feature's founding report (SC-005) could not be delivered.
