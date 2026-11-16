/**
 * Keep the themes pointing at a set that is renamed or deleted (spec 069 FR-042, FR-043).
 *
 * A theme names its set by folder name (`iconPack`). Renaming the folder without the themes would leave
 * every theme that used it naming a set that is gone, so each shows the default icons and an
 * "unavailable" entry the user did not cause. A rename carries the themes with it; a delete returns them
 * to the default set by removing the key, which is what selecting the default set writes.
 *
 * Only the `iconPack` key is touched: the rest of each theme document is written back as it was read.
 */
import { logCaught, logExpected, type WriteOutcome } from '@throng/core';

export interface ThemeDocuments {
  listThemes(): Promise<string[]>;
  readRaw(doc: { kind: 'theme'; name: string }): Promise<string>;
  write(doc: { kind: 'theme'; name: string }, value: unknown): Promise<WriteOutcome>;
}

/** Point every theme naming `from` at `to`, or at the default set when `to` is undefined. Returns the themes changed. */
export async function retargetThemesIconSet(store: ThemeDocuments, from: string, to: string | undefined): Promise<string[]> {
  const changed: string[] = [];
  for (const name of await store.listThemes()) {
    let theme: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(await store.readRaw({ kind: 'theme', name }));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      theme = parsed as Record<string, unknown>;
    } catch (error) {
      logExpected('icon-set-themes: read theme', 'a hand-edited theme may not parse; it is left for the user to repair', error);
      continue;
    }
    if (theme.iconPack !== from) continue;
    const next = { ...theme };
    if (to === undefined) delete next.iconPack;
    else next.iconPack = to;
    try {
      const outcome = await store.write({ kind: 'theme', name }, next);
      if (outcome.ok) changed.push(name);
      else logExpected(`icon-set-themes: write theme ${name}`, 'the config store reports a failed write itself; the theme keeps the old name', outcome.error);
    } catch (error) {
      logCaught(`icon-set-themes: write theme ${name}`, error);
    }
  }
  return changed;
}
