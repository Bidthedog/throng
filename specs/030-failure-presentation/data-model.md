# Data Model: Failure Presentation

Phase 1. The entities the spec names, as they will exist in code. Validation rules cite the
requirement they come from.

---

## NotificationSettings (`packages/core/src/config/app-settings.ts`)

New section on `AppSettings`, alongside `diagnostics`.

```ts
export type DisplayMode = 'never' | 'timed' | 'dismiss';

export interface SeverityNotificationSettings {
  mode: DisplayMode;
  /** Only consulted when mode is 'timed'. Bounded 1500–60000 (FR-010). */
  timeoutMs: number;
}

export interface NotificationSettings {
  error: SeverityNotificationSettings;
  warning: SeverityNotificationSettings;
  info: SeverityNotificationSettings;
  success: SeverityNotificationSettings;
}
```

**Shipped defaults** (FR-013) in `DEFAULT_APP_SETTINGS`:

| Severity | mode | timeoutMs |
|---|---|---|
| `error` | `dismiss` | 5000 |
| `warning` | `dismiss` | 5000 |
| `info` | `timed` | 10000 |
| `success` | `timed` | 5000 |

`timeoutMs` carries a value even for `dismiss`/`never` so that switching a severity to *Display for*
in Preferences does not present an empty control.

**Validation** (FR-015, and the tolerant-merge rule the config layer already applies):

| Input | Result |
|---|---|
| Section absent entirely | All four resolve to defaults (FR-014) |
| A severity absent | That severity resolves to its default |
| `mode` unrecognised | That severity's `mode` resolves to its default; `timeoutMs` is still honoured if valid |
| `timeoutMs` non-numeric, NaN, or outside 1500–60000 | Resolves to that severity's default timeout |
| An unknown severity key | Ignored; the rest of the section is honoured |

Nothing in this table throws, and none of it prevents Preferences opening.

**Settings metadata** (FR-002): eight leaves — one `mode` and one `timeoutMs` per severity — under
`group: 'Notifications'`. `settings-metadata.test.ts` asserts one descriptor per configurable leaf,
so all eight are required or the build fails. The `timeoutMs` descriptors carry `min: 1500`,
`max: 60000`, matching the six existing `*Ms` settings.

---

## NoticeSubject (`packages/core/src/notice/subject.ts`)

The concrete thing a notice is about. A **required** field of `NoticeInput`, which is what makes
omission inexpressible (FR-019).

```ts
export type NoticeSubject =
  | { kind: 'none' }                                            // explicitly unavailable (FR-027)
  | { kind: 'file'; name: string; dir?: string }
  | { kind: 'folder'; name: string; dir?: string }
  | { kind: 'project'; name: string }
  | { kind: 'pane'; name: string }                              // FR-024 lists Pane as a term
  | { kind: 'tab'; name: string; project?: string }
  | { kind: 'panel'; name: string; tab?: string; project?: string }
  | { kind: 'panelType'; name: string }
  | { kind: 'terminal'; flavour: string; panel?: string; tab?: string; project?: string }
  | { kind: 'subWorkspace'; name: string };
```

**Formatting** — one function, one place (FR-021):

```ts
formatSubject(subject: NoticeSubject, context?: SubjectContext): string
```

- **The general rule, settled after Phase 2**: qualifiers outermost-first, the subject's own name
  last, joined by `' — '` (U+2014, exported as `SUBJECT_SEPARATOR`). `Project — Tab — Panel` is one
  instance of it, not a special case. So `file`/`folder` render `dir — name`, and `terminal` renders
  `Project — Tab — Panel — Flavour`. One rule beats nine per-kind formats, and it is what makes
  FR-026 (name the terminal flavour) fall out rather than needing its own branch.
- Elision is by **value equality against the raw part, before truncation** — a context stating
  project "Alpha" does not silence a subject in project "Bravo", because hiding that difference is
  the ambiguity #195 exists to remove. It applies to all four qualifiers (`project`, `tab`, `panel`,
  `dir`), one rule rather than four features.
- Truncation counts **code points**, not UTF-16 units: slicing mid-surrogate-pair yields a lone
  surrogate, which is a broken glyph in the toast on somebody's real folder name.
- `context` states what the surrounding UI already says; those parts are omitted, never re-spelled
  (FR-022a). In the consolidated notice the context is `{ project, tab }`, leaving the panel name.
- Absent parts are omitted without leaving separators (Edge Cases).
- Over-long names are truncated here and nowhere else (FR-021). **The bound is 48 characters per
  name part**, truncated at the end with a single `…` replacing the final character, measured in
  characters rather than pixels so the rule is deterministic and unit-testable. 48 keeps a full
  `Project — Tab — Panel` under ~150 characters, which the toast fits without wrapping past two
  lines at the 1920×1080 the E2E suite runs at. Truncation applies per part, never to the joined
  string — losing the panel name because the project name was long is the opposite of the point.
