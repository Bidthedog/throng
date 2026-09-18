# Contract: detection, resolution and project membership

**Feature**: 045 | **Requirements**: FR-003 – FR-013, FR-020 – FR-026, FR-070 – FR-073;
*amended 2026-09-18*: FR-003g, FR-100 – FR-107, FR-120 – FR-123 and defect D1 — see §6.

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

---

## §6 Amendment 2026-09-18 — one scan, UNC roots, bounded checks

### §6.1 One line scan for both panel types (FR-102, FR-104)

§1's D2 said "the editor passes the ranges its own URL scan matched". **There was no editor URL
scan**: `link-decorations.ts` passes an empty `claimed` list, so an editor had no web links at all —
the gap the maintainer found. The fix is one function rather than a second scanner:

```ts
// core/src/links/web-url.ts — moved from ui/src/renderer/terminal/terminal-url.ts, unchanged
export const WEB_URL_REGEX: RegExp;
export function detectWebLinks(line: string): readonly { uri: string; start: number; end: number }[];

// core/src/links/scan-line.ts
export function scanLinkLine(line: string): {
  readonly web: readonly { uri: string; start: number; end: number }[];
  readonly paths: readonly LinkCandidate[];   // detectPathCandidates(line, web spans) — D2, once
};
```

| # | Guarantee | FR |
|---|---|---|
| D9 | Both panel types take a line's links from `scanLinkLine` and from nothing else | FR-104 |
| D10 | `WEB_URL_REGEX` is byte-for-byte the pattern `TERMINAL_URL_REGEX` was; `terminal-url.ts` re-exports it and `ui/tests/unit/terminal-url.test.ts` passes unchanged | FR-102 |
| D11 | A web span is never also a path candidate, in either panel type | FR-009 |
| D12 | `FileSystem::<path>`, optionally after `Microsoft.PowerShell.Core\`, yields a candidate for `<path>` alone, spanning `<path>` alone; any other `Name::` token yields nothing | FR-003g, FR-107 |

Web spans need **no existence check** — they are not resolved by main, and no request for one ever
reaches `throng:links:resolve`.

### §6.2 R12 — a UNC base keeps its root (D1)

| # | Rule | FR |
|---|---|---|
| R12 | When a base directory or project root begins with two separators (the `UNC_FORM` shape R2 already recognises), a join keeps **both** leading separators, and the base's first two segments — server and share — are its **root**: a `..` in the relative part stops there and never pops them | FR-022 – FR-024, D1 |

R5 and R6 were always meant to work against a network base; R12 states what `join` must preserve for
them to. It adds no port member and names no OS: the shape is the one `resolve.ts` already tests for.

### §6.3 Membership with a network root

| # | Rule | FR |
|---|---|---|
| M7 | A project rooted at `\\s\h\proj` contains `\\s\h\proj\src\x.ts` and `//s/h/proj/src/x.ts`, and does not contain `\\s\h\proj-old\x.ts`. The comparison is still `isUnderPath` (M6) | FR-021, D1 |
| M8 | An **alias** — a mapped drive letter for the share, an administrative share for a local drive, an 8.3 short name — is judged by the name written, like M5's symlink: never canonicalised, never promoted into the project on a guess | FR-106 |

### §6.4 What resolution is allowed to cost — additions to §4

| # | Rule | FR |
|---|---|---|
| P7 | Every existence check in `FileLinkResolver` races the **existence-check timeout** (`editor.links.existenceCheckTimeoutMs`, read per check). Losing the race answers `{ ok: false, reason: 'unreachable' }` | FR-120 |
| P8 | A timed-out check marks its **volume root** (`node:path`'s `parse(p).root`) outstanding. While it is, every check under that root answers `unreachable` at once and calls `IFileSystem.stat` **zero** times | FR-121 |
| P9 | At most `MAX_TIMED_OUT_LINK_CHECKS` (2) checks may be outstanding past the timeout in the process. A check under a new root beyond that answers `unreachable` at once | FR-121 |
| P10 | When the stuck `stat` finally settles, the root's mark clears. The renderer's cached `unreachable` expires with the ordinary TTL — FR-122's back-off, with no second timer | FR-122 |
| P11 | A check under a root that is **not** outstanding is never delayed by one that is | FR-121 |
| P12 | An answer that lands after a surface stopped waiting reaches that surface for the line it belongs to, with no pointer movement needed (terminal: past `file-link-provider.ts`'s held-reply deadline; editor: the cache subscription, which already redecorates) | FR-123 |

## §7 Amendment 2026-09-18, second round — logical lines and the idle scan

| # | Rule | FR |
|---|---|---|
| D13 | A terminal link is detected on the **logical line**: the asked row, plus the rows before it and after it that xterm marks `isWrapped`, joined without separators. Spans map back to cells, so a range may start and end on different rows | FR-130 |
| D14 | Asking about **any** row of a logical line returns the same links for it | FR-131 |
| D15 | Rows not joined by `isWrapped` are never joined; an OSC 8 target repeated on separate lines is one link only because xterm links cells by declared target | FR-132 |
| P2′ | *Supersedes P2 in part.* The existence check has **three** callers: the terminal provider (hover), the editor `ViewPlugin` (visible range), and the terminal **idle scan** of rows in view | FR-137 |
| P13 | The idle scan starts only after `LINK_IDLE_SCAN_MS` without a write, is cancelled by the next write, covers only the viewport's logical lines within the per-line cap, and reads and fills the same cache. P1 is unchanged: nothing runs on the output path | FR-071, FR-072, FR-137 |
| P14 | A relative path's base in a terminal is the cwd store's value **only** when `flavourReportsDirectory(flavour, shellIntegration)` is true; otherwise R5 has no base directory and the project root alone is tried | FR-142 – FR-144 |

P3 still holds: `unreachable` is not a link. The difference from `{ ok: false }` with no reason is
only what a follow reports (FR-124) — a hover draws nothing either way.
