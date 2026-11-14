# IPC and port contracts

Every handler shape-checks its payload; a malformed call changes nothing and answers with the existing error envelope.

## Ports (`packages/core/src/abstractions`)

```ts
// claude-session.ts
export interface ClaudeSessionProcess {
  pid: number;
  startedAt: number;          // the ChildProcess start time the daemon already holds
  commandLine: string;
  executablePath?: string;
}
export interface IClaudeSessionResolver {
  /** The running Claude Code session for this process tree, or a reason it has none. Never throws. */
  resolve(foreground: ClaudeSessionProcess, descendants: readonly ClaudeSessionProcess[]):
    Promise<{ sessionId: string; argv: readonly string[] } | { none: ClaudeSessionMiss }>;
}
export type ClaudeSessionMiss = 'not-claude' | 'no-record' | 'mismatch' | 'unreadable' | 'timeout';
```

## Pure core functions

```ts
// preview/wiki-links.ts
wikiCandidates(target: WikiTarget, docDir: string, projectRoot: string | null): string[];
wikiDisplayText(target: WikiTarget): string;
// preview/embeds.ts
PREVIEW_IMAGE_EXTENSIONS: readonly string[];
isImageEmbedRef(path: string): boolean;
// preview/links.ts
classifyResolvedWiki(absPath: string, fragment: string | undefined, ctx: LinkContext): PreviewLink;
// notice/display-mode.ts
upgradeNotificationDocument(raw: unknown): unknown;   // dismiss→panel, timed→toast, drops timeoutMs; idempotent
// notice/notification-entries.ts
entryKey(input: NotificationEntryInput): string;
addEntry(doc: NotificationsDocument, input: NotificationEntryInput, limit: number, now: number, pending: boolean):
  { doc: NotificationsDocument; outcome: 'added' | 'repeat'; dropped: NotificationEntry[]; limitReached: boolean };
applyLimit(doc, limit): { doc; dropped };  orderEntries(entries, order): NotificationEntry[];
parseNotificationsDocument(raw: unknown): NotificationsDocument;   // total; unknown shape → empty
// terminal/command-line-args.ts
splitWindowsCommandLine(line: string): string[];      // CommandLineToArgvW rules
// terminal/claude-resume.ts
isClaudeCodeProcess(proc: { commandLine: string; executablePath?: string }): boolean;
claudeResumeCommand(argv: readonly string[], sessionId: string): string | null;
// diagnostics/anonymise.ts
createAnonymiser(opts: { salt: string; os: 'windows' | 'linux'; hash: (salt: string, value: string) => string }): Anonymiser;
interface Anonymiser { register(kind: AnonKind, value: string, id?: string): void; apply(text: string): string; }
```

The anonymiser takes its hash function by injection so core stays free of Node imports (`no-os-imports.test.ts`).

## Daemon → UI (`packages/ipc-contract/src/terminal.ts`)

```ts
interface TerminalCommandNotification {
  panelId: string; command: string | null; arch?: string; observedAt?: number;
  memoryCommand?: string;     // new: present only with an identified Claude Code session
}
```

The reattach reply carries the same field.

## Main ↔ renderer: notifications (`preload.cts`, `window.throng.notifications`)

| Channel | Direction | Payload | Answer |
|---|---|---|---|
| `throng:notifications:add` | renderer → main (any window) | `NotificationEntryInput` | `{ outcome: 'added' \| 'repeat'; id: string }` |
| `throng:notifications:list` | renderer → main | — | `NotificationsSnapshot` |
| `throng:notifications:dismiss` | renderer → main | `{ id: string }` | snapshot |
| `throng:notifications:dismissAll` | renderer → main | — | snapshot |
| `throng:notifications:clearPending` | renderer → main | — | snapshot — *retired 2026-11-13 (FR-059)* |
| `throng:notifications:setOrder` | renderer → main | `{ order }` | snapshot |
| `throng:notifications:dismissLimitWarning` | renderer → main | — | — |
| `throng:notifications:setPendingMode` | main window → main | `{ pending: boolean }` (panel minimised or right pane hidden) | — *retired 2026-11-13 (FR-059)* |
| `throng:notifications:changed` | main → every window | `NotificationsSnapshot` | — |
| `throng:notifications:repeat` | main → main window | `{ id }` (flash the entry) | — |
| `throng:notifications:limitReached` | main → main window | — | — |

`NotificationsSnapshot = { entries: NotificationEntry[]; order; pendingCount: number; pendingSeverity: Severity | null; limit: number }`. *2026-11-13 (FR-059): `pendingCount` is every entry not yet dismissed and `pendingSeverity` the most severe of them. `NotificationEntryInput` gains `origin` and `place` (data-model.md).*

## Main ↔ renderer: Preferences deep link

`window.throng.app.openPreferences(tab, section?)` — `section` is a settings group name (`'Notifications'`). Main passes `prefs=<tab>&section=<name>`; the settings tab scrolls to that group and unfolds it.

## Notice log record (main.log, FR-034a)

`[notice] severity=<s> kind=<k> group=<g> project=<project:ID> pending=<n> subject=<tokens> …` — every field passed through the anonymiser; no raw path, name or command.

## Process wiring for the anonymiser salt

| Process | Receives the salt by |
|---|---|
| UI main | reads or creates `<logs>/.anon-salt` |
| daemon, collector | `THRONG_LOG_SALT` env, next to `THRONG_LOG_DIR` |
| PTY agent | an extra argv value (its de-elevated launch drops the environment) |
