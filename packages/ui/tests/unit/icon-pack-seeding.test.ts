/**
 * What `IconPackService` PUTS on disk before anything reads it (007 Phase F, FR-040a).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/icon-packs.e2e.ts` (034 FR-045):
 * "the pack-format README is seeded under icon-packs/".
 *
 * ══ WHY IT COMES DOWN ══
 *
 * That test launched Electron against a seeded config root, opened the Preferences window through
 * the cog menu, waited for the Themes tab, and then asserted one thing:
 * `existsSync(join(cfgRoot, 'icon-packs', 'README.md'))`. The window was not the subject and was not
 * even the mechanism — `ensureReadme()` runs on the main-process startup path (`main.ts`), long
 * before any preferences window exists, so opening one was a way of waiting rather than a way of
 * testing. The README is a file that a method with a directory argument writes.
 *
 * The claim has TWO halves, and FR-047 says a replacement has to carry both:
 *
 *   1. `ensureReadme()` writes the README — asserted below by calling it, and then further than the
 *      E2E went: that it is not empty, that it documents the manifest the loader actually parses, and
 *      that a SECOND call never overwrites a user's edit. The E2E could not see idempotence at all,
 *      because a fresh temp config root is by definition a first run.
 *   2. Startup CALLS it, into the config root's own `icon-packs/`. No unit that constructs its own
 *      service can see that, so it is a source guard over `main.ts` — the same shape as
 *      `packages/ui/tests/unit/icon-call-sites.test.ts`, and for the same reason: what is asserted is
 *      the absence or presence of a call in another module, which no rendered DOM and no temp
 *      directory can report.
 *
 * WHAT STAYS END-TO-END in `icon-packs.e2e.ts`: that a fresh install's bundled packs are SELECTABLE
 * and draw at the theme's 24px (FR-049 — a real measured box), that a selected pack re-skins the main
 * window live with no restart, that pack art takes the theme's colour rather than rendering black,
 * and that a broken pack degrades without stopping the app. The seeding assertions inside those are
 * incidental to claims that need the running product.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Make `ensureReadme()` a no-op (`async ensureReadme(): Promise<void> { return; }` in
 * `packages/ui/src/main/icon-pack-service.ts`). THE THREE BEHAVIOURAL TESTS must fail.
 *
 * Stated honestly rather than rounded up to "all of them": the other two are deliberately
 * independent of the method, and saying so is the point. The first test asserts a PRECONDITION about
 * the fixture — that the temp root does not already carry a README — and a production change cannot
 * redden it, which is exactly what makes it a useful guard against the other three passing for free.
 * The last is a source guard over `main.ts` and reddens when the CALL is removed there. Each has its
 * own named mutation in `red-term-icons.mjs`.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IconPackService } from '../../src/main/icon-pack-service.js';

let packsDir: string;
let cfgRoot: string;

beforeEach(() => {
  cfgRoot = mkdtempSync(join(tmpdir(), 'throng-seed-icons-'));
  packsDir = join(cfgRoot, 'icon-packs');
});
afterEach(() => {
  rmSync(cfgRoot, { recursive: true, force: true });
});

const readmePath = (): string => join(packsDir, 'README.md');

describe('the pack-format README is seeded under icon-packs/ (FR-040a)', () => {
  it('is NOT there before anything runs — the precondition the E2E never stated', () => {
    /*
     * Load-bearing, not ceremony. Every assertion below is "the file exists", and a temp directory
     * that somehow already carried one would satisfy all of them without `ensureReadme` doing
     * anything at all. The E2E ran against a config root the app had already touched, so it had no
     * way to say this.
     */
    expect(existsSync(readmePath())).toBe(false);
  });

  it('creates icon-packs/ and writes the README into it', async () => {
    // The directory does not exist yet either — `ensureReadme` has to make it, which is the case a
    // truly empty config root actually presents on first run.
    await new IconPackService(packsDir).ensureReadme();
    expect(existsSync(readmePath())).toBe(true);
    expect(readFileSync(readmePath(), 'utf8').length).toBeGreaterThan(0);
  });

  it('documents the manifest the loader actually parses', async () => {
    /*
     * The E2E asserted the file EXISTS. A README that exists and says nothing useful is the failure
     * mode this requirement is about: FR-040a's purpose is that a user can author a pack by example.
     * `pack.json` and `tokens` are the two names `listIconPacks` reads, and `.svg` is the only asset
     * kind `loadAsset` accepts — a README that omitted that would send users to make PNG packs that
     * silently degrade.
     */
    await new IconPackService(packsDir).ensureReadme();
    const text = readFileSync(readmePath(), 'utf8');
    expect(text).toContain('pack.json');
    expect(text).toContain('tokens');
    expect(text).toContain('.svg');
  });

  it('NEVER overwrites a README the user has edited', async () => {
    /*
     * Invisible to the E2E by construction — a fresh temp config root is always a first run, so the
     * second-call branch was never taken in any automated run. Users are invited to keep notes in
     * this folder; a startup that rewrote them every launch would be a data loss on every launch.
     */
    mkdirSync(packsDir, { recursive: true });
    writeFileSync(readmePath(), 'MY OWN NOTES\n', 'utf8');

    await new IconPackService(packsDir).ensureReadme();

    expect(readFileSync(readmePath(), 'utf8')).toBe('MY OWN NOTES\n');
  });
});

describe('startup calls it, against the config root’s own icon-packs/', () => {
  it('main.ts constructs the service under configRoot and seeds before serving packs', () => {
    /*
     * The half a temp directory cannot see. `ensureReadme` writing a file is worth nothing if nobody
     * calls it, and the E2E's only real contribution was proving that it is called on the startup
     * path — so that contribution is kept here rather than dropped.
     *
     * CRLF: this repo's checkouts are CRLF, so every pattern is `\r?\n`-safe by never spanning a
     * line. Matching within single lines is deliberate.
     */
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, '..', '..', 'src', 'main', 'main.ts'), 'utf8');

    /*
     * COMMENTS ARE STRIPPED FIRST, and that is the whole difference between this test working and
     * not. Reading raw source, `// await iconPackService.ensureReadme();` still CONTAINS the string
     * the assertion below looks for — so commenting the call out, which is exactly how a startup
     * step gets disabled in practice, left this test green. Verified: the `call-site-drop` mutation
     * reddened nothing here before this line existed.
     *
     * A source scan asserts that code is present. Text is not code, and a scan that cannot tell them
     * apart is asserting nothing. `//` is honoured only when not preceded by `:`, so a URL in a
     * string does not truncate the line after it.
     */
    const main = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect(
      main,
      'main.ts no longer points IconPackService at the config root’s icon-packs directory',
    ).toMatch(/new IconPackService\(\s*join\(\s*configSettings\.configRoot\s*,\s*'icon-packs'\s*\)/);
    expect(main, 'startup no longer seeds the pack-format README').toMatch(
      /iconPackService\.ensureReadme\(\)/,
    );
    expect(main, 'startup no longer seeds the bundled packs').toMatch(
      /iconPackService\.ensureBundledPacks\(\)/,
    );
  });
});
