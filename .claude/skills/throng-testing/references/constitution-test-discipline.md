# Test-first quality discipline — constitution detail

Binding: constitution Principle V (`.specify/memory/constitution.md`, *V. Test-First Quality Discipline (NON-NEGOTIABLE)*). The
constitution keeps a one-line MUST for each rule below and points here for its detail, which was
moved verbatim from v7.4.0 at v7.4.1. This file is part of the constitution: change it only through
a constitution amendment (`throng-spec-governance`), and keep the constitution's one-line MUST in
step with it. "Above" and "below" in the text refer to this file, or to the constitution where the
rule named is not here.

## The test layers

- A layered automated test strategy MUST be maintained:
  - **Unit tests** — fast, isolated tests for individual units of logic, with
    collaborators substituted via injected test doubles (see Principle IX).
  - **Component tests** — render a renderer component into a DOM environment and
    assert what it produces: markup, computed style, focus movement within the
    component, keyboard handling, and accessibility attributes. They run without an
    application, a window, a daemon or a shell.
  - **Integration tests** — verify cross-component behaviour, abstraction
    contracts, IPC, and persistence against real (or realistic) implementations.
  - **End-to-end (E2E) tests** — exercise critical user journeys through the
    running application using an appropriate automated E2E tool for the platform
    (the specific tool is pinned in feature plans, not here).

## The lowest layer that can prove it

- **A change MUST ship with automated coverage at the LOWEST layer that can prove
  it.** The layer is chosen by what the assertion needs, not by where the change
  happens to live: a pure decision belongs in a unit test, a rendered output or a
  focus movement inside one component belongs in a component test, and persistence,
  IPC, configuration and process behaviour belong in an integration test. A change
  MUST NOT be marked done without observed passing output from whichever layer
  proves it.

## The E2E reserve, naming the entry, and the budget

- **E2E coverage is RESERVED for behaviour that no lower layer can observe**, and a
  change MUST NOT add an E2E test for anything a lower layer could assert. The reserve is
  this list, each entry under a stable identifier:

  | Identifier | What only the running application can show |
  |---|---|
  | `@reserve:window` | Real window lifecycle and multi-window behaviour |
  | `@reserve:focus` | Focus and z-order across windows |
  | `@reserve:native` | Native menus and dialogs |
  | `@reserve:osdrag` | OS drag-and-drop |
  | `@reserve:pty` | PTY/ConPTY keyboard and rendering fidelity |
  | `@reserve:process` | Process-tree hygiene |
  | `@reserve:layout` | Real layout and rendered appearance: where things ended up and what they look like once a real engine has laid out and cascaded them. The component layer has no layout engine and no real cascade |
  | `@reserve:input` | Real keyboard and input dispatch: what a real engine reports for a chord, and whether a real keystroke reaches the real handler. A synthesised event asserts only the shape the test chose |
  | `@reserve:runtime` | Real application-runtime identity: a true property of the running process that a substitute either lacks or satisfies by coincidence |

  For `@reserve:runtime` the test is that the SUBSTITUTE cannot hold the property, not that a
  chain of components is connected end to end — connection is what the contract and
  component layers prove. An existing E2E test whose assertion a lower layer can make MUST
  be moved down — the replacement written and observed failing against a broken
  implementation FIRST, then the E2E deleted. Coverage is never dropped without a named
  replacement.
- **Every E2E test MUST name the reserve entry that makes it irreducible**, by its
  identifier, and the build MUST fail on a test that names none, names more than one, or
  names an entry that does not exist. A test that appears to need two entries is asserting
  two things and SHOULD be split.
- **The E2E suite MUST carry a declared budget, and the build MUST fail when it is
  exceeded.** The budget is a ratchet: it may fall and MUST NOT rise.

## Significance and category tags

- **Every E2E test MUST carry exactly one significance tag and at least one category
  tag**, and the build MUST fail on a test that lacks either. Significance is
  `@core` — a critical journey — or `@extended` — a regression check. Significance
  classifies a test; it does not select a pull-request lane, because no E2E test runs on
  a pull request, and every E2E test runs in the full pipeline. Category names the area
  the test covers so a targeted run is possible without reading the suite.

## A reported defect begins with a reproducing test

- **A reported defect MUST begin with a test that reproduces it**, observed failing
  for the reason that was reported, before any production code changes — and that
  test MUST be written at the **lowest layer that reproduces the defect**, preferring
  unit, then component, then integration or contract, then E2E. It stays in the suite
  at that layer once the fix lands; it MUST NOT be re-created at a higher layer
  afterwards for reassurance. A cheaper test that passes while the defect is real
  means the layer was wrong, not that the defect was — step up one and try again.

## Running a suite, flakes, and infrastructure faults

- **A test run MUST be executed once, in full, and its complete output captured.**
  - A suite MUST be run **unfiltered**, with its **complete** output written to a file
    or scrollback. Parse the captured output as many times as needed; never re-run a suite
    to learn what it already said.
  - After a failure, **only the failing tests** are re-run, as many times as the fix
    takes.
  - Once the failures pass in isolation, the **full** suite MUST be re-run — once —
    to prove the fix broke nothing else. That full green run is the evidence; a
    partial run is not.
  - A test that fails and then passes on re-run without a code change is **flaky, not
    fixed**. It MUST be investigated and either fixed or explicitly tracked — never
    absorbed into a green bar by repetition.
  - **A fault owned by NO test is infrastructure, not a flake.** A worker- or
    global-teardown crash, a wedged application that blows the runner's teardown budget, or
    a harness error the reporter records as "not a part of any test" carries zero failed and
    zero flaky tests yet exits non-zero. This class MAY be retried **once**, at the shard
    level, and ONLY this class: the retry MUST be gated on the run's own report showing
    **zero unexpected AND zero flaky** results, so it can never turn a genuine test flake or
    failure green. Every such retry MUST be **surfaced** — logged in the run and recorded
    against a tracking issue. The harness MUST **bound its own teardown**, force-terminating
    a wedged application within a deadline.

## Privilege-dependent behaviour

- **Privilege-dependent behaviour MUST be tagged and elevation-gated.** Tests
  whose behaviour depends on running **elevated** (administrator / high integrity)
  — the "run as admin" terminal path and OS **de-elevation** (Principle III)
  — MUST be tagged **`@admin`** and MUST be **skipped when the test process
  is not elevated** (never asserting a hollow non-elevated baseline in their place).
  Such behaviour MUST NOT be claimed verified on the strength of a non-elevated run;
  it MUST be observed passing under an **elevated** run (a dedicated elevated test
  entry point). Because a normal (non-elevated) run therefore cannot cover it, every
  E2E run MUST emit a **reminder** that the `@admin` suite is only verified when run
  elevated, so missing admin coverage is never silently implied by a green bar.
