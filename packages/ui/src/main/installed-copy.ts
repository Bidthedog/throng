import { readdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';

/** Whether this copy was put here by an installer or a package, rather than unpacked from an archive (067 FR-036). */
export function isInstalledCopy(
  execPath: string,
  platform: string,
  packaged: boolean,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (!packaged || env.PORTABLE_EXECUTABLE_FILE) return false;
  if (platform === 'linux') return execPath.includes('/opt/throng-versions/');
  const folder = dirname(execPath);
  return basename(folder) === 'throng MSI' || readdirSync(folder).some((name) => /^Uninstall .*\.exe$/i.test(name));
}
