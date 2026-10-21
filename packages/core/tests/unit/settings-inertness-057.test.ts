import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 057 T049 — every setting this spec adds has a descriptor and a production reader (Principle X, FR-061).
 *
 * `settings-inertness-054.test.ts` is the pattern, and its header explains why a bare mention is not a
 * read. The config layer (`packages/core/src/config`) is excluded, since it only declares, parses and
 * clones the values: a read is code OUTSIDE it that makes a decision from one.
 *
 * The seven signal toggles are read two ways at once. The daemon gates every signal it emits on
 * `signals[<name>]` — a computed read, so no source spells `signals.bell` — which means the proof for a
 * toggle is that some attention code names the signal AND that the gate exists. The master switch and the
 * quiet time are read by name.
 *
 * Layer: unit — a source scan, no app.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const CONFIG_LAYER = ['packages', 'core', 'src', 'config'].join(sep);

const ATTENTION_FILE = /attention/i;

const SIGNALS = [
  'processExited',
  'commandFinished',
  'bell',
  'notification',
  'progressEnded',
  'unseenOutput',
  'outputQuiet',
] as const;

interface Reader {
  key: string;
  governs: string;
  /** True when the (attention-related) source reads the setting. */
  read: (text: string) => boolean;
  /** The reader is applied to every attention source joined, not to each file alone. */
  acrossFiles?: boolean;
}

const NEW_KEYS: readonly Reader[] = [
  {
    key: 'attention.clearDelayMs',
    governs: 'how long a marked panel must be in view before its mark clears (FR-006)',
    read: (t) => /\.attention\.clearDelayMs\b/.test(t),
  },
  // FR-109 / FR-110 / FR-111: read where a notice or a mark decides whether to reach the OS or show a card.
  {
    key: 'notifications.os',
    governs: 'whether anything reaches the OS (FR-109)',
    acrossFiles: true,
    read: (t) => /\bnotifications\.os\b/.test(t),
  },
  ...(['error', 'warning', 'info', 'success'] as const).map((type) => ({
    key: `notifications.${type}.os`,
    governs: `whether a ${type} notice also reaches the OS (FR-110)`,
    acrossFiles: true,
    read: (t: string) => /\bnotifications\[severity\]\.os\b/.test(t),
  })),
  {
    key: 'notifications.attention.os',
    governs: 'whether a mark also reaches the OS (FR-111)',
    read: (t) => /\bnotifications\.attention\.os\b/.test(t),
  },
  {
    key: 'notifications.attention.mode',
    governs: 'whether a mark\'s toast is shown, and until when (FR-111)',
    read: (t) => /\.notifications\.attention\b/.test(t) && /\.mode\b/.test(t),
  },
  {
    key: 'notifications.attention.timeoutMs',
    governs: 'how long a timed toast for a mark stays (FR-111)',
    read: (t) => /\.notifications\.attention\b/.test(t) && /\.timeoutMs\b/.test(t),
  },
  {
    key: 'attention.taskbarBadge',
    governs: 'whether the taskbar badge is drawn (FR-039)',
    read: (t) => /\.attention\.taskbarBadge\b/.test(t),
  },
  {
    key: 'terminals.attention.enabled',
    governs: 'whether any terminal raises a mark (FR-063)',
    read: (t) => /\.enabled\b/.test(t) && /\bsignals\b/.test(t),
  },
  ...SIGNALS.map((name) => ({
    key: `terminals.attention.signals.${name}`,
    governs: `whether a ${name} event raises a mark (FR-061)`,
    // Named by the code that emits it, and gated by a computed `signals[…]` read. The two can sit in
    // different files — the daemon raises exits and command changes from `terminal-service.ts` through a
    // gate in `terminal-attention.ts` — so this reader is given every attention source at once.
    acrossFiles: true,
    read: (t: string) => new RegExp(`'${name}'`).test(t) && /\bsignals\[|\bsignals\.${name}\b/.test(t),
  })),
  {
    key: 'terminals.attention.quietSeconds',
    governs: 'how long a terminal is silent before Output went quiet fires (FR-061)',
    read: (t) => /\.quietSeconds\b/.test(t),
  },
];

function productionSources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (p.includes(CONFIG_LAYER)) continue;
      if (statSync(p).isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'dist') walk(p);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        out.push({ file: p, text: readFileSync(p, 'utf8') });
      }
    }
  };
  for (const pkg of readdirSync(join(REPO_ROOT, 'packages'))) {
    const src = join(REPO_ROOT, 'packages', pkg, 'src');
    try {
      if (!statSync(src).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(src);
  }
  return out;
}

describe('057 adds no inert setting (T049)', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it('covers all nineteen keys', () => {
    expect(NEW_KEYS).toHaveLength(19);
  });

  it('describes every new key', () => {
    for (const { key } of NEW_KEYS) expect(declared, `${key} has no descriptor`).toContain(key);
  });

  it('has production code reading every one of them', () => {
    const sources = productionSources().filter(({ file, text }) => ATTENTION_FILE.test(file) || ATTENTION_FILE.test(text));
    const all = sources.map(({ text }) => text).join('\n');
    const inert = NEW_KEYS.filter(({ read, acrossFiles }) =>
      acrossFiles ? !read(all) : !sources.some(({ text }) => read(text)),
    ).map(
      ({ key, governs }) => `${key} (should govern ${governs})`,
    );
    expect(inert, `Rendered as live controls but read by nothing: ${inert.join('; ')}`).toEqual([]);
  });
});
