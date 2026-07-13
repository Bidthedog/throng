import { readFileSync, statSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { APP_ICON_ICO, APP_ICON_PNG } from '../../src/main/app-icon.js';

/**
 * The bundled application icon (#72). The `.ico` is a MULTI-SIZE container built
 * from BOTH source SVGs — the simplified `icon_small.svg` at <=32px and the full
 * `icon_large.svg` at >=48px — so Windows picks art drawn for the size it is
 * about to render, rather than downscaling the detailed mark into mush.
 *
 * These assert the SHIPPED artefact, because it is committed (not generated at
 * build time): if `scripts/build-app-icons.mjs` is re-run and produces something
 * Windows/Electron cannot decode, the failure must surface here and not in a
 * blank taskbar slot.
 */

/** Parse an ICO container into its directory entries (see build-app-icons.mjs). */
function readIcoEntries(path: string): { width: number; height: number; bytes: number }[] {
  const buf = readFileSync(path);
  expect(buf.readUInt16LE(0)).toBe(0); // reserved
  expect(buf.readUInt16LE(2)).toBe(1); // type 1 = icon
  const count = buf.readUInt16LE(4);
  return Array.from({ length: count }, (_unused, i) => {
    const at = 6 + i * 16;
    return {
      // A 0 byte means 256 in the ICO directory — the format has no other way to say it.
      width: buf.readUInt8(at) === 0 ? 256 : buf.readUInt8(at),
      height: buf.readUInt8(at + 1) === 0 ? 256 : buf.readUInt8(at + 1),
      bytes: buf.readUInt32LE(at + 8),
    };
  });
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('bundled application icon', () => {
  it('resolves to files that exist alongside the built main process', () => {
    // Resolved from `import.meta.url`, which sits at src/main in a vitest run and
    // dist/main in a packaged/electron run — both two levels below packages/ui,
    // so the same relative path holds in each and needs no build-time copy step.
    expect(statSync(APP_ICON_ICO).isFile()).toBe(true);
    expect(statSync(APP_ICON_PNG).isFile()).toBe(true);
  });

  it('is a valid multi-size ICO carrying every size Windows asks for', () => {
    const entries = readIcoEntries(APP_ICON_ICO);
    const sizes = entries.map((e) => e.width).sort((a, b) => a - b);
    expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256]);
    // Square, and every entry's payload is actually present.
    for (const entry of entries) {
      expect(entry.height).toBe(entry.width);
      expect(entry.bytes).toBeGreaterThan(0);
    }
  });

  it('embeds each size as a PNG payload, at the offset the directory advertises', () => {
    const buf = readFileSync(APP_ICON_ICO);
    const count = buf.readUInt16LE(4);
    for (let i = 0; i < count; i += 1) {
      const at = 6 + i * 16;
      const bytes = buf.readUInt32LE(at + 8);
      const offset = buf.readUInt32LE(at + 12);
      expect(offset + bytes).toBeLessThanOrEqual(buf.length);
      expect(buf.subarray(offset, offset + 8)).toEqual(PNG_MAGIC);
    }
  });

  it('ships a 256px PNG for the platforms that cannot read an ICO', () => {
    const buf = readFileSync(APP_ICON_PNG);
    expect(buf.subarray(0, 8)).toEqual(PNG_MAGIC);
    // PNG IHDR: width/height are big-endian uint32 at byte 16 and 20.
    expect(buf.readUInt32BE(16)).toBe(256);
    expect(buf.readUInt32BE(20)).toBe(256);
  });
});
