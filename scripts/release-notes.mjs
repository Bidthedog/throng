// Render the complete GitHub Release body (042 FR-001 to FR-010).
//
// Replaces the hardcoded heredoc in `.github/workflows/release.yml`, which produced an identical
// body for every release: two consecutive releases differed by a version number and a hash, so a
// user could not tell what had changed.
//
// The notes come from `CHANGELOG.md`, committed BEFORE the tag, so the review happens on a diff.
// This CLI never composes text of its own and never falls back to another version's notes — a
// missing section is a refusal, because a fallback that produces a plausible body is exactly how an
// unreviewed release ships.
//
//   node scripts/release-notes.mjs render --version <v> [--out <file>] [--artifacts <json>] [--sha <commit>]
//
// Exit codes: 0 rendered · 2 no section for that version (or no version given) · 3 the section is
// empty · 4 unusable input.
//
// It deliberately does NOT hash anything. 020 FR-042a requires each checksum to be computed as the
// LAST step that reads an artifact's bytes, and that step is `scripts/checksum.mjs` at publish
// time; the digests arrive here already computed, via --artifacts.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeReleaseBody, lookupReleaseNotes } from '@throng/core';

/** Read a `--flag value` pair out of argv, or `undefined`. */
function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

/**
 * The pure command decision.
 *
 * @param {{argv: string[], changelog: string, artifacts: object[], commitSha: string}} input
 * @returns {{code: number, stdout: string, stderr: string}}
 */
export function runReleaseNotes({ argv, changelog, artifacts, commitSha }) {
  const [subcommand, ...rest] = argv;

  if (subcommand !== 'render') {
    return {
      code: 4,
      stdout: '',
      stderr: `[release-notes] unknown subcommand '${subcommand ?? ''}' — expected: render`,
    };
  }

  const version = flagValue(rest, '--version');
  if (!version) {
    // Never guess which release is being rendered. The version is the binding (FR-005).
    return { code: 2, stdout: '', stderr: '[release-notes] render needs --version <version>' };
  }

  const lookup = lookupReleaseNotes(changelog, version);

  if (lookup.cause === 'no-section-for-version') {
    return {
      code: 2,
      stdout: '',
      stderr:
        `[release-notes] CHANGELOG.md has no section for ${version}. ` +
        `Add one (or rename '## Unreleased' to '## ${version}') and commit it before tagging.`,
    };
  }

  if (lookup.cause === 'section-empty') {
    return {
      code: 3,
      stdout: '',
      stderr:
        `[release-notes] the CHANGELOG.md section for ${version} lists nothing. ` +
        `If that is deliberate, say so with the exact line: "- No user-visible changes in this release."`,
    };
  }

  return {
    code: 0,
    stdout: composeReleaseBody({ notes: lookup.found, artifacts, commitSha }),
    stderr: '',
  };
}

function main() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const argv = process.argv.slice(2);

  const changelogPath = join(repoRoot, 'CHANGELOG.md');
  const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';

  const artifactsJson = flagValue(argv, '--artifacts');
  let artifacts = [];
  if (artifactsJson) {
    try {
      const parsed = JSON.parse(artifactsJson);
      artifacts = Array.isArray(parsed) ? parsed : (parsed.artifacts ?? []);
    } catch (err) {
      console.error(`[release-notes] --artifacts is not valid JSON: ${err instanceof Error ? err.message : err}`);
      process.exit(4);
    }
  }

  const commitSha = flagValue(argv, '--sha') ?? process.env.GITHUB_SHA ?? '(unknown revision)';

  const { code, stdout, stderr } = runReleaseNotes({ argv, changelog, artifacts, commitSha });
  if (stderr) console.error(stderr);

  if (code === 0) {
    const out = flagValue(argv, '--out');
    if (out) writeFileSync(resolve(repoRoot, out), stdout, 'utf8');
    else console.log(stdout);
  }
  process.exit(code);
}

// Only run when invoked directly, so the tests can import `runReleaseNotes` without exiting.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
