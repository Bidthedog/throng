# Terminal lifecycle and terminal keys — constitution detail

Binding: constitution Principles III and IV (`.specify/memory/constitution.md`, *III. Detached, Tagged & Persistent Terminals; IV. Native Terminal Support & Auto-Detection*). The
constitution keeps a one-line MUST for each rule below and points here for its detail, which was
moved verbatim from v7.4.0 at v7.4.1. This file is part of the constitution: change it only through
a constitution amendment (`throng-spec-governance`), and keep the constitution's one-line MUST in
step with it. "Above" and "below" in the text refer to this file, or to the constitution where the
rule named is not here.

## Principle III — no orphaned OS processes

- **No orphaned OS processes (resource hygiene).** When a terminal ends by ANY path
  — user close/kill, panel-destroy, project-delete, application-close "terminate all",
  the shell exiting on its own, or daemon shutdown — every OS resource it created MUST
  be released, including any auxiliary host process the platform spawns per terminal
  (e.g. the Windows/ConPTY `conhost.exe`). A terminal-hosting process MUST reap its
  terminals before exiting, and a detached helper process MUST self-terminate when the
  process it serves is gone. This MUST be verified by a **process-level E2E** that
  asserts the host's terminal-related child processes return to baseline after each
  end path (never merely that the UI updated).

## Principle III — no orphaned terminal windows or views

- **No orphaned terminal windows/views on user-instructed destruction.** When the user
  instructs the application to destroy a terminal by ANY path — closing/killing the
  terminal, destroying its hosting **Panel**, deleting the owning project, or choosing
  "terminate all" on application close — the terminal's on-screen surface (its window or
  Panel view) MUST be fully torn down together with its process (per the resource-hygiene
  rule above). No terminal window, view, or ghost surface MAY be left behind. A destroy
  the user commanded MUST complete: the terminal MUST NOT survive, silently reappear, or
  linger as an orphaned window after the user has ordered its destruction. (This is
  distinct from a *deliberate close of the terminal alone*, where the empty hosting Panel
  is intentionally retained per the rule below.)

## Principle III — the Unload exception to the close/reopen rules

- **Stated exception: an explicit Unload that keeps terminals running keeps
  ALL of them.** When the user unloads a project and the action they chose, by name
  or through the preference that picks the default, is to **keep terminals running**,
  EVERY terminal of that project MUST be kept alive, idle shells included, and each
  MUST be re-attached (live session and restored scrollback) when the project is next
  loaded, never re-created. The exception is confined to that one user-instructed action: **application close
  and every other project close keep the two rules above unchanged**, and an Unload
  that ends terminals is a user-instructed destruction governed by the resource-hygiene
  and no-orphaned-views rules above. The kept terminals remain tagged to their project
  and are ended, like any other, by the project's deletion or by "terminate all" on
  application close.

## Principle III — terminal elevation

- **Terminal elevation follows the application.** A terminal inherits the operating-system
  privilege (integrity) level of the terminal-hosting process; running a terminal **as
  administrator** therefore requires launching throng itself **elevated** — there is no
  separate elevation broker. A per-terminal "run as admin" flag MAY be offered, but MUST be
  available only when the host is elevated; when the host is not elevated the flag MUST be
  disabled. When the host is elevated, a terminal without the flag MUST run at normal
  integrity (de-elevated). Elevation detection and de-elevation are OS-specific and MUST sit
  behind the Principle II abstractions.

## Principle IV — the modifier tiers never override the terminal tiers

- **The tiers never override the terminal tiers above.** A reserved chord stays untakeable
  whatever tier it is in, and a shadowable chord still needs a recorded exception. A tier-1
  chord is captured before the terminal sees it. No default readline or PSReadLine binding
  uses a `1;8` sequence *(046 research R22; the live check against each hosted flavour is
  owed at implementation, as FR-021 requires)*.
  `Ctrl+Shift` with an arrow, `Home`, `End`, `Delete`, a function key or `Tab` carries a
  modifier-encoded sequence that a line editor can bind, and stays subject to the terminal
  tiers.
