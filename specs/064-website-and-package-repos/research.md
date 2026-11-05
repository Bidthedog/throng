# Research: Website and Package Repositories

Containers on 2026-11-04, with an ephemeral signing key, a local static server for the indexes, and a real GitHub
release (`cli/cli` v2.62.0) for the packages. The earlier measurements are on
[#554](https://github.com/Bidthedog/throng/issues/554#issuecomment-6625759084).

## D1. apt reaches release assets through its mirror transport

**Decision: `deb [signed-by=…] mirror+https://throng-ide.com/apt/stable.list stable main`.** The list is two lines:

```text
https://throng-ide.com/apt/	priority:1	type:index
https://github.com/	priority:1	type:deb
```

`Filename` in `Packages` is then `Bidthedog/throng/releases/download/v<version>/throng-<version>-amd64.deb`. apt joins it
to the `type:deb` mirror, GitHub redirects to its asset host, and apt checks the hash from the signed index.

| Check | Ubuntu 24.04 (apt 2.8.3) | Ubuntu 22.04 (apt 2.4.14) | Debian 12 (apt 2.6.2) |
|---|---|---|---|
| Install from a real GitHub release, signed | pass | pass | pass |
| Changed `Packages` | refused | refused | refused |
| Changed `InRelease` | refused | refused | refused |
| No signature | refused | refused | refused |
| Signed index, wrong package hash | refused | refused | refused |

Rejected:

- **A source line naming GitHub, flat repository on `releases/latest/download`.** Works per #554, but the source does not
  name the final URL, and `latest` cannot serve a prerelease channel.
- **A redirecting host.** Another service to run, when the issue scopes this to Pages.
- **Package files on Pages.** The maintainer ruled it out.

The mirror list itself is unsigned, over HTTPS. Changing it can only send apt to a different server, whose bytes then
fail the signed hash.

## D2. rpm: signed metadata, unsigned package

**Decision: `createrepo_c --baseurl <release>/` with `gpgcheck=0`, `repo_gpgcheck=1`.** On Fedora 43 (dnf5 5.2.18): installs
from a real GitHub release, and refuses a changed `repomd.xml`, a changed `primary` and a missing `repomd.xml.asc`. The
metadata carries the package's digest, so the chain holds with no package signature. dnf imports the key with `-y`, and
asks the user otherwise. `--no-database` because dnf does not read the sqlite files. An Ed25519 key is accepted by both.

dnf5 skips a repository it cannot trust, with a warning and exit 0, and then offers nothing from it. So refusal on Fedora
reads as an empty query, and `verify-package-repo.mjs` first checks that the untouched index does offer the package.

## D2a. The route with throng's own packages

`verify-package-repo.mjs` with the `.deb` and `.rpm` from rehearsal `41794717905`, on Ubuntu 24.04 and Fedora 43: every
check passes (install, upgrade from `0.9.0`, channel separation, the refusals). A bundle built by `package-repo.mjs` on
Ubuntu 24.04 with its `createrepo_c` 0.17.3, as `sign-index` does, installs throng on Ubuntu 22.04, Debian 12 and Fedora 43.
These served the packages locally. The real GitHub redirect is D1's measurement, with another project's release.

## D3. One job signs, another publishes, with one approval

The private key is in the `release` Environment, and `publish` runs on Windows, which must not change (FR-014).

- **`sign-index`** (Linux, `environment: release`) builds and signs the bundle and uploads it as a run artifact. It has the
  same `needs` and `if` as `publish`, so the two wait at the Environment together.
- **`deploy-repositories`** (Linux, no Environment, no key) needs both. It attaches the bundle to the release and
  dispatches the Pages deployment.

A second Environment job behind `publish` would ask for a second approval after the release was already out. Whether
GitHub clears two jobs waiting together with one approval is **unproven until a real publish**. If it asks twice, it is
one more click and nothing else differs.

Signing before publication does not change any repository: only `deploy-repositories` does, and it needs `publish`.

## D4. Deployments are assembled from bundles

A Pages deployment replaces the whole site, and a change to a static file must not need the key. So every deployment downloads the
signed bundles from the releases and lays them beside the website. A failed download fails the job, and Pages keeps
serving the previous deployment.

`pages.yml` runs on `master` and is dispatched by `deploy-repositories` with `--ref master`. It cannot be called from the
tag's run: the `github-pages` Environment accepts the default branch only by default.

## D5. Channels

A stable bundle holds both channels' indexes and a prerelease bundle holds only `prerelease`. `stable` is taken from the
highest stable release, and `prerelease` from the highest of all, by SemVer precedence. `compareVersions` in
`@throng/core` ignores prerelease suffixes by design, so the script has its own comparison.

## D6. The website is deferred

The first version of the page was set aside at the maintainer's review (spec, Clarifications). `site/` holds only the
channel files and the public key, so the root serves nothing until a page is added. Nothing here depends on a page:
adding one under `site/` deploys beside the repositories, as FR-008 requires.
