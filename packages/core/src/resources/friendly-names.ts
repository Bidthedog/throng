/** Image names (lower case, no `.exe`) to what the user calls them (FR-023). */
const BY_IMAGE: Readonly<Record<string, string>> = {
  bash: 'Bash',
  sh: 'Bash',
  pwsh: 'PowerShell',
  powershell: 'Windows PowerShell',
  cmd: 'Command Prompt',
  node: 'Node',
  claude: 'Claude Code',
  git: 'Git',
  conhost: 'Console host',
  openconsole: 'Console host',
};

/** A Node process running Claude Code's CLI is Claude Code, not "Node". */
const CLAUDE_CODE = /[\\/]claude-code[\\/]|[\\/]@anthropic-ai[\\/]claude/i;

/**
 * The name a process is shown by: a recognised program's friendly name, else its image name. The
 * image name and full command line stay on the node regardless.
 */
export function friendlyName(imageName: string, commandLine?: string): string {
  const stem = imageName.toLowerCase().replace(/\.exe$/, '');
  if (stem === 'node' && commandLine !== undefined && CLAUDE_CODE.test(commandLine)) return 'Claude Code';
  if (/^python(\d+(\.\d+)*)?w?$/.test(stem)) return 'Python';
  return BY_IMAGE[stem] ?? imageName;
}
