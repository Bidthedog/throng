// What makes a node binary unfit to be the bundled runtime on macOS (070 FR-004, FR-043, research R23). Separate from
// stage-runtime.mjs so the decision can be tested on any machine, from `otool -L` text.
//
// The runtime ships inside the app and runs on Macs that have nothing else installed, so it must load nothing from
// outside the operating system: Homebrew's node, for one, links Homebrew's own libuv, OpenSSL and ICU from
// /opt/homebrew, and would start on the build machine and nowhere else. setup-node's official build links only the
// system's libraries. And it must be Apple silicon: no Intel copy is made (FR-003).

/** Where macOS keeps the libraries every Mac has. Anything else is something this Mac happens to have installed. */
const SYSTEM_LIBRARY = /^(?:\/usr\/lib\/|\/System\/Library\/)/;

/**
 * The libraries an `otool -L <file>` listing names, without the file's own heading line.
 *
 * @param {string} otoolText `otool -L` output: the file, then one indented `path (compatibility …)` line per library
 */
export function linkedLibraries(otoolText) {
  return otoolText
    .split('\n')
    .slice(1)
    .map((line) => /^\s+(\S.*?)\s+\(compatibility version/.exec(line)?.[1] ?? /^\s+(\S+)\s*$/.exec(line)?.[1])
    .filter((path) => path !== undefined);
}

/**
 * Why this node cannot be the macOS runtime, or `null` when it can.
 *
 * @param {{source: string, arch: string, otoolText: string}} m the binary, `process.arch`, and `otool -L <source>`
 */
export function darwinRuntimeProblem({ source, arch, otoolText }) {
  if (arch !== 'arm64') {
    return `refusing to stage ${source}: it is ${arch}, and throng ships for Apple silicon only. Build on an Apple silicon Mac.`;
  }
  const libraries = linkedLibraries(otoolText);
  if (libraries.length === 0) return `refusing to stage ${source}: otool -L listed no libraries, so its links cannot be checked.`;
  const foreign = libraries.filter((path) => !SYSTEM_LIBRARY.test(path));
  if (foreign.length > 0) {
    return (
      `refusing to stage ${source}: it is not a self-contained node, it loads ${foreign.join(', ')}. ` +
      'Use an official build, such as the one actions/setup-node or nvm installs.'
    );
  }
  return null;
}
