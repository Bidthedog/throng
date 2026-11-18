/**
 * Whether the module at `metaUrl` is the script Node was asked to run, so a script a test imports runs its body only
 * when executed: `if (isMain(import.meta.url)) main();`.
 *
 * Both sides are real paths: through a symlinked checkout `process.argv[1]` is the link while `import.meta.url` is the
 * target, and comparing them as given made the script silently do nothing. The module's own path is resolved too, so a
 * path under a symlinked folder compares equal however it was spelled (macOS's /var is /private/var).
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMain(metaUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(entry);
  } catch {
    return false;
  }
}
