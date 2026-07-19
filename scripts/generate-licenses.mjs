// generate-licenses — emit the third-party licence manifest shown in the About window
// (020, FR-003a). Lists the FULL production dependency closure that ships in the app — not just
// the root package.json's direct deps, but everything the workspace packages pull in (React,
// CodeMirror, dnd-kit, inversify's internals, …). The set is derived deterministically from
// package-lock.json (every entry not marked dev-only, excluding our own @throng/* workspaces),
// and each package's version + licence + project URL comes from its own installed package.json.
//
// For each package we emit a project link and a licence link, both canonicalised to https so they
// actually resolve: GitHub repos → https://github.com/<owner>/<repo>, licences → the SPDX page for
// the declared SPDX id (which always resolves), else the project page. Dependency-free,
// deterministic (sorted), wired into `npm run build`.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The declared licence as an SPDX id string (handles the legacy object / `licenses` forms). */
function licenceId(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses[0]?.type) return pkg.licenses[0].type;
  return 'UNKNOWN';
}

/** A raw repository/homepage value → a bare URL string (unwraps `{ url }`, strips git+/ .git / #frag). */
function bareUrl(raw) {
  return String(raw ?? '')
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/\.git$/, '')
    .replace(/#.*$/, '');
}

/** Canonical https://github.com/<owner>/<repo> if this package lives on GitHub, else null. */
function githubRepo(pkg) {
  const candidates = [
    typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url,
    pkg.homepage,
  ];
  for (const c of candidates) {
    const m = bareUrl(c).match(/github\.com[/:]([^/]+)\/([^/#]+)/i);
    if (m) return `https://github.com/${m[1]}/${m[2]}`;
  }
  return null;
}

/** The package's project page: its GitHub repo if any, else its homepage, else its repo URL. */
function projectUrl(pkg) {
  return (
    githubRepo(pkg) ||
    bareUrl(pkg.homepage) ||
    bareUrl(typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) ||
    ''
  );
}

/** A live link to the licence: the SPDX page for a plain SPDX id, else the project page. */
function licenceUrl(id, project) {
  // A plain SPDX identifier (letters/digits/dots/dashes, no spaces or expression operators) has a
  // canonical page at spdx.org; anything else (e.g. "SEE LICENSE IN …", "(MIT OR Apache-2.0)")
  // does not, so fall back to the project page.
  return /^[A-Za-z0-9.-]+$/.test(id) && id !== 'UNKNOWN'
    ? `https://spdx.org/licenses/${id}.html`
    : project;
}

const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

// Collect every production package in the install tree. Lockfile v3 keys are install paths
// ("node_modules/foo", "node_modules/a/node_modules/b"); `dev` marks dev-only, `link` marks a
// workspace symlink. Dedupe by name@version so a package pinned once appears once.
const byId = new Map();
for (const [path, meta] of Object.entries(lock.packages ?? {})) {
  const at = path.lastIndexOf('node_modules/');
  if (at === -1 || meta.dev || meta.link) continue;
  const name = path.slice(at + 'node_modules/'.length);
  if (name.startsWith('@throng/')) continue; // our own workspace packages, not third-party
  const id = `${name}@${meta.version}`;
  if (byId.has(id)) continue;

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8'));
  } catch {
    pkg = { version: meta.version, license: meta.license };
  }
  const licence = licenceId(pkg);
  const project = projectUrl(pkg);
  byId.set(id, {
    name,
    version: pkg.version ?? meta.version ?? '',
    license: licence,
    licenseUrl: licenceUrl(licence, project),
    projectUrl: project,
  });
}

const entries = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));

// Written into the UI's built output so it ships as a plain file (electron-builder bundles
// packages/*/dist/**), read by main via resolveFromHere('../third-party-licenses.json').
const out = join(root, 'packages', 'ui', 'dist', 'third-party-licenses.json');
writeFileSync(out, JSON.stringify(entries, null, 2) + '\n');
console.log(`[generate-licenses] ${entries.length} third-party packages → ${out}`);
