/**
 * Whether the module at `metaUrl` is the script Node was asked to run, so a script a test imports runs its body only
 * when executed: `if (isMain(import.meta.url)) main();`.
 *
 * Both sides are real paths: through a symlinked checkout `process.argv[1]` is the link while `import.meta.url` is the
 * target, and comparing them as given made the script silently do nothing.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function isMain(metaUrl, entry = process.argv[1]) {
  if (!entry) return false;
  let real;
  try {
    real = realpathSync(entry);
  } catch {
    return false;
  }
  return metaUrl === pathToFileURL(real).href;
}
