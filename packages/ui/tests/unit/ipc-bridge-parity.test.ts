import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The two ends of the renderer↔main bridge name the same channels (035 FR-010 to FR-013).
 *
 * ══ WHY THIS GUARD EXISTS AT ALL ══
 *
 * 035's census read every one of the 229 E2E spec files and found that the single largest
 * justification for keeping a test at E2E was, in one form or another, "this proves the wiring is
 * live". Three of five independent assessors proposed it as a new entry in the constitution's E2E
 * reserve, and it was rejected — because the wiring decomposes into three spans and two of them
 * already have a home:
 *
 *   renderer action → bridge call          component, against a fake bridge
 *   channel agrees across preload ↔ main   ← THIS FILE. Previously nothing.
 *   main handler → real effect             contract (`config-write-patch.contract.test.ts`)
 *
 * Only the middle span had no owner, so E2E was standing in for it — one feature at a time, at
 * roughly two seconds per Electron launch. This test answers it for ALL channels in milliseconds,
 * which is the whole argument: a property of the CHANNEL is proven once, not once per feature
 * riding it.
 *
 * ══ WHY LITERALS, NOT `ipcMain.handle(` CALL SITES ══
 *
 * The first attempt at this scanned `ipcMain.handle(...)` call sites and reported 34 one-way gaps,
 * every one of them false. Channels here are routinely registered through a named constant
 * (`config-write-ipc.ts`'s `CONFIG_WRITE_PATCH_CHANNEL`), a helper map (`window-controls-ipc.ts`),
 * or a `webContents.send` in a switch (`daemon-events.ts`) — so the call site frequently holds an
 * identifier rather than a string.
 *
 * Collecting every channel LITERAL under each directory sidesteps that entirely, because a
 * constant's definition is itself a literal and it lives in the same tree. No identifier
 * resolution, no import graph, no parser.
 *
 * ══ WHY COMMENTS ARE STRIPPED FIRST ══
 *
 * Not tidiness. This codebase deliberately documents channels it has REMOVED — `config-write-ipc.ts`
 * records that `throng:config:restoreDefaultThemes` is gone, and `main.ts` records that there is
 * deliberately no `throng:panel:active` relay. Both are good comments, and without stripping, both
 * are reported as live one-way channels. A guard that punishes a codebase for explaining itself
 * gets deleted, and deserves to be.
 */
const SRC = join(process.cwd(), 'packages', 'ui', 'src');

/**
 * Channels main sends that nothing on the renderer side listens for, each with the reason it is
 * tolerated. This list fails BOTH ways: an unlisted one-way channel fails, and an entry that is no
 * longer one-way fails too, so a fixed channel cannot sit here forever pretending to be broken.
 */
const KNOWN_ONE_WAY: Record<string, string> = {
  'throng:terminal:flavourMissing':
    'Found by this guard on the day it was written. daemon-events.ts:98 forwards the daemon\'s ' +
    'flavour-missing notification to the renderer, but no preload listener exists for it, so the ' +
    'message reaches nobody. Its five siblings (output, exit, grid, cwd, command) are all wired. ' +
    'Filed as a defect; wiring a terminal feature is outside 035\'s scope, and deleting the send ' +
    'without knowing whether the notice is wanted would be the wrong half to remove.',
};

/** InversifyJS injection tokens share the `throng:` prefix. They are not channels. */
const DI_TOKEN = /^throng:[A-Z]/;

const QUOTE = String.fromCharCode(39);
const TICK = String.fromCharCode(96);
const CHANNEL = new RegExp(
  '[' + QUOTE + '"' + TICK + '](throng:[^' + QUOTE + '"' + TICK + ']*)[' + QUOTE + '"' + TICK + ']',
  'g',
);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** Block and line comments removed, so documentation of a retired channel is not read as a live one. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function channelsUnder(segment: string): Set<string> {
  const out = new Set<string>();
  for (const file of walk(SRC).filter((f) => /\.[cm]?tsx?$/.test(f))) {
    if (!file.replace(/\\/g, '/').includes(`/src/${segment}/`)) continue;
    for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(CHANNEL)) {
      const channel = m[1] as string;
      if (DI_TOKEN.test(channel)) continue;
      if (channel.includes('*')) continue; // a documented family, not a channel
      out.add(channel);
    }
  }
  return out;
}

const main = channelsUnder('main');
const preload = channelsUnder('preload');

const onlyIn = (a: Set<string>, b: Set<string>) => [...a].filter((c) => !b.has(c)).sort();

describe('IPC bridge parity', () => {
  it('finds channels on both sides at all', () => {
    // Every assertion below passes vacuously on an empty scan. If the extraction breaks — a moved
    // directory, a changed quoting style — this is the assertion that says so instead of going
    // quietly green.
    expect(main.size, 'no channels found under src/main — the scan is broken').toBeGreaterThan(50);
    expect(preload.size, 'no channels found under src/preload — the scan is broken').toBeGreaterThan(50);
  });

  it('answers without launching the application', () => {
    // FR-013. Stated as an assertion rather than a comment because it is the entire cost argument:
    // the E2E tests this guard replaces cost ~2s each in Electron launch alone.
    const started = performance.now();
    channelsUnder('main');
    expect(performance.now() - started).toBeLessThan(3000); // not-a-clock: a ceiling on a source scan, not a product SLA
  });

  it('registers a handler for every channel the bridge speaks', () => {
    // FR-010. This is the direction that breaks a feature outright: the renderer calls, and
    // nothing answers.
    const orphans = onlyIn(preload, main);
    expect(
      orphans,
      `the preload speaks these channels but src/main names none of them. A renderer call on such ` +
        `a channel hangs or rejects, and only an E2E test through a real window would notice:\n  ` +
        `${orphans.join('\n  ')}`,
    ).toEqual([]);
  });

  it('has a listener for every channel main sends', () => {
    // FR-011. This direction fails silently, which makes it the more dangerous of the two: main
    // does its work, sends, and nobody is listening.
    const unheard = onlyIn(main, preload).filter((c) => !(c in KNOWN_ONE_WAY));
    expect(
      unheard,
      `src/main names these channels but the preload never speaks them, so anything sent on them ` +
        `reaches nobody — silently. Wire it, delete it, or record it in KNOWN_ONE_WAY with the ` +
        `reason:\n  ${unheard.join('\n  ')}`,
    ).toEqual([]);
  });

  it('keeps no stale entry in the known-one-way list', () => {
    // The other direction of the ratchet: a channel that has since been wired must not keep
    // claiming to be broken, or the list becomes a place where fixed things go to be forgotten.
    const stale = Object.keys(KNOWN_ONE_WAY)
      .filter((c) => !main.has(c) || preload.has(c))
      .sort();
    expect(
      stale,
      `these are recorded as one-way but are not: either both sides now name them (fixed — remove ` +
        `the entry) or main no longer names them at all (deleted — remove the entry):\n  ` +
        `${stale.join('\n  ')}`,
    ).toEqual([]);
  });
});
