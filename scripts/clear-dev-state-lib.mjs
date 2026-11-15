// Which processes are a checkout's dev instance (spec 062 T035). Separate from the script so the rule can be tested
// without ending anything. Only the app, its daemon and its helpers count: an editor or a shell whose command line merely
// names the repository is someone's work, and so is a test runner or a sibling worktree's app.
const DEV_ENTRY = /^(?:node_modules\/electron\/|packages\/(?:ui|daemon)\/dist\/)/;

/**
 * @param {readonly string[]} args the process's argv
 * @param {string} root the checkout, absolute, with no trailing separator
 */
export function isDevProcess(args, root) {
  const program = (args[0] ?? '').split('/').pop();
  if (program !== 'electron' && program !== 'node') return false;
  return args.some((arg) => arg.startsWith(`${root}/`) && DEV_ENTRY.test(arg.slice(root.length + 1)));
}

/**
 * The same rule on macOS (070 FR-047), where `ps` gives the executable's full path and the command line as one string
 * whose arguments may themselves hold spaces. The program is the executable's file name, in any case: a checkout's
 * Electron is `…/Electron.app/Contents/MacOS/Electron`. A path counts only where an argument starts, so a path that
 * merely ends with the checkout's (`/elsewhere/repo/…` for `/repo`) is not this checkout's.
 *
 * @param {string} comm the executable's path, as `ps -o comm=` prints it
 * @param {string} commandLine the command line, as `ps -o args=` prints it
 * @param {string} root the checkout, absolute, with no trailing separator
 */
export function isDarwinDevProcess(comm, commandLine, root) {
  const program = comm.split('/').pop()?.toLowerCase();
  if (program !== 'electron' && program !== 'node') return false;
  const at = `${root}/`;
  for (let i = commandLine.indexOf(at); i !== -1; i = commandLine.indexOf(at, i + 1)) {
    if ((i === 0 || /\s/.test(commandLine[i - 1])) && DEV_ENTRY.test(commandLine.slice(i + at.length))) return true;
  }
  return false;
}

/**
 * The dev instance's folders on macOS (070 research R5): data and settings under Application Support, logs under
 * Logs. Each is a dev folder (`throng-dev`), never the installed copy's (`throng`).
 *
 * @param {string} home the account's home folder
 */
export function darwinDevFolders(home) {
  return [`${home}/Library/Application Support/throng-dev`, `${home}/Library/Logs/throng-dev`];
}