- `{ kind: 'none' }` renders the empty string, and the caller renders no heading.

**Terms** are fixed to the workspace's own vocabulary (FR-024): Pane, Tab, Panel, Panel Type, Panel
Title, Project, Sub-workspace.

**The union is the *workspace's* vocabulary, and Preferences is outside it.** Found when US2 met the
call sites: a configuration document, a preferences reset scope and a theme are none of the ten
kinds, so four of the twelve call sites take `{ kind: 'none' }` for one structural reason rather than
four separate misses. Calling a theme a `file` because it is one on disk would name it in a
vocabulary the Themes surface never uses, which FR-024 forbids. This is a coherent boundary, not a
gap — FR-056's inventory should record it as a category.

**"Panel Title" is prose vocabulary, not a subject kind.** It is the word a message uses when it talks
*about* a panel's title ("that Panel Title is already taken"); the thing the notice is about is the
Panel, whose `name` is its title. There is deliberately no `panelTitle` member, and T007's
"every union member" does not imply one.

---

## GroupKey (`packages/core/src/notice/grouping.ts`)

What decides whether two failures are one notice.

```ts
export interface GroupInput {
  cause?: FailureCause | null;   // 029's classification, null when unmatched
  operationId?: string;          // minted by the action that produced the failure
  projectId?: string;
}
export function groupKey(input: GroupInput): string | undefined;
```

- Classified → `` `${causeKey(cause)}::${projectId ?? 'none'}` `` (FR-029).
- Unclassified but with an operation → `` `op:${operationId}::${projectId ?? 'none'}` `` (FR-029a).
- Neither → `undefined`; the notice does not consolidate and behaves as today.

**Operation id lifetime** — minted **once per user- or system-initiated action**, at the point the
action starts, and carried to every failure that action produces. Opening a project mints one;
restoring a tab within that open does **not** mint a second, or two panels defeated by two different
unclassified failures during one project open would land in two notices, which the spec's Edge Cases
forbid. It is not a session id and not per panel: one action, one id, however many things it breaks.

The project id is part of the key, which is what makes "one notice per project" (FR-029) a property
of the key rather than a rule someone has to remember.

---

## Notice (`packages/ui/src/renderer/common/notification.tsx`)

Existing interface, changed:

| Field | Change |
|---|---|
| `subject` | **New, required** on `NoticeInput` (FR-019) |
| `groupKey` | **New**, optional — from `grouping.ts`; when present the notice consolidates |
| `affected` | **New**, optional — `AffectedPanel[]`, the list (FR-029) |
| `causeKey` | Unchanged; still drives 029's suppression for notices with no `affected` |
| `title` | Unchanged, still wins over a derived heading |
| `action` | Unchanged — "what you were trying to do" |
| `details` | Unchanged |

`AffectedPanel`:

```ts
export interface AffectedPanel {
  panelId: string;      // identity, for de-duplication on growth (FR-037a)
  panelName: string;
  tabId: string;        // a panel always sits in a tab
  tabName: string;
  tabOrder: number;     // workspace tab order (FR-031a)
  panelOrder: number;   // position within the tab (FR-031a)
  /** This panel's own raw error, where the cause differs per panel. Copied, never rendered (FR-048a). */
  detail?: string;
}
```

**Rendering**: grouped by `tabId`, groups sorted by `tabOrder`, rows by `panelOrder`. The project is
not on a row — it is in the heading (FR-031).

**Names go through the formatter, never straight to the DOM** (FR-031b). A row renders
`formatSubject({ kind: 'panel', name, tab, project }, { project, tab })`, which elides the project and
tab the context already states and leaves the panel name — truncated per part by the same 48-character
rule as everywhere else. Rendering `panelName` directly would bypass truncation and let one long name
break FR-032's height bound.

**Lifecycle**:

| Event | Effect |
|---|---|
| `notify` with a `groupKey` matching a live notice | Merge `affected` into it, de-duplicated by `panelId` (FR-037) |
| `notify` with a `groupKey` matching no live notice | New notice (FR-037a) |
| Dismiss | Notice removed; its group key is free again |
| Timeout elapses (`timed`) | As dismiss |
| Mode is `never` | No notice enters the **rendered** list; the log record is still written (FR-005, FR-006) |
| A live notice grows | A further log record naming the panels that joined (FR-006a) |
| Suppressed as a duplicate, or by cause | No notice, **and no log record** — nothing happened |

### Silenced notices and de-duplication (FR-005b)

