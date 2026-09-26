# Flake case studies: waiting on the wrong signal, and an app that says something untrue

Read when a waited-for value comes back empty or stale, when a flake vanishes under instrumentation, or when a terminal spec asserts on DEC private modes.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## The thing you waited for may not be the thing you are about to read

**The thing you waited for may not be the thing you are about to read.** Everything above is about
waiting rather than sleeping; this is the case where you waited on a real condition, correctly, and
still read too early — because the observable you chose happens *before* the effect you are
asserting. A wait is only a synchronisation if it is downstream of the write.

`navigation-remember.e2e.ts` lost that one for months (#321). Accepting a Quick Open query ends with
the modal gone, so the helper waited for `quickopen` to reach count 0 — an honest condition, and the
wrong one. `quick-open.tsx`'s `choose` calls `onDismiss()` **synchronously** and then does the real
work in an async IIFE:

```ts
onDismiss();                                          // the modal disappears HERE
…
const opened = await openFileInTab(ws, tabId, absPath, target);
if (!opened) return;
if (remember) rememberQuickOpenQuery(query, root);    // …and the query is recorded HERE
```

That ordering is deliberate and required by 033's FR-061 — "accepted" means a file actually opened,
so a route the user cancels at the unsaved-changes prompt must record nothing. The helper returned
between the two, and the caller then read the remembered value with a plain, non-retrying `expect`.

It failed about once in 705 serial executions on a warm machine and **four times in twenty** on a
cold worktree, where opening the file is slow enough to lose the race reliably. The fix was to wait
for the file to be on screen — the record's actual precondition — not for the modal to go.

Two things make this class hard to spot, and both are worth checking for by hand:

- **The symptom names the wrong thing.** `Expected: "guide" / Received: ""` reads as "the feature
  did not remember", so you go looking at the store. The store was fine; nothing had asked it to
  remember yet.
- **Instrumenting it can hide it.** A probe that reads state over IPC *before* the assertion adds a
  round trip, which is enough to let the pending write land: the same spec went 10/10 green with an
  eager probe in place and 7/10 without it. If a diagnostic makes a flake disappear, that is
  evidence about the timing, not an exoneration — capture into a global and read it in the failure
  path only.

So when a value comes back empty rather than wrong, ask what wrote it and *when*, and check that the
condition you waited on is downstream of that write rather than merely near it.

**…and it may be downstream of a different channel entirely.** The variant above is one write with a
wait placed too early in it. This one is two writes that never had an ordering, and it is not an E2E
problem — #335 was a **component** test, which is worth saying out loud, because "flake" reads as
"Electron, six workers, a real shell" and this needed none of that.

`mount-editor.ts` feeds a mounted editor from two independent promises: the document through
`editor.getContent()`, and the settings through `config.get()`, which `ConfigProvider` awaits in its
own effect. Nothing sequences them. `editor-update-listener.test.ts` mounted with
`autoSave: true`, waited for the document text — the obvious "it is ready" signal, and the one every
other test in the file needs — and then asserted on a timer that only exists if the *settings* have
landed:

```ts
if (metaRef.current.settings.autoSave && configRef.current.filePath) {
  autoSaveTimer.current = setTimeout(…, metaRef.current.settings.autoSaveDebounceMs);
}
```

The shipped default for `editor.autoSave` is `false`, so losing that race arms nothing at all and the
assertion sees an empty array rather than a wrong number — the same misleading symptom as #321.

Three things generalise from it:

- **Two channels with no barrier are a race even when both promises are already resolved.** Under
  vitest they settle within a few microtasks of each other, which is why this passed locally,
  through a full `npm run gate`, and on most CI runs. It failed on a loaded GitHub runner and passed
  on a re-run of the same commit.
- **A default that is `false` turns a stale read into an absence.** Had the default been a different
  *number*, the filter would have found a timer with the wrong delay and said so. Prefer asserting
  the precondition directly — `mounted()` now also checks `h.settings()` — so a green result cannot
  come from the defaults.
- **The fix is a precondition, not a longer wait.** `mountEditor` exposes `settingsLoaded()` from a
  witness component rendered under the provider, and `configDelayTicks` pushes `config.get()` behind
  the document deliberately, so the race is lost on *every* run rather than one in a few hundred.
  A regression test that cannot lose the race is not a regression test.

The general form: **when a test mounts something with configuration, "the subject appeared" is not
"the configuration arrived".** Wait for the observable that setting produces, or for the setting
itself.

**…and the signal you waited on may have been written OPTIMISTICALLY.** The third sibling, #290. The
two above are about picking a signal that is upstream of the write, or on the wrong channel. This one
is about a signal that is genuinely on the right channel, genuinely means what it says — and is set
*before the work happens*, on purpose, because the UI would otherwise feel slow.

Opening a project is optimistic on the sidebar's side and awaited on the workspace's side:

```ts
// projects-store.tsx — synchronous, before any await
setOpenedId(id);                                   // .project-item[data-active] flips HERE
const opened = await run('open', …, () => client.setActive(id));
```

```ts
// workspace-store.tsx — and this deliberately does NOT clear `layout` first
void client.load(activeProjectId).then((result) => setLayout(applyReloadMode(result.layout, …)));
```

Not clearing `layout` is the right call — blanking the pane on every switch was a visible flash — but
it means there is a window, one RPC long, in which **the sidebar names the new project while the DOM
still holds the old project's `<TabGroup/>`**. A test that clicks a project row, waits for
`data-active`, and then reads a panel id gets a panel belonging to the project it just left. Nothing
recovers from that: `terminal-<that id>` can never exist, so the next locator waits out its entire
budget and fails with `element(s) not found` — which reads as a slow app, or as the panel failing to
restore, and is neither.

What makes this one worth its own entry:

- **The right signal already existed and was one attribute away.** `app.tsx` stamps
  `data-project={layout.projectId}` on `workspace-pane`, from the very state whose arrival mounts the
  new panels — same commit, so when it reads the project you asked for, the panels on screen are that
  project's *by construction*. `switchProject()` in the harness waits on it; every caller that clicks
  a project row and then reads panel state should use it.
- **Auto-waiting does not save you, because the wrong answer is already on screen.** `firstPanelId()`
  uses `.evaluate()`, which auto-waits for a `.panel-box` — and one is already there. Playwright's
  auto-waiting resolves "not yet rendered"; it cannot resolve "rendered, but stale".
- **Measure the window, not the flake rate.** A probe that switched back and forth 150 times and read
  the pane id and the panel id in one pass found the window open on 3 trips and the *wrong panel id
  actually returned* on 2 — while the same read behind the `data-project` wait was wrong 0 times.
  That is a far better artifact than "1 failure in 6 runs", because it names the mechanism instead of
  sampling its consequences, and it costs 20 seconds instead of six full spec runs.
- **The gap between 3 and 2 is the lesson about diagnostics.** On the third trip the window was open,
  yet the id came back correct — `firstPanelId` does its own round trip, and that was enough for the
  layout to land. Every extra hop between the click and the read shrinks the failure rate without
  closing anything, which is exactly why the flake presented as rare and load-dependent.

The general form, across all three: **ask what writes the thing you are about to read, and wait on
something that cannot be true before that write has happened.** "Near it", "usually after it", and
"set when the work was requested" are all the same bug.

## When waiting correctly is not enough, because the app is telling the renderer something untrue

The three above are all the test's fault: it read something before the thing that writes it had run.
The two below are **not**, and the distinction is worth holding onto, because the first instinct on
meeting them is to add another wait — and no wait fixes either. The test waited correctly and was
told a lie.

Both surfaced in `preferences-reset.e2e.ts` chasing [#341](https://github.com/Bidthedog/throng/issues/341),
and both turned out to be product defects that cost a user real work rather than harness problems.

- **A broadcast can be older than the write it lands after.** A watcher read is not instantaneous —
  it opens three documents and enumerates the icon-pack directory, and 032 FR-008 makes it retry for
  up to ~100 ms when it catches a partial write. A config write can commit inside that window, so the
  payload describes a file that has stopped saying it, and it reaches the renderer *after* the
  renderer adopted the write that superseded it. The renderer cannot defend itself: `onChange`
  replaces the whole state because a broadcast is supposed to *be* the truth, and nothing in the
  payload ever said which moment it was the truth at.

  The damage is not a stale render. The preferences tabs compose their next edit from what they were
  last told, so the next whole-document write puts the reverted value **back on disk**. Remove a
  chord from `zoom.in`, get reverted, remove one from `zoom.out`, and that second write restores
  `zoom.in` to its shipped value. The Reset control then correctly reports the row as un-overridden,
  which is why the failure presents as a click that never becomes actionable rather than as a wrong
  value. `ConfigPayload.generation` now carries the store's commit count as at the read's *start*,
  and a read the counter has outrun is never broadcast.

- **A window that is interactive before it has loaded cannot honour "revert".** The preferences
  editors rendered from the shipped defaults while `config.get()` was in flight. An edit made in that
  gap is already in the payload that resolves the load, so the on-entry snapshot — captured on the
  render where `loaded` first turns true — records the *edited* value, and "revert every editor to
  its state when this window opened" restores the very thing the user was discarding. Retrying the
  read cannot help: a re-read returns fresher content, never the state the window opened with.

  The worse half never reached the tracker on its own: the Key Bindings tab composes **whole
  documents** from what it currently holds, so one edit in that gap writes the default keybindings
  over the user's real ones. The editors now wait for `loaded`; the toolbar does not.

Measured, `preferences-reset.e2e.ts` alone, idle machine, one worker, retries off: **5 failed / 14**
before, **1 / 14** after the first fix, **0 / 16** after the second — then a full `npm run gate` at
560 E2E, 0 flaky.

The general form of *these* two: **ask whether the thing telling you is entitled to be believed.**
A payload with no notion of when it was true, and a window with no notion of what it opened with,
are both saying "this is the state" while holding no evidence for it.

## A terminal test that asserts on DEC private modes must use `windows-powershell`

**Which DEC private modes reach xterm is decided by the system ConPTY, not by the program that wrote
them** — so a terminal spec can arm a mode, observe nothing, and pass while measuring nothing at all.
This is worse than a flake: a flake is loud, and this is silent.

Measured on Windows 11 26200, one Node fixture writing the same four sequences under each flavour:

| Written by the program | `cmd` | `windows-powershell` |
|---|---|---|
| `CSI ? 1049 h` (alt screen) | reaches xterm | reaches xterm |
| `CSI ? 1002 ; 1006 h` (mouse + SGR) | **never arrives** | reaches xterm |
| `CSI ? 1015 h` (urxvt encoding) | reaches xterm | reaches xterm |
| `CSI ? 1003 h` (any-event mouse) | **never arrives** | reaches xterm |

The missing set under `cmd` is exactly `MOUSE_REPORTING_MODES` from
`core/src/terminal/wheel-decision.ts`. Nothing in throng filters them, and xterm 6.0.0 cannot skip a
registered `?…h` handler — its parser dispatches by prefix and final byte alone
(`EscapeSequenceParser.ts`, `CSI_DISPATCH`), and it answers DECRQM for any `$p` it receives, which it
did not. So the bytes never reached the parser. The surviving set matches the ConPTY note at
`platform-windows/src/node-pty-host.ts:127-142` from #298, which already records that this varies by
Windows build; the flavour is a second axis on the same mechanism, and `terminal-claude-keys.e2e.ts`
was on `windows-powershell` when it recorded real SGR mouse reports.

**So: pick the flavour deliberately, and put an anti-vacuity control in front of the assertion** — one
that fails when the negotiation did not happen, separately from the behaviour under test.
`terminal-mouse-negotiation.e2e.ts` is written that way, and the control is what caught this: without
it the spec would have passed under `cmd` for any implementation, correct or not.
