/**
 * The repository route's upgrade step (064 FR-013) upgrades throng and nothing else.
 *
 * `apt-get upgrade -y` upgraded every package on the runner. On 2026-11-16 that included Firefox, whose
 * deb-to-snap transition could not reach the Snap Store, waited 30 minutes and exited 100: the deb
 * repository check failed release.yml on master for a package throng does not ship. dnf already named
 * the package; apt now does the same.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const script = readFileSync(join(repoRoot, 'scripts', 'verify-package-repo.mjs'), 'utf8');
const upgrades = [...script.matchAll(/^\s*upgrade:\s*\(\)\s*=>\s*sh\(([^)]*)\)/gm)].map((m) => m[1]!);

describe('verify-package-repo upgrade step', () => {
  it('has one upgrade command per package manager', () => {
    expect(upgrades).toHaveLength(2);
  });

  it.each(upgrades.map((args) => [args]))('names throng and only throng: %s', (args) => {
    expect(args).toMatch(/'throng'/);
  });

  it('upgrades throng with apt without installing it where it is absent', () => {
    const apt = upgrades.find((args) => args.startsWith("'apt-get'"));
    expect(apt).toMatch(/'install'.*'--only-upgrade'/);
  });
});
