# Contract: PanelFailureBanner

One component, every panel type (#236). Replaces `editor/unloadable-banner.tsx` and the terminal's
`terminal-panel__starting` failure strip.

> **Two namespaces collide by prefix, and only by prefix.** `panel-failure-{panelId}` (this banner)
> and `panel-failure-notice` / `panel-failure-notice-dismiss` (US3's consolidated notice) both match
> `[data-testid^="panel-failure-"]`. Exact ids can never collide — panel ids are uuids — but any
> locator that sweeps by prefix counts the notice card and its dismiss button as panels. Measured:
> the wedge spec counted 3 where one panel had failed. An *equality* exclusion is not enough; it
> catches the card and leaves the button. Anything sweeping this prefix — US5's copy control included
> — needs a prefix exclusion.

## Props

```ts
interface PanelFailureBannerProps {
  panelId: string;
  headline: string;                 // the ONLY per-type wording (FR-039)
  subject: NoticeSubject;           // for copy (FR-052)
  detail: { path?: string; systemError?: string };
  onRetry: () => Promise<boolean>;  // resolves true when the condition cleared
  onCancel: () => void;
  retryFailedText: string;
}
```

Per-type wording is confined to `headline` and `retryFailedText`. Everything else — layout, spacing,
colours, control order, accessible names — belongs to the component.

## Rendering

```
{headline}
{path}                                              [retry] [copy] [dismiss]
Copy the details here, or see the notification.
```

- `data-testid="panel-failure-{panelId}"` on the root.
- Colours come from theme tokens only; the component carries none of its own (FR-047).
- Not dismissible (FR-046) — the Cancel control is not a close button and has a different meaning.
- **The path stays visible** when there is one (FR-040a). It is not duplicated detail: 027 (#161)
  FR-011 makes it load-bearing, because a recovered buffer over a path throng could not open looks
  entirely ordinary and a Ctrl+S would write it back. Delegating detail to the notice does not extend
  to the path.

**The pointer sentence is fixed, not left to the implementer** (FR-041 requires it to hold when no
notice exists):

> `Copy the details here, or see the notification.`

Copy leads, because it always works; the notice is the secondary route because it may have been
dismissed, timed out or silenced.

## Controls

Every control is an `IconButton` resolving a **theme icon token** with a hover title — the
constitution's non-negotiable rule for action controls, restated by 029 FR-004b and by FR-042b. Never
a literal glyph; the theme already ships `copy: '⎘'`, which is not `📋`.

| Token | Label (FR-042d) | Behaviour |
|---|---|---|
| `retry` | **Try again** | `onRetry()`. Resolves `true` → the condition clears and the banner unmounts with it. Resolves `false` → the banner stays and shows `retryFailedText` (FR-045) |
| `copy` | **Copy details** | Puts the banner's own text on the clipboard (below) — works with no notice on screen (FR-053) |
| `dismiss` | **Clear panel type** | `onCancel()`. Editor: back to panel-type selection, panel and title kept (FR-043). Terminal: exactly today's behaviour (FR-044) |

The labels are 029's, unchanged, in both panel types — which is how "the same titles and accessible
names everywhere" (FR-042) is satisfied without regressing 029 FR-004a/FR-004d or churning the five
test ids that depend on them. *Clear panel type* is accurate for the editor too: returning a panel to
its panel-type selection screen is clearing its type.

Order is fixed and identical in every panel type (FR-042). All three are in the tab order and
operable by keyboard (FR-042a), with the same accessible names everywhere.

## Panel menu

**All three** commands — Try again, Copy details and Clear panel type — MUST also appear in the
panel's own menu, for every panel type showing the banner (FR-042c). A panel command that exists only
as a banner button is unreachable from where users look for panel commands; 029 FR-004d is the
precedent, and `terminal-panel.tsx:306` already ships `Clear panel type` as a menu item. Copy is not
an exception because it is "just a copy button": it is a discrete command acting on a Panel, which is
the whole test.

## Copy text (FR-052)

```
{headline}
{formatSubject(subject)}          ← full Project — Tab — Panel form; no surrounding context to elide
{detail.path}
{detail.systemError}
```

Verbatim to the clipboard (FR-054). A clipboard failure is reported through the notice model
(FR-055).

## Independence from notification preferences

The banner renders whenever its condition holds, whatever any severity's display mode is
(FR-005a/FR-041). Its pointer text must remain true when there is no notice, which is why the fixed
sentence above leads with Copy rather than with the notification.

**Transitional wording while US4 ships without Copy**: until the copy control exists (US5), the
banner's pointer reads `Details are in the diagnostic log.` It names the **only** route that is
unconditionally true at that point — Copy does not exist yet, and the notification may have been
dismissed, timed out, or never shown, which is exactly what FR-041 forbids a pointer from promising.
US4 asserts the banner appears with every severity silenced (T056), so a transitional sentence
mentioning the notification would contradict its own phase. T069b switches it to the fixed sentence
above in the same change that adds the control.

## Call sites

| Panel type | headline | onRetry | onCancel |
|---|---|---|---|
| Editor | `This file could not be read` | `reloadFromDisk()` | back to panel-type selection — **new capability** |
| Terminal | `This terminal could not be opened` | re-launch the shell | today's Clear panel type |

Neither call site keeps its own markup; both must import this component (FR-039). A new panel type
gets the banner by using it, not by copying it.
