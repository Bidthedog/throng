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
//
// 069 (FR-022): the Lucide art compiled into @throng/core is not an npm dependency of the app, so it
// would never appear in the lockfile walk. `VENDORED` declares such upstreams by hand, with the licence
// text itself (read from the copy kept beside the art), and is merged in before sorting. An entry's
// optional `licenseText` is shown by the About window in an expandable block.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = join(dirname(here), '..');

const LUCIDE_DIR = join('packages', 'core', 'src', 'icons', 'default-set');

/** The Lucide version the default set was compiled from: recorded by the compile step, never restated here. */
function lucideVersion(base) {
  return JSON.parse(readFileSync(join(base, LUCIDE_DIR, 'SOURCES.json'), 'utf8')).lucideVersion;
}

/** Upstream works vendored into the source tree, which the lockfile walk cannot see. */
export const VENDORED = [
  {
    name: 'Lucide',
    version: lucideVersion(root),
    versionOf: lucideVersion,
    license: 'ISC',
    licenseUrl: 'https://spdx.org/licenses/ISC.html',
    projectUrl: 'https://lucide.dev',
    licenseTextPath: join(LUCIDE_DIR, 'LICENSE'),
  },
];

/** The vendored entries with their licence text read from disk. */
export function vendoredEntries(base = root) {
  return VENDORED.map(({ licenseTextPath, versionOf, ...entry }) => ({
    ...entry,
    version: versionOf(base),
    licenseText: readFileSync(join(base, licenseTextPath), 'utf8').replace(/\r\n?/g, '\n').trimEnd(),
  }));
}

/** Merge the npm entries with the vendored ones, sorted by name. */
export function mergeEntries(npmEntries, vendored) {
  return [...npmEntries, ...vendored].sort((a, b) => a.name.localeCompare(b.name));
}

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

/**
 * Every production package in a lockfile's install tree. Lockfile v3 keys are install paths
 * ("node_modules/foo", "node_modules/a/node_modules/b"); `dev` marks dev-only, `link` marks a workspace
 * symlink. Deduped by name@version so a package pinned once appears once. Keyed on the install path,
 * never on `resolved`, so a package installed from a URL tarball (073: SheetJS, from its own CDN) is
 * listed like a registry one. `readPackage` returns the installed package.json, or null when unreadable.
 */
export function collectNpmEntries(lock, readPackage) {
  const byId = new Map();
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    const at = path.lastIndexOf('node_modules/');
    if (at === -1 || meta.dev || meta.link) continue;
    const name = path.slice(at + 'node_modules/'.length);
    if (name.startsWith('@throng/')) continue; // our own workspace packages, not third-party
    const id = `${name}@${meta.version}`;
    if (byId.has(id)) continue;

    const pkg = readPackage(path) ?? { version: meta.version, license: meta.license };
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
  return [...byId.values()];
}

/** The installed package.json at a lockfile install path under `base`, or null. */
function readInstalled(base, path) {
  try {
    return JSON.parse(readFileSync(join(base, path, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

// Run only when invoked as a script, so a test can import the helpers above.
// Both sides are real paths: through a symlinked checkout argv[1] is the link while import.meta.url is
// the target, and comparing them as given made the script silently do nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const entries = mergeEntries(collectNpmEntries(lock, (path) => readInstalled(root, path)), vendoredEntries());

  // Written into the UI's built output so it ships as a plain file (electron-builder bundles
  // packages/*/dist/**), read by main via resolveFromHere('../third-party-licenses.json').
  const out = join(root, 'packages', 'ui', 'dist', 'third-party-licenses.json');
  writeFileSync(out, JSON.stringify(entries, null, 2) + '\n');
  console.log(`[generate-licenses] ${entries.length} third-party packages → ${out}`);
}
