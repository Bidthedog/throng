// Evaluate the publish gates (020 FR-028/031/034) — the CLI the release workflow calls before it
// publishes, and `npm run publish:check` for a local dry-run. Exits 0 when publishing is allowed,
// non-zero (naming the unmet condition) when refused. There is NO override.
//
// Inputs (env, so CI can supply them):
//   version                 — read from the root package.json (the single source)
//   THRONG_VERDICT_FILES    — comma-separated per-artifact verdict JSONs, one per declared role
//                             (absent → verification failed; a PARTIAL set is also a failure)
//   THRONG_ARTIFACT_DIR     — where the built artifacts are (default dist/installer)
//   THRONG_QA_SIGNED_OFF    — "1" only when a human approved via the GitHub `release` Environment
//   THRONG_ALREADY_PUBLISHED— "1" when a release for this version already exists
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSetVerdict,
  declareArtifactSet,
  isPlaceholderVersion,
  isVerdictPassingForSet,
  matchReleaseVersions,
  reconcileArtifactSet,
  resolveArtifact,
} from '@throng/core';
import { sha256OfFile } from './checksum.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;

async function main() {
  const isRealVersion = !isPlaceholderVersion(version);

  // The declared artifact set (042 FR-011) — the single thing every check below resolves against.
  const declared = declareArtifactSet(version);
  const artifactDir = resolve(repoRoot, process.env.THRONG_ARTIFACT_DIR ?? join('dist', 'installer'));
  const present = existsSync(artifactDir) ? readdirSync(artifactDir) : [];

  // 042 FR-013 — the built artifacts must be exactly the declared set, in both directions. An
  // artifact nobody declared is a build whose output is not understood, and publishing one that was
  // never verified is what FR-016 forbids.
  const reconcile = reconcileArtifactSet(declared, present);
  const artifactSetReconciles = reconcile.matched;
  if (!artifactSetReconciles) console.error(`[publish-gates] ${reconcile.reason}`);

  // Verification: one verdict per declared role, each passing and each bound to that artifact's
  // actual bytes. A verdict covering only some of the set is a refusal, not a partial pass.
  let isVerified = false;
  let versionsAligned = false;
  const verdictFiles = (process.env.THRONG_VERDICT_FILES ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f !== '' && existsSync(resolve(repoRoot, f)));

  if (isRealVersion && artifactSetReconciles && verdictFiles.length > 0) {
    try {
      const artifactVerdicts = verdictFiles.map((f) =>
        JSON.parse(readFileSync(resolve(repoRoot, f), 'utf8')),
      );
      const verdict = buildSetVerdict(version, artifactVerdicts);

      // 020 FR-042a — each digest comes from the artifact's own bytes, read here rather than
      // trusted from the verdict, so a verdict cannot certify bytes that are not the ones present.
      const actualSha256ByRole = {};
      for (const artifact of declared.artifacts) {
        actualSha256ByRole[artifact.role] = await sha256OfFile(join(artifactDir, artifact.filename));
      }

      isVerified = isVerdictPassingForSet(verdict, version, declared, actualSha256ByRole);

      // Four-way version match (SC-002): filename == package == reported (verdict) == release tag.
      // The tag is the push ref on a version-tag publish; a dispatch creates `v<version>`, so
      // default to that. This binds the release + human sign-off to the exact package (FR-030/033).
      // The `setup` artifact carries the filename, as it did when it was the only one.
      const releaseTag = process.env.THRONG_RELEASE_TAG || process.env.GITHUB_REF_NAME || `v${version}`;
      const match = matchReleaseVersions({
        installerFilename: basename(resolveArtifact(declared, 'setup').filename),
        packageVersion: version,
        reportedVersion: String(verdict.version ?? ''),
        releaseTag,
      });
      versionsAligned = match.matched;
      if (!match.matched) console.error(`[publish-gates] version mismatch — ${match.reason}`);
    } catch (err) {
      // An unreadable/invalid verdict is not a pass (FR-027).
      console.error(`[publish-gates] verdict unusable — ${err instanceof Error ? err.message : err}`);
      isVerified = false;
      versionsAligned = false;
    }
  }

  const isSignedOff = process.env.THRONG_QA_SIGNED_OFF === '1';
  const isAlreadyPublished = process.env.THRONG_ALREADY_PUBLISHED === '1';

  // Release notes (042 FR-005): CHANGELOG.md must hold a non-empty section for exactly this
  // version. An absent file is an absent section, not a pass — the same rule FR-027 applies to a
  // missing verdict.
  const { lookupReleaseNotes } = await import('@throng/core');
  const changelogPath = join(repoRoot, 'CHANGELOG.md');
  const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
  const notesLookup = lookupReleaseNotes(changelog, version);
  const notesBindToVersion = notesLookup.cause === null;
  if (!notesBindToVersion) console.error(`[publish-gates] release notes: ${notesLookup.cause} for ${version}`);

  const { evaluatePublishGate } = await import('@throng/core');
  const result = evaluatePublishGate({
    isRealVersion,
    versionsAligned,
    isVerified,
    isSignedOff,
    isAlreadyPublished,
    notesBindToVersion,
    artifactSetReconciles,
  });

  if (result.allowed) {
    console.log(`[publish-gates] ALLOW — version ${version} is real, verified, and signed off.`);
    process.exit(0);
  }
  console.error(`[publish-gates] REFUSE — ${result.reason}. (version=${version})`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`[publish-gates] ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
