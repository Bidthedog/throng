import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 018 / SC-009 — EXACTLY TWO notice models exist in the codebase.
 *
 * The specification named five idioms. There were NINE, and the four it missed were not obscure:
 * three n-way decision modals (application close, dirty close, unsaved open), a modal message box
 * for editor notices, and a fifth dismissable error strip on the themes surface. Building only the
 * five named surfaces would have left four behind and made this criterion FALSE ON THE DAY IT
 * SHIPPED.
 *
 * Which is exactly why counting them by hand is not good enough, and why this guard walks the tree.
 */

const RENDERER = fileURLToPath(new URL('../../src/renderer', import.meta.url));

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, match));
    else if (match.test(entry)) out.push(path);
  }
  return out;
}

const sources = (): { rel: string; src: string }[] =>
  walk(RENDERER, /\.tsx?$/).map((f) => ({
    rel: f.slice(RENDERER.length + 1).replace(/\\/g, '/'),
    src: readFileSync(f, 'utf8'),
  }));

describe('SC-009 — the nine idioms are gone', () => {
  it('the superseded components no longer exist', () => {
    // Deleting them is the point. A migration that leaves the old surface in the tree is a migration
    // the next feature will quietly pick from.
    for (const gone of [
      'preferences/confirm-dialog.tsx', // the RIVAL confirmation, born because the provider was unmounted
      'workspace/restore-notice.tsx', // the non-dismissable notice
      'common/dismiss-button.tsx', // the wrapper the four copy-pasted strips shared
    ]) {
      expect(existsSync(join(RENDERER, gone)), `${gone} must be deleted`).toBe(false);
    }
  });

  it('no bespoke notice or confirm markup survives outside the two models', () => {
    // The class names each idiom used. Their presence anywhere is a tenth idiom being born.
    const banned = [
      'prefs-confirm', // the inline confirm strip
      'prefs-notice', // the inline notice strip
      'panel__error', // projects
      'explorer__error', // explorer
      'subworkspaces-panel__error', // sub-workspaces
      'panel-type-form__exit', // terminal exit
      'themes-notice', // the FIFTH error strip, which the specification missed
      'restore-notice', // the non-dismissable one
    ];

    const offenders: string[] = [];
    for (const { rel, src } of sources()) {
      for (const cls of banned) {
        if (src.includes(`className="${cls}`) || src.includes(`className={\`${cls}`)) {
          offenders.push(`${rel}: ${cls}`);
        }
      }
    }
    expect(
      offenders,
      `these render a bespoke notice surface instead of using the shared model:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('every confirmation goes through the ONE model', () => {
    // A component rendering `.modal` with decision buttons of its own is a second confirmation
    // implementation, whatever it is called. Only the model itself may.
    const offenders: string[] = [];
    for (const { rel, src } of sources()) {
      if (rel === 'confirm-dialog.tsx') continue; // THE model
      if (rel === 'app-close-prompt.tsx') continue; // the BUSY overlay: not a notice, it blocks and waits
      if (rel === 'preferences/capture-modal.tsx' || rel === 'preferences/name-dialog.tsx') continue; // input dialogs, not notices
      // The project settings dialog (US8) is an EDITING surface, not a confirmation: its footer holds a
      // single Close, and closing a dialog is not consenting to a consequence. The line this guard is
      // drawing is "nothing else asks the user to DECIDE" — an editor with a dismiss control does not.
      // (Its own destructive-ish action, un-hiding a path, is a per-row icon and is trivially undone by
      // hiding it again, so it asks nothing.)
      if (rel === 'project-settings/project-settings-dialog.tsx') continue;
      if (/className="modal__buttons"/.test(src)) offenders.push(rel);
    }
    expect(
      offenders,
      `these build their own decision buttons instead of using the confirmation model:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
