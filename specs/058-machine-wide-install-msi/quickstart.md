# Quickstart: proving machine-wide installation and the MSI

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

How each part of this feature is proved, cheapest first. Shapes and exit codes are in
[contracts/](./contracts/); this file only says what to run and what to expect.

## 1. Unit (seconds, anywhere)

```sh
npx vitest run --project unit release-artifacts verification-verdict publish-gate msi-project \
  install-in-use instance-identity instance-paths nsis-vendored-templates
```

Expect every file green. These cover the declared set with the MSI and scopes, the combination
derivation, the extended verdict and gate (including `unproven`), the MSI project transforms against
a captured template output, the in-use classification, the namespace and copy-identity rules, and the
vendored-template guard.

## 2. Integration (a minute, anywhere)

```sh
npx vitest run --project integration instance-guard daemon-adoption
```

- `instance-guard`: two Node processes in one namespace — the second gets `EADDRINUSE`, delivers its
  launch message and exits; a different namespace starts independently.
- `daemon-adoption`: a daemon of another build from a packaged path is replaced (FR-021a); one whose
  entry file was deleted is replaced (#429); one from a dev tree is left alone (#192).

## 3. Component and E2E

```sh
npx vitest run --project component different-copy-notice
npx playwright test single-instance        # @extended @window, two launches sharing THRONG_PIPE_NAME
```

The E2E launches the app, launches it again in the same namespace, and asserts no second window
appears, the first window is focused, and — for a launch reporting a different `execPath` — the
inline notice names the running copy's location and version.

## 4. Packaging (minutes, this machine)

```sh
npm run package
node scripts/artifact-set.mjs reconcile          # four declared artifacts, exit 0
node scripts/artifact-set.mjs list --combinations
```

Expect `throng-setup-<v>.exe`, `throng-<v>.msi`, `throng-portable-<v>.exe`, `throng-<v>.zip`, and six
combinations.

## 5. The release pipeline rehearsal (CI, no publication)

```sh
gh workflow run release.yml --ref <branch> -f publish=false
```

Expect six combination verdicts plus the coexistence verdict, all passing (any `unproven` named in
the job summary), and a rendered `release-body-preview.md` with **four** SHA-256 rows and an
audience line per artifact. Then remove one verdict from the downloaded set and run
`node scripts/publish-gates.mjs` against it locally: it must refuse and name the combination.

## 6. By hand, on a Windows VM (what CI cannot do)

Needs a VM you can reboot, with an administrator account and two standard accounts.

1. **Restart completion (FR-016a).** Install machine-wide (MSI, then separately the setup). Sign in
   as a standard account and open throng with a terminal running. As the administrator, run the
   newer (or same-version reinstall) package unattended → exit `3010`, the standard account's throng
   keeps running. Restart. Every file under the install root is the new version; nothing from the old
   one remains; both accounts launch throng.
2. **Interactive refusal (FR-016a).** Same setup, but run the upgrade interactively → it refuses,
   names the standard account, changes nothing.
3. **Declining elevation (FR-010a).** As a standard user, run each installer, choose *for all users*,
   decline the prompt → the explanation appears, the scope choice is still showing, nothing is
   installed.
4. **Cross-version upgrade.** Once a second release carries an MSI, upgrade each copy from the
   previous release and confirm the others are untouched — the coexistence job proves this only with a
   same-version reinstall until then (research D11).
