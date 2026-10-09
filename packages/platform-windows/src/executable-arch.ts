import { open } from 'node:fs/promises';

/**
 * 053 `{arch}` — the architecture of an executable, read from its PE header rather than from the
 * running process.
 *
 * The header is on disk and never changes for a path while it runs, so one read of the first few KB
 * answers for the host's life. The DOS header's `e_lfanew` (u32 at 0x3C) points at the `PE\0\0`
 * signature; the COFF machine field (u16) follows it.
 */

/** Enough for any real image: `e_lfanew` is a few hundred bytes in for every linker in use. */
const HEAD_BYTES = 4096;

const MACHINES: ReadonlyMap<number, string> = new Map([
  [0x8664, 'x64'],
  [0x014c, 'x86'],
  [0xaa64, 'arm64'],
]);

/** The architecture a PE image's head declares, or `null` when it is not one or not recognised. */
export function archFromHeader(head: Buffer): string | null {
  if (head.length < 0x40 || head[0] !== 0x4d || head[1] !== 0x5a) return null; // 'MZ'
  const peOffset = head.readUInt32LE(0x3c);
  if (peOffset + 6 > head.length) return null;
  if (head.toString('latin1', peOffset, peOffset + 4) !== 'PE\0\0') return null;
  return MACHINES.get(head.readUInt16LE(peOffset + 4)) ?? null;
}

/** The first {@link HEAD_BYTES} of `path`. Rejects when the file cannot be opened or read. */
export async function readExecutableHead(path: string): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await file.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

/**
 * A per-host `executableArch`: async, cached by path (in-flight reads shared), and never rejecting —
 * an unreadable or unrecognised file is `null`.
 */
export function createExecutableArchReader(
  readHead: (path: string) => Promise<Buffer> = readExecutableHead,
): (path: string) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>();
  return (path) => {
    if (!path) return Promise.resolve(null);
    let result = cache.get(path);
    if (!result) {
      result = readHead(path).then(archFromHeader, () => null);
      cache.set(path, result);
    }
    return result;
  };
}
