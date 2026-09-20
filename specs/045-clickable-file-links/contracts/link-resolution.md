# Contract: detection, resolution and project membership

**Feature**: 045 | **Requirements**: FR-003 – FR-013, FR-020 – FR-026, FR-070 – FR-073;
*amended 2026-09-18*: FR-003g, FR-100 – FR-107, FR-120 – FR-123 and defect D1 — see §6;
*second round*: FR-130 – FR-137, FR-142 – FR-144 — see §7; *third round*: FR-150 – FR-154 — see §8.
*Round four, 2026-09-19 (maintainer)*: wherever this contract says **Copy Link Address**, read **Copy
Link to Clipboard** (spec FR-175, S7). R13's "only R6 and R3 remain" for a WSL flavour is confirmed by
spec FR-177 (every drive form maps in WSL); R3/R6's order for a drive form is set by FR-176 (the drive
only). The rest of round four is for `/speckit-plan` to design here.

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
| R8 | A `file:` URI (a hyperlink target, or FR-003f text) is percent-decoded, host→UNC, no-host/`localhost`→local, by `IPathForms.fromFileUrl` *(extended by §8 R15 — third round)* | FR-012 |
| R9 | On Windows, a POSIX path with no project-root match and no drive form is **not otherwise mapped** — no WSL filesystem access *(superseded in part by §8 R13/R14 — Git Bash's mount table is tried, and the platform reading is drive-qualified; still true for WSL)* | FR-025, Out of scope |
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

*Superseded 2026-09-18 (third round) by FR-154 — see §8 V1 – V4.* The "price" this note accepted is
withdrawn: the maintainer's corpus showed dead OSC 8 targets drawn with an underline and a hand
pointer that then did nothing, which is exactly the "not clear what is clickable" report. The option
stays on (US2 still needs it); what changes is that throng's hover and xterm's own underline are both
suppressed for a target the click rule cannot follow.

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

## §8 Amendment 2026-09-18, third round — spaces, Git Bash paths, `file:` spellings, dead hyperlinks

Source: the maintainer's corpus run by a probe ([../research.md](../research.md) O11); requirements
FR-150 – FR-154; tasks T198 – T214.

### §8.1 Detection — paths containing spaces (FR-150)

| # | Guarantee | FR |
|---|---|---|
| D16 | A candidate whose text begins with an **anchored** form — drive (either separator), UNC (either separator), leading `/` (every FR-003d form), `~/`, `./`, `../`, a `file:` URI, or D12's provider-qualified form — also yields **extended readings**: the token plus the next 1, 2, … whitespace-separated words across single spaces, up to `MAX_PATH_SPACE_WORDS` words added | FR-150 |
| D17 | Readings are emitted **longest first**, the unextended token last. Each reading carries its own D3 position readings (with-position before without, R7) and its own D4 trailing-punctuation trim | FR-150, FR-004, FR-005 |
| D18 | Extension stops **before** a word that itself begins an anchored form, a web span (D2/D11), a quote, an unbalanced bracket, a run of two or more spaces, and the end of the logical line (D13). A bare word never begins an extended reading | FR-150, FR-009 |
| D19 | D7 and D8 are unchanged: extension reads the given line only and touches no disk. Which reading is the link is decided by R1 — the first that exists — in main, never here | FR-150, FR-006 |

**Why SC-003 still holds.** Only anchored tokens extend, and every reading is a candidate like any
other: a reading that names nothing is not a link (FR-006). A prose line with no existing location
yields zero links however many readings it produces. The cost is bounded twice — by
`MAX_PATH_SPACE_WORDS` per token and by `MAX_LINK_CANDIDATES_PER_LINE` per line — and is spent only
by the three P2′ callers, never on the output or typing path (P1 unchanged).

**Worked example.** `see D:\git\throng_tests\test 1\test.md:3 for details` yields, in order,
`D:\git\throng_tests\test 1\test.md:3 for details` (and its readings), …,
`D:\git\throng_tests\test 1\test.md` with position `3`, the same without the position, …, and last
`D:\git\throng_tests\test` alone. The first that exists is the link; its span ends at `test.md`, and
`:3` is its position.

### §8.2 Resolution — Git Bash's mount table and drive qualification (FR-151, FR-152)

`LinkResolutionContext` gains one field — `wslFlavour?: true` — set when the asking panel is a
terminal whose flavour the platform identifies as WSL (T189's answer; data-model §15.2).

| # | Rule | FR |
|---|---|---|
| R13 | *Extends R6/R3.* A leading-`/` path that is not a drive form is tried, in order: against `projectRoot` (R6); as a drive form (R3); through **`IPathForms.fromMountTable`** — Git Bash's install root and declared mount points; then as the platform's own meaning, **qualified by R14**. With `wslFlavour`, the mount-table step and the platform step are both **absent**: only R6 and R3 remain | FR-151, FR-025 |
| R14 | The platform's own meaning of a rooted, drive-less path is **`IPathForms.qualifyRooted(path, anchor)`**, where `anchor` is `baseDirectory` if present, else `projectRoot`. With neither, the step yields nothing. No list ever contains a rooted path without a drive, and nothing is resolved against throng's own process directory | FR-152, FR-020 |

R9's "no WSL filesystem access" stands for a WSL flavour and for any Linux filesystem path; only Git
Bash's own mount points change. `resolve.ts` still names no OS: the mount table and the drive are
both the port's answers (FR-026).

### §8.3 Resolution — POSIX spellings inside `file:` URIs (FR-153)

| # | Rule | FR |
|---|---|---|
| R15 | *Extends R8.* For a `file:` URI with no host or host `localhost`: when **`IPathForms.fileUrlLocalPath(url)`** returns a path (the decoded path was **not** drive-qualified), that path is resolved exactly as the same text written bare — R6, R3, R13, R14, and R11 for a panel with no project. When it returns `null`, R8 applies unchanged | FR-153, FR-012 |
| R16 | For a `localhost` URI whose first path segment is not a drive, **`IPathForms.loopbackFromFileUrl(url)`** — `\\localhost\<segment>\…` — is appended **after** R15's readings | FR-153 |

A hosted URI (`file://server/share/x`) is R8 alone, unchanged. A `file:` URI still never reaches the
OS URL opener (I4).

### §8.4 What is never a link — additions to §5 (FR-154)

| # | Input | Affordance | Gesture | Menu | Notice | FR |
|---|---|---|---|---|---|---|
| V1 | OSC 8, scheme other than `http`, `https`, `file:`, or an empty target | **none**: no xterm underline, no throng mark, no hover underline, no pointer, no tooltip | Ctrl+click reaches a mouse-reporting program (G6) | no link items | none | FR-154, FR-013, FR-043 |
| V2 | OSC 8 `file:` target that has not yet resolved, does not resolve, or answers `unreachable` | none, as V1 | as V1 | no link items | none | FR-154, FR-006, FR-071 |
| V3 | OSC 8 `file:` target that resolves | FR-135's affordance, marked at rest once resolved — by hover or the idle scan (P13), from the same cache (P4) | the click rule | the file-link run | — | FR-154, FR-137 |
| V4 | OSC 8 `http`/`https` target | FR-135's affordance, marked as drawn — no existence check | the open-external seam | the web-link run | — | FR-136 |

**Why no notice (V1, V2).** A notice reports a condition an action ran into. Nothing was attempted —
the text is not a link — so there is no condition; and a notice raised per hover or per click of a
program's dead hyperlink would be one condition raising many notices (CLAUDE.md, *One condition,
one notice*). The one notice that remains is FR-037/FR-124's: a link that **was** a link when the
user acted, and has gone or stopped answering by the time main re-checks it.

| # | Rule | FR |
|---|---|---|
| P15 | *Extends P2′.* The idle scan's rows include the OSC 8 `file:` targets in view; a V2 answer that later becomes V3 (file created, share back) is drawn without pointer movement, as P12 | FR-154, FR-123 |

---

## §9 Amendment 2026-09-19, round four — syntactic validity, classes, click-time resolution

§4's render-time costs, §6.4's hover gate, §7's idle scan and §8.1's extended readings are **superseded**
for rendering by this section (FR-155); they stand for click time where this section says so.

### §9.1 What may touch the disk, and when (FR-155, FR-160, FR-161, FR-170)

| Moment | Disk? | Bound |
|---|---|---|
| Output arrives, a row is drawn, a view pass, a hover, a tooltip, a readout | **Never** (SC-021 counts 0) | — |
| Ctrl+click, Open Link, the Open Link chord | Once per follow, UNC/on-device only | `existenceCheckTimeoutMs` **in total** per request (T226, T227) |
| Link menu opens | Once per opening, UNC/on-device only | the same total bound |

P14. `FileLinkResolver.locate` holds one deadline per request; every reading and every root it tries
shares it; FR-121's per-root gate and FR-122's back-off still apply.

### §9.2 Detection (FR-173, FR-174, FR-179) — the RED table is normative

`detectPathSpans(line, { knownExtensions })`; cases in `packages/core/tests/unit/link-detect-spaces.test.ts`
(`80e13719`). Where §8.1 and the table disagree, the table wins. One span per candidate; FR-004's
positioned/unpositioned pair is the only multi-reading case.

### §9.3 Class and route (FR-157 – FR-159)

| Class | Route | Check |
|---|---|---|
| web, loopback | `throng:linkUri:openExternal` → `isAllowedLinkUri` → `IShellIntegration.openExternal` | none |
| protocol (allowlisted, not refused) | same channel | none |
| UNC, on-device, in project (by the first existing reading) | open in throng (editor/preview per the click rule) | §9.1 |
| UNC, on-device, first reading in project, nothing exists | one notice, nothing opens (FR-160) | §9.1 |
| UNC, on-device, otherwise | `revealInFileManager(parent)` — no existence check (FR-158) | none |

### §9.4 Drive forms (FR-176, FR-177)

`/<letter>/…` and `/mnt/<letter>/…` map to their drive **only**; the project-root reading is not tried
for them. They map in every flavour, WSL included. This replaces §2's order for drive forms and R13's
WSL note.

### §9.5 Sanitising (FR-156)

`sanitiseLinkTarget` runs in `scanLinkLine` and again in main before any OS call. Refuses C0/C1 controls,
raw or `%00`-encoded NUL, and text after a closing quote; a URI leaves as one `URL`-serialised string,
never argv.

### §9.6 Corrections after analysis *(2026-09-19; §9.1 and §9.3 kept, amended here)*

§9.3's three UNC/on-device rows read: the readings are tried in order under one deadline and the first
that **exists** decides — in the project, open in throng; outside, a folder opens as itself and a file
opens its parent with it selected (FR-158a). If none exists: first reading in the project → one notice;
otherwise its parent goes to OS Explorer unchecked. §9.1's "Once per follow" is that one bounded pass,
which includes the file-or-folder answer. A trailing separator or an OSC 8 folder target skips the check.

*§9.6 extended 2026-09-19 (sixth analysis pass): the explicit Open in OS Explorer item follows the same
rule as a follow's reveal (FR-158b) — one file-or-folder check, parent on a miss, no `gone`.*

*§9.6 amended 2026-09-19 (eighth analysis pass): "in the project, open in throng" applies to a **file**;
an existing folder opens as itself in OS Explorer wherever it lies (FR-160a). A relative path ending in a
separator reveals its first reading as a folder, unchecked, at a follow and at a Link-menu opening
(FR-158c).*

*§9.1 / §9.6 confirmed 2026-09-19 (tenth analysis pass): "once per follow" is one `throng:links:follow`
request (contracts `settings-and-environment.md`, round-four IPC table); opening a resolved in-project file
in an editor is the editor's own load, not a second link resolution.*

*§6.4 P10 and §9.1 P14 amended 2026-09-19 (eleventh analysis pass): the back-off is main's
`LINK_ROOT_BACKOFF_MS` after a stuck check settles (spec FR-122a), not the renderer cache's lifetime,
which no longer exists. A folder by grammar makes no check at a follow or a menu opening (FR-158d).*

*P10 amended again 2026-09-19 (twelfth analysis pass): a backed-off root sits in its own map with its
"left alone until" time and does not count toward P9's cap of two stuck roots.*

*§9.6 amended 2026-09-19 (thirteenth analysis pass): when the first reading lies in the project and its check times out, or its root is in back-off (FR-122a), the outcome is `unreachable` and FR-124's "did not answer" notice — never "not found" (FR-160a). Outside the project the same outcome goes to OS Explorer on the parent with no throng notice (FR-158a). A folder by grammar makes no check at all (FR-158d).*

---

## §10 Amendment 2026-09-20, round five — one thing detection may be told, and one list

§9.2 and §5 stand; §10.1 adds an input to the first and §10.2 restates where the extension set comes
from. **§9.1's "what may touch the disk, and when" is unchanged**: round five adds no filesystem access
anywhere.

### §10.1 Detection may be told the working directory (FR-183, D6)

| # | Rule |
|---|---|
| D20 | `detectPathSpans` / `detectPathCandidates` accept an optional `namesKnownDirectory(text): boolean`, passed through `ScanOptions`. It is called **only** with a reading the scan has already crossed a space to reach, trimmed per FR-005, and only within `MAX_PATH_SPACE_WORDS`. It MUST be pure and MUST NOT touch the disk — D7 and D8 are unchanged |
| D21 | A word that terminates the scan under FR-173d (trailing separator) or FR-173e (known extension) still wins outright. Failing that, the **longest** crossed reading the predicate accepts ends the span; a word that would end the scan for any other reason does not discard a landing already found |
| D22 | The predicate matches on equality **or an ancestor at a separator boundary**, so a prompt printing a parent extends and a name that merely shares a string prefix does not |
| D23 | With no predicate — every editor, a flavour that does not report its directory, shell integration off, WSL — the answers are **exactly** the case table's (`link-detect-spaces.test.ts`, unchanged byte for byte) |
| D24 | The predicate is the **caller's** (Principle II): core may not map drive letters or mount forms, and Git Bash prints `/d/git/…` while reporting `D:\git\…`, so both sides are folded through the renderer's by-name reading before they are compared |

The switch-off state (§5's row, "Anything, while that panel type's detection switch is off") now reads
**every kind of link, not detected paths only** (FR-180; menus-and-gestures §10.1).

### §10.2 The known extensions come from one list (FR-182)

`scanLinkLine`'s `knownExtensions` is `knownFileExtensionsSet(settings.editor.links.knownFileExtensions)`
— the one list setting, normalised by the accessor — on **every** surface and in **main**
(`FileLinkResolver`), so a user's list cannot widen one scan and not another (FR-182b). An empty list
means FR-173e never fires (FR-182d). The round-four `{ added, removed }` document shape is migrated on
read (FR-182a); `resolveKnownExtensions` survives for that alone.

### §10.3 A bare email address (FR-185, FR-186, D7)

| # | Rule |
|---|---|
| D25 | A bare email address is an **action-protocol span** with the scheme `mailto` **supplied**: its range is the address as written, its `uri` is `mailto:` plus that address. It is the only span whose `uri` is not its own text (data-model §17.7). Its class, route, menu, hover title and allowlist behaviour are an action protocol's, unchanged (FR-157 class 4) |
| D26 | Its range is **claimed** whenever the grammar accepts it, and **published** only while `mailto` is allowlisted and not refused. With `mailto` off the allowlist the address is plain text — and **never** a path candidate. That is FR-186, and it is what this scan already did for a refused scheme |
| D27 | The grammar excludes `/` and `\` from the local part, requires a word boundary before the match, and requires a dot and a letters-only last label — so `D:\p\a.b@c.com\x.ts`, `@scope/pkg` and `user@host` stay with the path grammar. D2 / D11's "never both" settles an address inside a web span or inside a written `mailto:` in favour of the span already holding that range |

§5's *What is never a link* gains nothing: with `mailto` off the allowlist an address is text, by D26.
§9.3's class table is unchanged — a bare address enters it as class 4, judged by its `uri`.
