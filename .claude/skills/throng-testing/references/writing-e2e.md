# Writing an E2E spec

Read before writing or converting an E2E spec: config-root writes, sharing one app per file, and the harness helpers that close the common race classes.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## Writing a running app's config root

**A test that writes into the config root of an already-running app MUST use the shared atomic
helper.** There is exactly one, `packages/ui/tests/e2e/helpers/config-write.ts`, and
`packages/ui/tests/unit/config-write-helper-single.test.ts` fails the build if a spec writes any
other way.

```ts
import { writeSettingsAtomic, writeConfigRawAtomic } from './helpers/config-write.js';

writeSettingsAtomic(cfgRoot, { appearance: { theme: 'Matrix' } });   // a JSON value
writeConfigRawAtomic(cfgRoot, 'settings.json', '{ deliberately broken');  // raw text, on purpose
```

### Why, precisely

`writeFileSync` **truncates the target and then fills it**. Against a file nobody is watching that is
invisible. Against a running throng it is a race the app can lose: the config watcher is debounced
but not synchronised with the test, so it can wake while the file is empty, read unparseable JSON,
and broadcast the shipped defaults as though they were the settings the test just wrote.

The change is then **lost, not late** — which is why a longer timeout never helped, and why the
failure reads as a product defect that does not exist. It surfaced as *"the rename field never
started enforcing a limit of 64"* (#243) and as three more sites in #253.

The helper stages a temp file **in the same directory** as the target — a rename is only atomic
within a volume, so staging in the OS temp directory and renaming across would silently degrade to
copy-then-delete — then replaces, retrying EPERM/EACCES/EBUSY on a **1000 ms budget at 20 ms
intervals**. Those numbers deliberately mirror the product's own `renameWithRetry`
(`packages/ui/src/main/config-store.ts`): a helper that gave up sooner would report failures the
product would have survived, and one that persisted longer would hide contention the product cannot
tolerate.

### A pre-launch seed is NOT this

Writing `settings.json` **before** `runApp` is fine with a plain `writeFileSync`: no app is running,
no watcher exists, and nothing can race. Of 36 config-document writes in the E2E tree, 32 are
pre-launch seeds. #253 named one of them as a defect and it is not one — the classification is by
brace depth relative to the enclosing `runApp`/`openApp`, not by eye.

### And do not wait on the clock afterwards

A settings write is picked up asynchronously, so the honest sync point is the **condition** the test
is about — the counter that reads the new limit, the option that appears in the dropdown, the
accelerator that starts firing. A `waitForTimeout` guesses a duration on one machine; the poll is
both correct and usually faster. Where the stimulus itself can be lost (a keypress delivered before a
rebind is installed is simply discarded), repeat the **stimulus** inside the poll, not just the
assertion.

## One app per file, not one per test

Every `runApp()` is an Electron launch, a daemon and (for terminal specs) a real shell — about two
seconds on CI, and the suite once paid it 604 times for 634 tests. Most of that bought nothing.

A launch is only genuinely needed when a test **seeds state before the app starts**: a config root
with themes in it, a pre-populated database, `skipDaemon`. Those keep their own app. Everything else
can share one:

```ts
import { openApp, runApp as runOwnApp, type OpenApp } from './harness.js';

test.describe.configure({ mode: 'serial' });
let shared: OpenApp;
test.beforeAll(async () => { shared = await openApp(); });
test.afterAll(async () => { await shared?.close(); });
```

Serial mode is not optional: the tests share a window and a database, so they must not interleave,
and a failure should skip the rest rather than run them against whatever it left behind.

Two rules learned the hard way:

- **Never let a shared-app shim accept launch options.** Dropping a seeded config root does not fail
  a test, it makes it pass for the wrong reason — measured once, where a swallowed
  `editor.openOnClick: 'double'` let a single click open the file and the assertion saw 2 opens where
  it expected 0. A test needing options calls `runOwnApp`.
- **Give shared projects unique names.** Projects accumulate in a shared app, and fifteen called
  "Demo" make `.project-item` ambiguous.

Not every file can do this, and that is fine. Of 54 candidates, 34 converted and 20 were reverted
because their assertions genuinely depend on a pristine app — panels and projects accumulate, and
"the panel shows its new title" then finds the previous test's panel. **Convert one file at a time
and run it**; that is the only way to tell which kind you have. `explorer.e2e.ts` went from 46s to
12.8s this way.

## Writing a test that does not flake

Several helpers in `packages/ui/tests/e2e/harness.ts` exist to close the race classes that produced
most of the flakes we found. Use them:

- **`settle(win, root?)`** — a POSITIVE assertion that the window has rendered. Make it the first
  statement of any test that later reads raw state. A *negative* opening assertion
  (`await expect(x).toHaveCount(0)`) is satisfied vacuously by a DOM that has not rendered anything:
  it looks like a wait and settles nothing. (The Preferences window's root is `.prefs-root`.)
- **`geom(locator)`** — element geometry, polled until the element **stops moving**. Never reach
  through `page.evaluate` to `querySelector(...).getBoundingClientRect()`: that read does not wait
  for the element to exist *or* to stop animating, and both failures look like flakiness rather than
  like the broken read they are.
- **`viewport(win)`** — window dimensions, for measuring a control against the window edge.
- **`commitPanelRename(win)` / `commitTabRename(win)`** — commit the inline rename that `panel-add`
  and `tab-add` open the new panel/tab in. They wait for the input, assert it holds focus, press
  Enter and return only once it is gone.
- **`focusEditor(win, panelId)`** — click into a panel's editor and wait until it *actually* has
  focus. A click resolves when the event is dispatched; CodeMirror adds `.cm-focused` a beat later,
  and keys sent in that gap go nowhere.

Prefer an assertion on a real condition (`toBeVisible`, `toHaveCount`, `expect.poll`) over
`waitForTimeout(n)`. A sleep asserts that *n* milliseconds is always enough; a condition asserts that
the thing you are about to measure has actually happened.

**Never send a key at a control you have not asserted is there.** This is the same rule, but it fails
differently and much more expensively: an unsynchronised *read* returns the wrong value, while an
unsynchronised *keystroke* goes to whatever holds focus instead — and that surface may well act on
it. A bare `await win.keyboard.press('Enter')` to commit a new panel's rename does nothing visibly
wrong when the input has not mounted yet; the Enter reaches the editor that had focus, which inserts
a **newline into the document**.

Nothing fails there. The test carries on against a fixture that is now one line longer than the file
on disk, and dies later on an assertion that names the feature under test:

```
Expected: "CCCCZ"
Received: "BBBB"
```

That failure is a lie — the caret never moved, the *text* did — and it sends you into the product
code for as long as you believe it. Hence the helpers above: they are not shorthand for the raw
call, they are the difference between a key that lands where you meant it and one that quietly edits
your fixture.