The duplicate and cause checks compare the incoming notice against the **live** list. A `never`
notice never joins it, so without a shadow those checks are vacuous for a silenced severity and a
repeating failure would write one record per repeat.

So the provider keeps a second, non-rendered map:

```ts
interface SilencedEntry {
  expiresAt: number;
  /** Panel ids already reported for this key — what makes FR-005c decidable. */
  reported: Set<string>;
}
/** key → entry. The notice's `groupKey` where it has one, else the duplicate-check tuple. */
silencedRecently: Map<string, SilencedEntry>
```

- **The key is the `groupKey` when the notice has one**, and the duplicate-check tuple only when it
  does not. Keying purely on the tuple breaks parity for unclassified failures: two different
  operations producing identical message text — reopening the same broken project twice inside one
  timeout window — carry different group keys, so the displayed path raises a fresh notice per
  FR-037a while a tuple-keyed shadow would suppress the second silently.
- A silenced notice is added on acceptance, expiring after **its severity's `timeoutMs`** — the
  dwell the notice would have had. Every severity carries a `timeoutMs` whatever its mode, which is
  why the field is populated for `never` and `dismiss` too.
- The duplicate and cause checks consult it alongside the live list.
- **It suppresses only a notice reporting nothing new (FR-005c).** An incoming notice whose
  `affected` contains a `panelId` absent from `reported` passes, writes its record, and adds those
  ids. This is the silenced mirror of FR-006a's growth record: the duplicate key is
  `severity + message + title + action + testId`, none of which change when a fresh notice reports
  newly discovered panels, so without this clause the shadow would swallow exactly the records the
  displayed path emits.
- Entries are dropped lazily on the next `notify`, so the map is bounded by the number of distinct
  silenced events inside one timeout window and needs no timer of its own.

This is the only state a silenced notice creates. It is not a notice, has no id, and is never
rendered or dismissible.

---

## NoticeLogRecord (`packages/core/src/notice/index.ts`)

What crosses the bridge to main, per FR-006/FR-007.

```ts
export interface NoticeLogRecord {
  level: LogLevel;              // derived from severity, in core, once
  severity: NoticeSeverity;
  message: string;
  subject: string;              // already formatted — main does not re-derive
  causeKey?: string;
  affectedCount?: number;
  /** The notice's raw system error (FR-034). Never rendered; the log is one of its two routes. */
  detail?: string;
  /** Per-panel raw errors, where the cause differs per panel (FR-048a). Written one line each. */
  affectedDetails?: readonly { panel: string; detail: string }[];
}
```

**One error, three names** — worth stating because nothing else does: the renderer's
`Notice.copyDetail` is the source, `NoticeLogRecord.detail` is what crosses the bridge, and
`AffectedPanel.detail` is the per-panel equivalent. T025c implements `copyDetail → detail`; they are
the same string, and no layer re-derives it.

**Why `detail` is not optional in spirit**: FR-034 says the raw error is "carried on the notice for
copying **and written to the log**, exactly once each". Without these two fields the log half is a
claim with no mechanism — and for a silenced severity, Copy is unreachable too (no toast to copy
from), so the raw error would reach the user nowhere at all. That is precisely the "complete record"
the whole Never-display guarantee rests on.

**Line shape**: a log line is one line, so the handler writes the notice's own line, then **one
further line per entry in `affectedDetails`**, each naming its panel. Newlines inside a single record
would break the log's format.

Severity → level (FR-006): `error → error`, `warning → warn`, `info → info`, `success → info`.

---

## PanelFailureBanner (`packages/ui/src/renderer/common/panel-failure-banner.tsx`)

One component, every panel type (FR-039).

```ts
export interface PanelFailureBannerProps {
  panelId: string;
  /** Per-type first clause, and the ONLY per-type wording (FR-039). */
  headline: string;                 // 'This file could not be read' | 'This terminal could not be opened'
  subject: NoticeSubject;           // for copy text (FR-052)
  detail: { path?: string; systemError?: string };
  onRetry: () => Promise<boolean>;  // true = condition cleared (FR-045)
  onCancel: () => void;             // editor: back to panel-type selection (FR-043)
  retryFailedText: string;
}
```

**States**: idle · retrying · retry-failed. The banner is not dismissible (FR-046) and unmounts with
its condition. It is never hidden by notification preferences (FR-041/FR-005a).

**Controls**, in this order (FR-042, FR-051): Retry · Copy · Cancel — each an `IconButton` resolving
the theme tokens `retry`, `copy` and `dismiss` with hover titles, never a literal glyph (FR-042b), all
keyboard-reachable (FR-042a), and each also present as a command in the panel's menu (FR-042c).

**The path stays visible** where the panel has one (FR-040a) — 027 (#161) FR-011 depends on it.
