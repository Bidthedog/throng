// SHA-256 checksum generation for published artifacts (020 FR-042/042a).
//
// A published checksum lets a downloader confirm the file arrived intact against the value we
// published. It MUST be computed from the EXACT bytes that are published, as the last step that
// reads them (FR-042a), so the checksum and the artifact can never disagree.
//
// CLI: `node scripts/checksum.mjs <file>` prints "<sha256>  <basename>" (the format that goes in
// the release notes). Importable: `sha256OfFile(path)` and the pure `sha256Hex(data)`.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

/** SHA-256 hex of a byte buffer/string. Pure (no I/O) — the hashing primitive. */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** SHA-256 hex of a file's exact bytes. The last step that reads the artifact (FR-042a). */
export async function sha256OfFile(path) {
  return sha256Hex(await readFile(path));
}

// Run as a CLI when invoked directly.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/checksum.mjs <file>');
    process.exit(2);
  }
  sha256OfFile(file)
    .then((hex) => {
      console.log(`${hex}  ${basename(file)}`);
    })
    .catch((err) => {
      console.error(`[checksum] ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
}
