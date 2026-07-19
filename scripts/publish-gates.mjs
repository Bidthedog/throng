// Evaluate the publish gates (020 FR-028/031/034) — the CLI the release workflow calls before it
// publishes, and `npm run publish:check` for a local dry-run. Exits 0 when publishing is allowed,
// non-zero (naming the unmet condition) when refused. There is NO override.
//
// Inputs (env, so CI can supply them):
//   version                 — read from the root package.json (the single source)
//   THRONG_VERDICT_FILE     — path to the verification verdict JSON (absent → verification failed)
//   THRONG_QA_SIGNED_OFF    — "1" only when a human approved via the GitHub `release` Environment
//   THRONG_ALREADY_PUBLISHED— "1" when a release for this version already exists
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlaceholderVersion, isVerdictPassingFor, matchReleaseVersions } from '@throng/core';
import { sha256OfFile } from './checksum.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;

async function main() {
  const isRealVersion = !isPlaceholderVersion(version);

  // Verification: a verdict file that passes AND binds to this exact package (version + sha).
  let isVerified = false;
  let versionsAligned = false;
  const verdictFile = process.env.THRONG_VERDICT_FILE;
  const installerFile = process.env.THRONG_INSTALLER_FILE;
  if (isRealVersion && verdictFile && existsSync(verdictFile) && installerFile && existsSync(installerFile)) {
    try {
      const verdict = JSON.parse(readFileSync(verdictFile, 'utf8'));
      const sha = await sha256OfFile(installerFile);
      isVerified = isVerdictPassingFor(verdict, version, sha);
      // Four-way version match (SC-002): filename == package == reported (verdict) == release tag.
      // The tag is the push ref on a version-tag publish; a dispatch creates `v<version>`, so
      // default to that. This binds the release + human sign-off to the exact package (FR-030/033).
      const releaseTag = process.env.THRONG_RELEASE_TAG || process.env.GITHUB_REF_NAME || `v${version}`;
      const match = matchReleaseVersions({
        installerFilename: basename(installerFile),
        packageVersion: version,
        reportedVersion: String(verdict.version ?? ''),
        releaseTag,
      });
      versionsAligned = match.matched;
      if (!match.matched) console.error(`[publish-gates] version mismatch — ${match.reason}`);
    } catch {
      isVerified = false; // an unreadable/invalid verdict is not a pass (FR-027)
      versionsAligned = false;
    }
  }

  const isSignedOff = process.env.THRONG_QA_SIGNED_OFF === '1';
  const isAlreadyPublished = process.env.THRONG_ALREADY_PUBLISHED === '1';

  const { evaluatePublishGate } = await import('@throng/core');
  const result = evaluatePublishGate({ isRealVersion, versionsAligned, isVerified, isSignedOff, isAlreadyPublished });

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
