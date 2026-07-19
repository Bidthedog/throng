# Contract: Installer (electron-builder NSIS, per-user)

**Traces**: FR-007, FR-008, FR-009, FR-012, FR-014, FR-015, FR-016, FR-016a, FR-017, FR-020, FR-021,
FR-022, FR-038, FR-040.

## Configuration (`electron-builder.yml`)

- **target**: `nsis`, `perMachine: false` → installs to `%LOCALAPPDATA%\Programs\throng`, **no admin**
  (FR-012/040).
- **extraResources**: bundled `node.exe` (pinned Node ≥20) + daemon `dist` + daemon native `node_modules`,
  all under the install root (FR-007/009). The renderer/main/preload/asar are packaged as usual.
- **icon**: existing product icon → executable + Start-menu shortcut (FR-014).
- **Add/Remove Programs**: registered so the app appears in the OS installed-apps list (FR-015).
- **NSIS include** (custom): renders the uninstaller checkbox **"also delete my projects and settings"**,
  **unticked by default** (FR-021); a plain uninstall retains data, a ticked box removes it.

## Behavioural requirements

- **B1** After install, every executable component (app, daemon, bundled runtime, natives, icon) is present
  under one root; nothing is fetched at first launch (FR-009).
- **B2** At runtime the app writes nothing under the install root — all state goes to the existing per-user
  data locations (FR-008).
- **B3** Installing over an existing install preserves all per-user data (FR-016) and leaves no previous
  component behind (FR-017).
- **B4** Installing an **older** version over a newer one is **refused** in place; the user is directed to
  uninstall first; the newer install and data are untouched (FR-016a).
- **B5** Uninstall removes every component and leaves no `throng` process running (daemon, helper, terminal
  host) and no shortcut (FR-020); it **retains** per-user data unless the checkbox was ticked (FR-021).
- **B6** An interrupted install leaves no launchable partial product — it rolls back or leaves the prior
  install intact (FR-022).
- **B7** In production the daemon is spawned with the **bundled** `node.exe` (via
  `daemon-lifecycle.ts` `nodePath` injection), not a PATH `node` (FR-009).

## Tests

- **unit** — the production `nodePath` resolver returns the bundled runtime path when packaged, and the
  dev path otherwise (pure logic, no install needed).
- **CI (D6)** — the clean-machine verification job (see `verification-verdict.md`) exercises B1–B6 by
  actually installing/uninstalling on a fresh runner. This runs in CI, not in the authoring session.
