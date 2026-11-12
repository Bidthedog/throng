import type { FileListSnapshot, IFileListCodec } from '../abstractions/clipboard.js';

/**
 * The one suite both OS codecs must pass (067 FR-001, Principle II). `paths` are absolute in the codec's own OS
 * spelling and include a space and non-ASCII. REJECTS on a violation, like the other clipboard contracts.
 */
export async function runFileListCodecContract(
  name: string,
  codec: IFileListCodec,
  paths: readonly [string, string, ...string[]],
): Promise<void> {
  const fail = (why: string): never => {
    throw new Error(`${name} violates the file-list codec contract: ${why}`);
  };
  const round = (list: FileListSnapshot): FileListSnapshot | null => codec.decode(asBytes(codec.encode(list)));

  for (const intent of ['copy', 'cut'] as const) {
    const single = round({ paths: [paths[0]], intent });
    if (single === null || single.intent !== intent || single.paths[0] !== paths[0] || single.paths.length !== 1) {
      fail(`one ${intent} item did not round-trip: ${JSON.stringify(single)}`);
    }
    const all = round({ paths: [...paths], intent });
    if (all === null || all.intent !== intent || JSON.stringify(all.paths) !== JSON.stringify(paths)) {
      fail(`several ${intent} items did not round-trip: ${JSON.stringify(all)}`);
    }
  }
  if (codec.decode({}) !== null) fail('an empty clipboard did not decode to null');
  for (const format of Object.keys(codec.encode({ paths: [paths[0]], intent: 'copy' }))) {
    if (!codec.formats.includes(format)) fail(`encode wrote ${format}, which formats does not list`);
  }
}

function asBytes(encoded: Readonly<Record<string, string | Uint8Array>>): Record<string, Uint8Array> {
  const encoder = new TextEncoder();
  return Object.fromEntries(
    Object.entries(encoded).map(([format, value]) => [format, typeof value === 'string' ? encoder.encode(value) : value]),
  );
}
