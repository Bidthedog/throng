# Research: Vault links, a notifications panel and agent session restore

## D1. One wikilink resolution rule (#616, FR-001, FR-002, FR-006)

**Finding**: A wikilink is classified once in the sanitiser from `wikiCandidates(...)[0]` (always the document folder, `.md` first). Main separately resolves the batch and answers with the first candidate that exists, which only toggles the unresolved style. So follow, copy and the link menu use candidate 0 while the styling uses the file that exists — `[[X]]` resolving to `X.markdown` already follows the wrong path today.

**Decision**: `wikiCandidates(target, docDir, projectRoot)` in `packages/core/src/preview/wiki-links.ts` lists the document-folder candidates (047 FR-052c order) and then, for a target with no leading `/`, the same candidates resolved from the project root, duplicates removed. Main's batch answer (`PreviewService.resolveWikiTargets`) is the single decision: `applyWikiResolution` rewrites each anchor's `data-throng-link` to the resolved file (or `outside`) and the unresolved style together. Ctrl+click, keyboard follow, the link menu, Copy and the hint all read `data-throng-link`, so they cannot disagree with the styling. An unresolved link keeps candidate 0, so the missing-target notice names the document-folder path (FR-003). No search for `.obsidian` (clarification 2026-11-12).

**Alternatives rejected**: resolving in the renderer (no file system); a second resolver for embeds (047 FR-053 forbids it).

## D2. Readable wikilink hover (#616, FR-004, FR-005)

**Decision**: The sanitiser builds a wikilink's `title` and `data-throng-target` from the decoded target — `'/'?` + path + `#fragment` — never from the `throng-wiki:` href. The text does not depend on resolution, so the hover and the status bar readout (045 FR-169a(ii)) are stable before and after main answers.

## D3. Image embeds reuse the standard image path (#615, FR-010 to FR-015)

**Decision**: The image extension list moves to core (`PREVIEW_IMAGE_EXTENSIONS`, `isImageEmbedRef` in `packages/core/src/preview/embeds.ts`) and `preview-protocol.ts` imports it, so the two lists cannot drift. `embedRule` emits markdown-it's own `image` token for an image target, with `alt` = the text after `|` verbatim (so `|300` is alt `300`, FR-015) or the file name with its extension. From there the existing image path applies unchanged: `onImage` confinement and sanitisation, the `throng-preview://asset` protocol with its real-path check, the 404/413/415 handling and the alt-text fallback (FR-012). For the project-root fallback (FR-011) the embed's target joins the wiki resolution batch; the image is held without a `src` until main answers, then drawn from the resolved path, or falls back to alt text exactly as a missing image does.

**Mermaid** (FR-013): `readOneEmbed` tries the project root after the document folder for a `![[…]]` embed with no leading `/`. The placeholder gains a spelling flag so the image-syntax spelling `![alt](x.mmd)` keeps resolving as an ordinary image path, as 054 FR-049b defines it.

## D4. Toast lifetime (#618, FR-020 to FR-022)

**Decision**: Every toast arms one timer of `notifications.toastDurationMs` at raise, whatever its mode. `pointerenter` or `focusin` on the card pauses it; once both the pointer and focus have left, the full duration restarts (clarification 2026-11-12). The close X exists on every toast. Expiry and a user's dismissal are separated: `onDismiss` keeps meaning "the user dismissed it", and a new `onExpire` (default nothing) runs on timeout. This keeps `useErrorNotice` from acknowledging a store error 3 seconds after it appears.

**Sticky toasts — an exception the spec did not name**: three toasts today are pinned to stay because they carry the only control for something live: the paste-progress card (its Cancel is the only way to stop a running paste, 067 FR-037), the different-copy notice (058 FR-018) and the installed-version notice (063 FR-010). FR-031f's limit warning needs the same behaviour. A `sticky: true` notice property exempts a toast from the timer; it is set only by these four. Recorded as a deviation in the plan's Complexity Tracking.

## D5. Display modes and their upgrade (FR-021a to FR-021d)

**Decision**: Stored tokens become `never`, `toast`, `panel`, shown as **Never display**, **Toast only**, **Toast and keep in panel**. The per-type `timeoutMs` is removed. Global settings join `notifications`: `toastDurationMs` (default 3000, 3000–30000, step 500), `confirmDismissAll` (default true), `panelLimit` (default 100, 20–500, step 10). Defaults: error and warning `panel`; info, success and **attention** `toast`.

**Upgrade**: `dismiss` → `panel`, `timed` → `toast`, `never` unchanged; `timeoutMs` dropped. This must run on the raw settings document **before** `applyDeclaredBounds` in `parseSettingsGuarded`, because the bounds guard would otherwise replace the now-unknown `dismiss` / `timed` with the default first. Startup writes the corrected document back once, which makes the upgrade persistent; re-running it on an upgraded document changes nothing.

