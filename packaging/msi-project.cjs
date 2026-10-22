// electron-builder `msiProjectCreated` hook (058 research D1; electron-builder.yml, top level).
//
// electron-builder writes the WiX project for the MSI from its own template and then calls this with
// the path to it, BEFORE anything is compiled. We rewrite it in place. The rewrite itself is a pure
// text transform in `@throng/core` (`packages/core/src/config/msi-project.ts`), where it is unit
// tested against a captured copy of the template's output; this file only moves text between the
// disk and that function.
//
// CommonJS because electron-builder `require()`s a hook module by path, and `@throng/core` is ESM,
// hence the dynamic import. Core must be built first — `npm run package` builds before it packages.
// A transform that cannot find its anchor throws, and electron-builder reports that as a failed
// package: an upgrade that reshapes the template stops the build rather than shipping an MSI with a
// transform silently skipped.
// electron-builder loads a hook by `require()`, so this file is CommonJS by necessity.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readFile, writeFile } = require('node:fs/promises');

/**
 * @param {string} wxsPath the project file electron-builder generated.
 * @returns {Promise<void>}
 */
async function msiProjectCreated(wxsPath) {
  const { transformMsiProject } = await import('@throng/core');
  const original = await readFile(wxsPath, 'utf8');
  await writeFile(wxsPath, transformMsiProject(original), 'utf8');
}

module.exports = msiProjectCreated;
