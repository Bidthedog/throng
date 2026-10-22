// Evaluate the publish gates (020 FR-028/031/034) — the CLI the release workflow calls before it
// publishes, and `npm run publish:check` for a local dry-run. Exits 0 when publishing is allowed,
// non-zero (naming the unmet condition) when refused. There is NO override.
//
// Inputs (env, so CI can supply them):
//   version                 — read from the root package.json (the single source)
//   THRONG_VERDICT_FILES    — comma-separated verdict JSONs: one per verification combination
//                             (`artifact-set.mjs list --combinations` names them) plus
//                             verification-verdict-coexistence.json (058 FR-030/FR-031). A file that
//                             is absent is a failed combination, and the refusal names it.
//   THRONG_ARTIFACT_DIR     — where the built artifacts are (default dist/installer)
//   THRONG_QA_SIGNED_OFF    — "1" only when a human approved via the GitHub `release` Environment
//   THRONG_ALREADY_PUBLISHED— "1" when a release for this version already exists
//   THRONG_GAPS_OUT         — optional path; the unproven steps allowed to pass are written there as
//                             JSON, for `release-notes.mjs render --gaps` and the job summary
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  combinationsOf,
  declareArtifactSet,
  evaluatePublishGate,
  evaluateVerification,
  isPlaceholderVersion,
  lookupReleaseNotes,
  matchReleaseVersions,
  reconcileArtifactSet,
  resolveArtifact,
} from '@throng/core';
import { sha256OfFile } from './checksum.mjs';

const COEXISTENCE_FILE = 'verification-verdict-coexistence.json';

/**
 * The pure verification decision: parse the verdict files and ask `@throng/core` whether they
 * certify every combination of the declared set plus the coexistence run (058 FR-030).
 *
 * @param {{version: string, files: {name: string, text: string}[], actualSha256ByRole: Record<string,string>}} input
 *   `files` are the verdict files that EXIST; one that does not is simply absent, and the refusal
 *   names its combination.
 * @returns {{isVerified: boolean, refusal: string|null, reportedGaps: object[], reportedVersion: string}}
 */
export function evaluateVerdictFiles({ version, files, actualSha256ByRole }) {
  const combinations = combinationsOf(declareArtifactSet(version));
  const verdicts = [];
  let coexistence = null;
  let reportedVersion = '';

  const unusable = (name, why) => ({
    isVerified: false,
    refusal: `${name}: the verdict is unusable (${why})`,
    reportedGaps: [],
    reportedVersion,
  });

  for (const { name, text } of files) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      // An unreadable verdict is not a pass (020 FR-027).
      return unusable(name, err instanceof Error ? err.message : String(err));
    }
    if (basename(name) === COEXISTENCE_FILE) {
      coexistence = parsed;
      continue;
    }
    if (typeof parsed?.version === 'string' && reportedVersion === '') reportedVersion = parsed.version;
    if (typeof parsed?.version === 'string' && parsed.version !== version) {
      return unusable(name, `recorded for ${parsed.version}, not ${version}`);
    }
    verdicts.push(parsed);
  }

  const result = evaluateVerification({ version, combinations, verdicts, coexistence, actualSha256ByRole });
  return {
    isVerified: result.passed,
    refusal: result.refusal,
    reportedGaps: [...result.reportedGaps],
    reportedVersion,
  };
}

async function main() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
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

  // Verification: one verdict per combination plus the coexistence run, each passing and each bound
  // to that artifact's actual bytes. A verdict covering only some of them is a refusal, not a
  // partial pass, and the refusal names the combination.
  let isVerified = false;
  let versionsAligned = false;
  let verificationRefusal = null;
  let reportedGaps = [];

  const verdictFiles = (process.env.THRONG_VERDICT_FILES ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f !== '' && existsSync(resolve(repoRoot, f)));

  if (isRealVersion && artifactSetReconciles) {
    try {
      // 020 FR-042a — each digest comes from the artifact's own bytes, read here rather than
      // trusted from the verdict, so a verdict cannot certify bytes that are not the ones present.
      const actualSha256ByRole = {};
      for (const artifact of declared.artifacts) {
        actualSha256ByRole[artifact.role] = await sha256OfFile(join(artifactDir, artifact.filename));
      }

      const files = verdictFiles.map((f) => ({ name: f, text: readFileSync(resolve(repoRoot, f), 'utf8') }));
      const verification = evaluateVerdictFiles({ version, files, actualSha256ByRole });
      isVerified = verification.isVerified;
      verificationRefusal = verification.refusal;
      reportedGaps = verification.reportedGaps;

      // Four-way version match (SC-002): filename == package == reported (verdict) == release tag.
      // The tag is the push ref on a version-tag publish; a dispatch creates `v<version>`, so
      // default to that. This binds the release + human sign-off to the exact package (FR-030/033).
      // The `setup` artifact carries the filename, as it did when it was the only one.
      const releaseTag = process.env.THRONG_RELEASE_TAG || process.env.GITHUB_REF_NAME || `v${version}`;
      const match = matchReleaseVersions({
        installerFilename: basename(resolveArtifact(declared, 'setup').filename),
        packageVersion: version,
        reportedVersion: verification.reportedVersion,
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
  const changelogPath = join(repoRoot, 'CHANGELOG.md');
  const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
  const notesLookup = lookupReleaseNotes(changelog, version);
  const notesBindToVersion = notesLookup.cause === null;
  if (!notesBindToVersion) console.error(`[publish-gates] release notes: ${notesLookup.cause} for ${version}`);

  const result = evaluatePublishGate({
    isRealVersion,
    versionsAligned,
    isVerified,
    isSignedOff,
    isAlreadyPublished,
    notesBindToVersion,
    artifactSetReconciles,
    verificationRefusal,
    reportedGaps,
  });

  if (process.env.THRONG_GAPS_OUT) {
    writeFileSync(resolve(repoRoot, process.env.THRONG_GAPS_OUT), JSON.stringify(result.reportedGaps, null, 2));
  }
  for (const gap of result.reportedGaps) {
    console.warn(`[publish-gates] UNPROVEN ${gap.combination}: ${gap.step} — ${gap.reason}`);
  }

  if (result.allowed) {
    console.log(`[publish-gates] ALLOW — version ${version} is real, verified, and signed off.`);
    process.exit(0);
  }
  console.error(`[publish-gates] REFUSE — ${result.reason}. (version=${version})`);
  process.exit(1);
}

// Only run when invoked directly, so the tests can import `evaluateVerdictFiles` without exiting.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(`[publish-gates] ${err instanceof Error ? err.stack : err}`);
    process.exit(1);
  });
}