**The two other users of display modes** (not named by the spec, decided here):
- **`attention`** is a fifth notification type with its own mode. It follows the same mapping; its default `timed` becomes `toast`.
- **Find in Files' replace summary** (`search.inFiles.summaryNoticeMode` / `summaryNoticeTimeoutMs`) shares the mode vocabulary. Its mode follows the same mapping and its timeout setting is removed in favour of the global toast duration.

## D6. Where panel entries live (FR-024 to FR-031g)

**Decision**: A main-process store, `NotificationStore` (`packages/ui/src/main/notification-store.ts`), persisted to `userData/notifications.json` with queued atomic writes — the shape of 067's `FormHistoryService`. Main owns the entries, order, pending flags and the limit-warning flag; every window adds through IPC (`throng:notifications:add`), which makes FR-030 a single path, and main broadcasts `throng:notifications:changed` to every window. Pure rules (parse, dedupe key, limit trim, ordering, pending) live in core (`packages/core/src/notice/notification-entries.ts`).

**Entries hold serialisable data only**: severity, title, message, action text, subject, details, copy detail, group key, cause key, instance key, affected panels, raised time, pending, and action **descriptors** (go to a panel by id, open a project file). Callbacks and React bodies cannot be stored; an entry offers only the descriptors it carries, and FR-031a hides one whose target no longer exists.

**Dedupe** (FR-029, FR-031b): keyed on the notice's group key, else a content key (the same key the silenced shadow uses), checked against the stored entries, not the live toasts — the toast may long be gone.

**Limit** (FR-031d to FR-031g): trim oldest by raised time on add and when the limit is lowered; each drop is logged. The first time the store reaches the limit it reports it to the main window, which raises the sticky warning; `limitWarningDismissed` is stored once the user dismisses it with X.

**Failure** (FR-031c): an unreadable or corrupt file is logged, set aside as `notifications.json.bad`, and the store starts empty.

**Alternatives rejected**: the daemon's SQLite (needs a migration and a live daemon; notices about the daemon dying could not be stored); renderer localStorage (cannot receive entries from other windows).

## D7. Panel layout and minimise (FR-023, FR-035 to FR-039b)

**Decision**: `VerticalPanelStack` gains per-panel minimise: a minimised panel renders its header only, the panel above takes the space, and the stack remembers each panel's pre-minimise height (FR-037). The right pane becomes a `VerticalPanelStack` of File Explorer over Notifications. Sizes and minimised state live in renderer `localStorage` under new keys, global rather than per project (FR-038), like pane widths today. The pending badge (FR-039) is a small component used on the collapsed Notifications header and on the right-pane show control and rail (FR-039a).

**Focus Mode**: the spec's edge case is wrong — Focus Mode is a maximised tab and never hides the side panes. The right pane is hidden only by its toggle or by the narrow-window auto-collapse, and FR-039a covers both.

## D8. Preferences deep link (FR-031f)

**Finding**: `openPreferences(tab)` takes only a tab. **Decision**: it gains an optional section (`{ tab: 'settings', section: 'Notifications' }`), passed through the window query; the settings tab scrolls to that group and unfolds it.

## D9. Identifying a running Claude Code session (#189, FR-040 to FR-049)

**Finding (probe, Claude Code 2.1.323)**: Claude Code writes `<config>/sessions/<pid>.json` for each running process and removes it on exit. It carries `pid`, `sessionId`, `procStart` (the process start time), `cwd`, `updatedAt` and `formerNames[]` with earlier session ids. `<config>` is `CLAUDE_CONFIG_DIR`, else `~/.claude` (`%USERPROFILE%\.claude` on Windows). `claude --resume <id>` reuses that id; only `--fork-session` mints a new one.

