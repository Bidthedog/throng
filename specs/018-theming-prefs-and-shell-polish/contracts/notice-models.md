# Contract: The two notice models

**Replaces nine idioms.** The specification named five; the Phase 0 survey found four more. Building
only the five would leave four behind and make SC-009 ("exactly two notice models exist in the
codebase") **false on the day it shipped**.

## Model 1 — Confirmation

Modal. Blocking. **Text-labelled** decision buttons — the constitution's explicit exception to the
themeable-icon rule, because the label *is* the statement of the consequence being consented to.

```ts
interface ConfirmChoice {
  readonly label: string;        // states the consequence. NEVER an icon.
  readonly value: string;        // what the promise resolves to
  readonly danger?: boolean;
  readonly testId?: string;      // preserved verbatim from the surface being migrated
}

interface ConfirmRequest {
  readonly title: string;
  readonly message: string;
  readonly warningMessage?: string;
  readonly details?: ReactNode;                  // e.g. the app-close running-terminal table
  readonly choices?: readonly ConfirmChoice[];   // DEFAULT: [Cancel, Accept]
  readonly testIds?: { dialog?: string; accept?: string; cancel?: string };
}

function confirm(req: ConfirmRequest): Promise<string | null>;   // null ⇒ dismissed
```

**The binary case is the default and its shape does not change.** That is what lets thirteen existing
E2E suites keep passing untouched. `choices` is what absorbs the three n-way modals.

**Mounted in all three windows** — main, sub-workspace, **and preferences**. It is absent from
preferences today, which is the whole reason the themes surface grew a rival dialog.

### Surfaces replaced

| Surface | Arity | Identifiers that MUST survive |
|---|---|---|
| The promise-based modal *(the survivor)* | binary | `confirm-dialog`, `confirm-accept`, `confirm-cancel`, `confirm-message`, `confirm-warning`, `confirm-overlay` |
| The rival preferences modal | binary | `theme-confirm-dialog`, `theme-confirm-yes`, `theme-confirm-no` |
| The preferences inline confirm strip | binary | `prefs-reset-confirm`, `prefs-reset-confirm-yes`, `prefs-reset-confirm-no` |
| Application close | **3-way** + details table | `app-close-dialog`, `app-close-cancel`, `app-close-terminate`, `app-close-leave`, `app-close-details`, `app-close-message`, `app-close-overlay` |
| Dirty close | **3-way** | `dirty-close-dialog`, `dirty-close-cancel`, `dirty-close-discard`, `dirty-close-save` |
| Unsaved open | **4-way** | `unsaved-open-dialog`, `unsaved-open-cancel`, `unsaved-open-new`, `unsaved-open-discard`, `unsaved-open-save` |

> **`confirm-accept` alone is asserted by 13 E2E specs**, and `confirm-dialog` by most of the same set.
> Identifiers are **preserved, not renamed** (FR-053). Every migrated call site passes its existing ids
> through explicitly.
>
> **The guard reads this table; it does not re-count it.** An earlier draft of this document put a
> precise number on `confirm-dialog` and got it wrong — in the contract whose entire purpose is that
> nothing is lost in the migration. The tables above are the list; the source is the count.

## Model 2 — Notification

Transient. Non-blocking. Dismissable. Themed.

```ts
type NoticeSeverity = 'error' | 'success' | 'info';

interface Notice {
  readonly id: string;
  readonly severity: NoticeSeverity;
  readonly message: string;
  readonly details?: readonly string[];   // e.g. the list of missing files
  readonly testId?: string;               // preserved from the surface being migrated
}

function notify(n: Omit<Notice, 'id'>): void;
function dismiss(id: string): void;
```

### Severity governs persistence — this is not a second model

- `error` → **persists until dismissed**.
- `success` / `info` → auto-dismiss on a timer.

An error notice that silently auto-vanishes would be a worse defect than the nine being replaced. This
is one model with one property, not two models (FR-048b).

### Surfaces replaced

| Surface | Kind | Identifiers that MUST survive |
|---|---|---|
| Projects error strip | error | `project-error`, `project-error-dismiss` |
| Explorer error strip | error | `explorer-error`, `explorer-error-dismiss` |
| Sub-workspaces error strip | error | `subworkspace-error`, `subworkspace-error-dismiss` |
| Terminal-exit strip | info | `panel-exit-<panelId>`, `exit-dismiss-<panelId>` |
| **Themes error strip** *(spec missed this)* | error | `theme-notice-error`, `theme-notice-dismiss` |
| Preferences notice strip | error | `prefs-notice`, `prefs-notice-dismiss` |
| **Restore notice** — non-dismissable today | error | `restore-notice` |
| **Editor notice modal** *(spec missed this)* | error | `editor-notice-dialog`, `editor-notice-message`, `editor-notice-files`, `editor-notice-ok` |

## Theming — and a dead variable to bury

The notification model takes its danger colour from **`--throng-colour-danger`**, which *is* emitted.

**It must NOT use `--danger`, which is a dead variable**: referenced across several files and **defined
nowhere**. So every `var(--danger, X)` in the codebase silently renders its literal fallback `X`.

> **The exact count comes from the guard, not from this document.** Phase 0 reported four; a later pass
> found thirteen, in a file the first count never named; and *that* number came from a search that could
> not see TypeScript. Every hand count so far has been wrong. Let the guard say.

The consequences, today:

- the preferences notice strip is *always* `#e5534b`, whatever the theme;
- the themes error strip renders `--accent` and `--text` — so a failure reads exactly like a success,
  directly contradicting the code comment above it that says it must not;
- two of the four main-window error strips (`#3a1d22` / `#ff9aa6`) and the restore notice
  (`#3a3320` / `#ffe08a`) are hard-coded outright.

The dead alias is **defined or removed** in this feature (FR-051a). A notice that cannot be themed is a
notice outside the theming system (Principle X).

## What must NOT be merged

**Reset** ≠ **Revert** ≠ **Clear** (FR-052). They are three different questions and are already asked
distinctly, per-row and per-tab:

- **Reset** — *"what does throng ship?"*
- **Revert** — *"what did I open this window with?"*
- **Clear** — *"nothing, thanks"*

Collapsing their confirmation strings into one would destroy a distinction feature 015 only just landed.
