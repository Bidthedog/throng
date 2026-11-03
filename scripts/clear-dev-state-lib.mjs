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