**Decision**: An injected `IClaudeSessionResolver` in the daemon. In `observeCommand`, after `foregroundProcess` picks the foreground child, the resolver recognises Claude Code (the native `claude` image, or node running `@anthropic-ai/claude-code`, reusing `friendly-names.ts`'s rule) in that process or below it, reads `<config>/sessions/<pid>.json`, and accepts it only when its `pid` matches and its `procStart` agrees with the process start time (PID reuse). It reads only the identity fields, never conversation files (FR-049). Reads are time-bounded like `readArch`. Only the process identity and argv are cached by pid and start time; the session record is re-read on every observation of a Claude process (one small file), because Claude Code rewrites it in place when the session changes and a cached session id would hide that switch (FR-044, analyze finding A1). Cost stays one small read per Claude process per observation, not per terminal (FR-046).

**Why not mint `--session-id`**: a hand-typed `claude` is the main case (maintainer, #189); the record identifies any running process, whoever started it, and follows session switches inside Claude Code (FR-044), because the record is updated when the session changes.

**Delivery**: `TerminalCommandNotification` gains an optional `memoryCommand` — the resume command, or absent. The plain `command` stays as it is for titles, attention and `describeDoing`. The dedupe key includes `memoryCommand`, so a session switch republishes (FR-044). The renderer persists `memoryCommand ?? command` as the observed command and promotes it on end and on stranded recovery, through the existing `captureDecision` (FR-040, FR-045). A terminal that is still running is reattached as today.

**The rewritten command** (FR-041a): a pure `claudeResumeCommand(argv, sessionId)` in `packages/core/src/terminal/claude-resume.ts` keeps every argument except `--resume <v>`, `--resume=<v>`, `-r <v>`, `--continue`, `-c`, `--session-id <v>`, `--session-id=<v>`, `--fork-session` and a leading `agents` subcommand, then appends `--resume <sessionId>`. The executable becomes the bare `claude` (the resolved form `isResolvedForm` already favours). Its output must pass `isCapturableCommand`; otherwise the verbatim command is used (FR-047).

**Argument boundaries**: Linux's `/proc/<pid>/cmdline` is NUL-separated, but the shared reader joins it with spaces. The resolver re-reads the argv for the one Claude process (NUL-split). Windows has only the `CommandLine` string, split by `CommandLineToArgvW` rules in a pure core tokenizer.

**Failure** (FR-047, FR-048, FR-055): no record, a mismatch, a read error or timeout → the verbatim command, and a `[068:resume] panel=<id> reason=<reason>` line in `daemon.log` at debug through `logExpected`. No notice. A resumed session that no longer exists is Claude Code's own error in a live shell: the recipes run the command inside an interactive shell, so the panel stays usable.

**FR-019g**: the final observation on an orderly end is still unimplemented (051 R13, 051 FR-016). FR-045 therefore means the last published value, within the staleness window, as 025 already accepts.

## D10. Anonymised diagnostic log (#623, FR-034a to FR-034f)

**Finding**: every process writes through one `createFileLog` instance (`packages/platform-node/src/node-file-log.ts`), whose `emit` is the chokepoint; crash reports and `daemon-startup.log` (an fd redirect of the daemon's stdout/stderr) bypass it. `main.log` and `daemon.log` are fixed names reopened across runs and processes.

**Decision**: a pure anonymiser in core (`packages/core/src/diagnostics/anonymise.ts`, no Node imports): `createAnonymiser({ salt, os })`, `register(kind, value, id?)`, `apply(text)`.
- **Known values first**, longest first: registered project roots become `<project:ID>` plus a token for the remainder; home folder, user data folder, install folder (`<install>`, keeping the relative file and line so stacks stay useful), username, hostname and environment folders become kind tokens.
- **Then a pattern pass** for anything left: Windows drive paths, UNC and `\\?\` / `\\.\pipe\` names, POSIX absolute paths, `file:///` URLs (percent-decoded), `~/` paths, relative paths with a separator, quoted names in errno messages, and `user@host`. Windows matching is case-insensitive and accepts both separators and JSON-escaped backslashes. A short username is replaced only at word or path boundaries.
- **Tokens are keyed hashes**, `<kind-xxxxxxxx>` from an HMAC with a per-install salt, not counters — so the same value gets the same token across the processes and restarts that share one log file. The salt is a random value created once in the logs folder and passed to the daemon and collector by environment variable and to the PTY agent by argv (its de-elevated launch drops the environment).
- **Applied in `emit`** before the repeat-collapse key, and to every crash report field. `daemon-startup.log` is anonymised when main reads it back and the raw file is overwritten with the anonymised text after the read.
- **Notice records** are anonymised structurally before the line is joined: project named by internal ID (FR-034c), subject and detail fields tokenised, and a `pending=<n>` field added (FR-034a). Renderer lines are anonymised in main.
- **Project IDs**: every project already gets a UUID at creation. `ProjectService.list` heals a row whose id is null or empty by assigning a new UUID and saving it (FR-034e). The project list's path hover reads `path` then the ID on a second line (FR-034d).

**Risk accepted**: the pattern pass will occasionally tokenise something that only looks like a path (a version string like `a/b`). Over-redaction costs readability, never privacy, which is the direction FR-034f asks for.

## D11. E2E under a 3-second toast

**Finding**: the E2E harness starts with default settings, and around twenty specs assert on a toast after asynchronous work, which a 3-second default would race. **Decision**: the harness sets `THRONG_E2E_TOAST_MS=10000` (30 s outlasted a click's retries on gate run 43340046866) and `THRONG_E2E_TOAST_HOLD=off`, which main honours only under the harness (the same `THRONG_E2E_CLIPBOARD === 'memory'` signal `ui/src/main/composition-root.ts` already uses) as the default toast duration when the settings document does not set one. Specs that test the timer itself set it explicitly. Specs that select the old mode names are updated to the new names.
