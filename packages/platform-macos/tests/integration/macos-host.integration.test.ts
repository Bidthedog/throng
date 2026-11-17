/**
 * Layer: integration — whether a mounted volume is case-sensitive is the kernel's answer through `pathconf(2)`; no fake
 * can show that the koffi binding and the `/Volumes` listing find a real case-sensitive APFS volume (070 R4).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { samePath } from '@throng/core';
import { skipUnlessMacos, withHostTraits } from '@throng/core/testing';
import { findCaseSensitiveRoots, macosTraitsForThisProcess, mountedVolumes } from '../../src/macos-host.js';

const VOLUME = `ThrongCS${process.pid}`;
const MOUNT = `/Volumes/${VOLUME}`;

describe.skipIf(skipUnlessMacos('pathconf(_PC_CASE_SENSITIVE) and hdiutil exist only on macOS'))(
  'case-sensitive volumes on a real Mac (070 FR-020)',
  () => {
    let scratch = '';

    beforeAll(() => {
      scratch = mkdtempSync(join(tmpdir(), 'throng-cs-'));
      const image = join(scratch, 'cs.dmg');
      execFileSync('hdiutil', ['create', '-size', '32m', '-fs', 'Case-sensitive APFS', '-volname', VOLUME, image]);
      execFileSync('hdiutil', ['attach', image, '-nobrowse']);
    }, 60_000);

    afterAll(async () => {
      try {
        // A fresh volume is briefly held by the system's own indexers, so a detach straight after the tests can answer
        // "Resource busy" (hosted macOS, 1.0.0-alpha17's CI). Try again for a few seconds; the last refusal still fails.
        // A forced detach can also finish after reporting busy, and a second one then finds nothing to detach ("No
        // such file or directory"), so the volume being gone is the success the loop waits for.
        for (let attempt = 1; existsSync(MOUNT); attempt += 1) {
          try {
            execFileSync('hdiutil', ['detach', MOUNT, '-force'], { stdio: 'pipe' });
            break;
          } catch (error) {
            if (!existsSync(MOUNT)) break;
            if (attempt >= 10) throw error;
            // sleep-justified: the holder is outside this process and announces nothing; half a second between tries.
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    }, 60_000);

    it('lists the mounted image as a volume, and the boot volume is not case-sensitive by default', () => {
      expect(mountedVolumes()).toContain(MOUNT);
      const roots = findCaseSensitiveRoots();
      expect(roots).toContain(MOUNT);
      expect(roots).not.toContain('/');
    });

    it('compares paths on it case-sensitively and elsewhere case-insensitively', () => {
      const traits = macosTraitsForThisProcess();
      withHostTraits(traits, () => {
        expect(samePath(`${MOUNT}/README.md`, `${MOUNT}/readme.md`)).toBe(false);
        expect(samePath('/Users/x/README.md', '/Users/x/readme.md')).toBe(true);
      });
    });
  },
);
