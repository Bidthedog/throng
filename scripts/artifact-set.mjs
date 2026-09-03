// The declared release artifact set, as a CLI (042 FR-011/FR-012/FR-013).
//
// This is what `.github/workflows/release.yml` calls instead of `ls dist/installer/*.exe | head -n1`.
// That idiom appeared three times — to verify, to gate, and to checksum — and with two
// `.exe`-producing targets the three can each pick a different file, so the gates would verify one
// artifact while the release published another's checksum, silently. Every step now names the ROLE
// it means.
//
// The decision is pure and lives in `@throng/core`; `runArtifactSet` marshals argv onto it and
// returns what to print. `main()` is the only part that touches the filesystem, which is why the
// exit codes are unit-testable without packaging anything.
//
//   node scripts/artifact-set.mjs list [--json] [--dir <path>]
//   node scripts/artifact-set.mjs resolve <role> [--dir <path>]
//   node scripts/artifact-set.mjs reconcile [--dir <path>]
//
// Exit codes: 0 success · 2 unknown role or subcommand · 3 declared artifact missing · 4 reconcile
// failed. A non-zero exit ALWAYS writes a reason naming the artifact or role — a silent failure here
// would reintroduce exactly the class of defect this replaces.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { declareArtifactSet, reconcileArtifactSet, resolveArtifact } from '@throng/core';
import { sha256OfFile } from './checksum.mjs';

const SUBCOMMANDS = ['list', 'resolve', 'reconcile', 'checksums'];

/** Read a `--flag value` pair out of argv, or `undefined`. */
function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

/**
 * The pure command decision.
 *
 * @param {{argv: string[], version: string, filenames: string[], dir?: string}} input
 *   `filenames` is what is actually present in the artifact directory; `dir` is used only to build
 *   an absolute path for `resolve`, so the tests can omit it.
 * @returns {{code: number, stdout: string, stderr: string}}
 */
export function runArtifactSet({ argv, version, filenames, dir = '' }) {
  const [subcommand, ...rest] = argv;
  const set = declareArtifactSet(version);

  if (subcommand === 'list') {
    if (rest.includes('--json')) {
      return { code: 0, stdout: JSON.stringify(set, null, 2), stderr: '' };
    }
    if (rest.includes('--paths')) {
      // One path per line, for an upload step that must name every artifact rather than glob for
      // them. Nothing else on the line, so the output can be fed straight to a multi-line input.
      const paths = set.artifacts.map((a) => (dir ? join(dir, a.filename) : a.filename));
      return { code: 0, stdout: paths.join('\n'), stderr: '' };
    }
    const lines = set.artifacts.map((a) => `${a.role}\t${a.filename}\t${a.label}`);
    return { code: 0, stdout: lines.join('\n'), stderr: '' };
  }

  if (subcommand === 'resolve') {
    const role = rest.find((a) => !a.startsWith('--'));
    if (!role) {
      const valid = set.artifacts.map((a) => a.role).join(', ');
      return { code: 2, stdout: '', stderr: `[artifact-set] resolve needs a role — one of: ${valid}` };
    }
    let artifact;
    try {
      artifact = resolveArtifact(set, role);
    } catch (err) {
      return { code: 2, stdout: '', stderr: `[artifact-set] ${err instanceof Error ? err.message : err}` };
    }
    if (!filenames.includes(artifact.filename)) {
      return {
        code: 3,
        stdout: '',
        stderr: `[artifact-set] the declared '${role}' artifact is not present: expected ${artifact.filename}`,
      };
    }
    // The bare path, alone on one line, so `$(node scripts/artifact-set.mjs resolve setup)` is safe.
    return { code: 0, stdout: dir ? join(dir, artifact.filename) : artifact.filename, stderr: '' };
  }

  if (subcommand === 'reconcile') {
    const result = reconcileArtifactSet(set, filenames);
    if (result.matched) {
      return {
        code: 0,
        stdout: `[artifact-set] ${set.artifacts.length} artifact(s) match the declared set for ${version}.`,
        stderr: '',
      };
    }
    const detail = [
      `[artifact-set] ${result.reason}`,
      result.missing.length ? `  missing:    ${result.missing.join(', ')}` : '',
      result.unexpected.length ? `  unexpected: ${result.unexpected.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return { code: 4, stdout: '', stderr: detail };
  }

  return {
    code: 2,
    stdout: '',
    stderr: `[artifact-set] unknown subcommand '${subcommand ?? ''}' — expected one of: ${SUBCOMMANDS.join(', ')}`,
  };
}

/**
 * `checksums` — the declared set with each `sha256` filled from the bytes on disk.
 *
 * Kept out of `runArtifactSet` because it is I/O: hashing is the one thing this CLI does that is
 * not a pure decision. It exists so the release body can be rendered with real digests BEFORE the
 * gated publish step (042 FR-006) — the preview a human approves must be the text that ships, and
 * a table of empty checksums would not be.
 *
 * The digest that is PUBLISHED is still computed at publish time, as the last step that reads the
 * bytes (020 FR-042a); these are the same bytes, and the gate's version binding catches it if they
 * ever are not.
 */
async function emitChecksums(version, dir) {
  const set = declareArtifactSet(version);
  const artifacts = [];
  for (const artifact of set.artifacts) {
    const path = join(dir, artifact.filename);
    if (!existsSync(path)) {
      console.error(`[artifact-set] cannot checksum a missing artifact: ${path}`);
      process.exit(3);
    }
    artifacts.push({ ...artifact, sha256: await sha256OfFile(path) });
  }
  console.log(JSON.stringify({ ...set, artifacts }, null, 2));
  process.exit(0);
}

async function main() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const argv = process.argv.slice(2);
  // The version comes only from the root package.json — the single authoritative declaration
  // (020 FR-001). There is deliberately no --version flag: a flag would be a second source.
  const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
  const dir = resolve(repoRoot, flagValue(argv, '--dir') ?? join('dist', 'installer'));
  const filenames = existsSync(dir) ? readdirSync(dir) : [];

  if (argv[0] === 'checksums') {
    await emitChecksums(version, dir);
    return;
  }

  const { code, stdout, stderr } = runArtifactSet({ argv, version, filenames, dir });
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
  process.exit(code);
}

// Only run when invoked directly, so the tests can import `runArtifactSet` without exiting.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
