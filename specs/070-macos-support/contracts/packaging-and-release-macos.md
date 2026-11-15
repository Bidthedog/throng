# Contract: macOS Packaging and Release

## Build (FR-042 to FR-044)

- `npm run package` on an Apple silicon host produces `throng-V-mac-arm64.dmg` and `throng-V-mac-arm64.zip` in
  `dist/installer`, then `node scripts/artifact-set.mjs reconcile --platform darwin` passes.
- `electron-builder.yml` `mac`: `target: [dmg, zip]`, `arch: arm64`, `identity: "-"`, `hardenedRuntime: false`,
  `gatekeeperAssess: false`, `extendInfo.CFBundleDocumentTypes` (folders, role Viewer). Native filters stay in the
  shared `files` list and keep `${platform}-${arch}` (darwin-arm64, win32-x64, linux-x64); no platform has a `files`
  list of its own, because one replaces the shared list and an exclusions-only list packs the whole repository.
- `packaging/macos/after-sign.cjs`: ad-hoc sign the runtime `node`, every `.node`, node-pty `spawn-helper`, koffi; then
  `codesign --verify --deep --strict`. Then every Mach-O in the bundle must report `arm64` from `lipo -archs`. Any failure
  exits non-zero and fails the build.

## Verify (FR-010, FR-045)

`node scripts/verify-macos-package.mjs <artifact> --role <dmg|macarchive> --runner <current|previous> --expected-version V
--verdict-out <file> [--older <fixture>]`, once per artifact per runner in `.github/macos-runners.json`. Each
artifact-and-runner pair is its own verification combination (`dmg-current`, `dmg-previous`, …).

| Step | Pass when |
|---|---|
| install | the `.app` is copied into a fresh Applications folder from the image or archive |
| launch | the main window opens; no `--no-sandbox` |
| version-match | Info.plist, About and the package filename agree |
| self-contained | the daemon's executable is `Contents/Resources/runtime/node` |
| core-journey | `projects.create`, `terminal.attach`, real data folders, no dev folders |
| reattach | the daemon survives the window closing and the terminal is still listed |
| in-use-upgrade (dmg) | an older running copy is replaced; the version-changed notice appears; the next launch is new |
| checksum-match | sha256 well-formed and recorded |
| no-write | no file in the bundle changes during the run |
| cli-command | the bundle's `bin/throng <folder>` opens the folder as a project |
| uninstall | deleting the bundle while running: the daemon ends once nothing needs it |
| residue-scan | no throng process remains; only the documented user-data folders exist |
| gatekeeper-first-launch | **unproven**: a hosted runner cannot click Open Anyway |

A failed step fails the verdict, and the publish gate refuses the whole release (FR-010 clarification).

## Publish (FR-009, FR-045, FR-048)

The macOS artifacts join `artifact-set.mjs list --paths`, `checksums` and the publish gate. The release body names them,
the best-endeavours statement, the supported-releases rule, the Open Anyway step and `shasum -a 256`.
