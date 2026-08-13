# Contract: the notice API

What a call site may and must say when it raises a notice. This is the contract #195 makes
structural: the compiler enforces most of it.

## NoticeInput

```ts
export type NoticeInput = Omit<Notice, 'id'> & {
  /** REQUIRED. { kind: 'none' } is the deliberate way to say there isn't one (FR-019). */
  subject: NoticeSubject;
  /** Present when this notice consolidates (FR-029). */
  groupKey?: string;
  /** The panels this cause has defeated so far (FR-029, FR-030). */
  affected?: readonly AffectedPanel[];
};
```

**Breaking change, deliberately**: `subject` is required, so all 12 existing `notify()` call sites
fail to compile until each states a subject or `{ kind: 'none' }`. That compile error *is* FR-057 —
the guard is the type system, not a lint rule bolted on afterwards.

## Rules a call site must satisfy

| Rule | Enforced by | Requirement |
|---|---|---|
| A subject or an explicit none | Type system | FR-019 |
| The message does not restate the subject | Review + phrase check | FR-023 |
| No generic stand-in ("this item", "the item", "this file") in message text | Automated check | FR-023 / FR-058 |
| Subject terms match the UI's vocabulary | `NoticeSubject` union — there is no free-text kind | FR-024 |

## Presentation

`noticeHeading(n)` gains the subject:

| Notice has | Heading |
|---|---|
| `title` | The title, unchanged (it already names its event) |
| `subject` ≠ none, `action` | `Couldn't {action} {formatSubject(subject)}` |
| `subject` ≠ none, no `action` | `formatSubject(subject)` |
| `subject` = none, `action`, severity `error` | Today's `An error occurred when you tried to {action}` |
| none of the above | No heading, as today |

The message renders below and states only what went wrong (FR-020).

**FR-023 collides with 029 FR-019e, and the collision is real.** 029 gives the *cause* ownership of
the wording, and its sentences bake the subject in — `"Held" is open in another program.` So the
moment a heading presents that subject, the message restates it, which FR-023 forbids. Neither spec
saw the other. Resolved by one backwards-compatible option on `causeMessage`:

```ts
causeMessage(cause, { subjectPresented: true })   // → "It is open in another program."
```

Same five sentences, one substitution, defaults byte-identical — so every 029 assertion is untouched
and 029 keeps ownership of the wording. This is part of the model, not an implementation detail.

**Giving a call site a subject also means rewriting its action.** The heading is
`Couldn't {action} {subject}`, so `action` must become a bare verb phrase: `'rename this item'` →
`'rename'`, `'list the contents of this folder'` → `'list the contents of'`. An action ending in a
preposition reads correctly and is not a workaround. No artifact mentioned this before US2 met the
call sites, and it is half the work of threading a subject through one.

## Consolidation

When `groupKey` is present:

1. If a live notice carries the same `groupKey`, merge `affected` into it (de-duplicated by
   `panelId`) and do not append a notice. (FR-037)
2. Otherwise append a new notice carrying `affected`. (FR-037a)

When `groupKey` is absent, behaviour is exactly today's: the identical-content check, then 029's
`shouldSuppressForCause`, then append.

## Logging

Every accepted notice — including one whose severity is `never` and which therefore never enters the
list — produces exactly one `NoticeLogRecord` (FR-006).

**A merge is an event too.** When `notify()` grows a live notice rather than appending one, it writes
a further record naming the panels that joined (FR-006a). Without this, a user who has silenced a
severity would have the first batch of affected panels in the log and every later one nowhere.

A notice suppressed as a duplicate, or suppressed by cause, produces **no** record: nothing happened.

## Copy text

**The rule, not a field list.** `noticeToText(notice)` walks **what the notice renders**, in the order
it renders it, and emits the text of each part. It must not be written as an enumeration of known
fields — that is exactly the defect FR-049 exists to prevent, and the one that produced #238: today's
`noticeToText` composes `heading + message + details + copyDetail` and therefore silently drops
`Notice.body`, the `ReactNode` carrying the editor notice's structured file list.

Parts that must appear, because they render:

| Rendered part | Source |
|---|---|
| Heading | `noticeHeading(n)` |
| Message | `n.message` |
| Affected-panel list | `n.affected`, grouped by tab, whole list regardless of scroll (FR-050) |
| **Per-panel raw error** | `AffectedPanel.detail` — each row's own error, where the cause differs per panel (FR-048a). Never rendered (FR-034); copy is its only route to the user |
| **Body** | `n.body` — arbitrary rendered content, today the editor notice's file list |
| Details | `n.details` |
| Raw system error | `n.copyDetail` — never rendered (FR-034), always copied |

**The illustration below is wrong about order, and the rule wins.** It sketches the affected list
above `body`; the card renders `body` first, and the stated rule is "in the order it renders it".
US5 followed the render. No notice carries both today, so nothing observable turns on it — but a
contract whose example contradicts its own rule will mislead whoever reads only the example.

Illustrative output, not a template:

```
{heading}
{message}
{tab name}
  {panel name}
  {panel name} — {that panel's raw error, if it has its own}
{body text, if any}
{details…}
{copyDetail}
```

**The guard** (T065) compares the copied text against the notice's rendered DOM text, so a part added
to the notice in future and forgotten here fails a test rather than shipping.

**Two deliberate asymmetries the guard cannot see**, because both are copied and never rendered:
`n.copyDetail` and `AffectedPanel.detail`. A DOM comparison is structurally incapable of catching
their omission, so each needs its **own** unit assertion (T064) rather than relying on T065. This is
the one place the derive-from-rendered rule does not protect itself.
