import { describe, it, expect } from 'vitest';
import { panelDisplayTitle, type Panel } from '../../src/index.js';

/**
 * #218 — which name a panel wears, as one rule in one place.
 *
 * The precedence was spread across a JSX expression in `panel-placeholder.tsx`, which meant it could
 * only be asserted by launching the whole application. It is a pure decision over a panel plus two
 * live values, so it is tested here — and the E2E specs are then free to prove the wiring rather than
 * re-derive the rule four times.
 */
const panel = (over: Partial<Panel> = {}): Panel => ({
  type: 'panel',
  id: 'p1',
  originProjectId: 'proj',
  title: 'Panel 3',
  ...over,
});

describe('panelDisplayTitle', () => {
  it('shows the placeholder for an UNTYPED panel — the one state where "Panel X" is right', () => {
    expect(panelDisplayTitle(panel())).toBe('Panel 3');
  });

  it('shows a terminal’s live window title', () => {
    const p = panel({ kind: 'terminal', config: { flavourLabel: 'Command Prompt' } });
    expect(panelDisplayTitle(p, { terminalTitle: 'C:\\Windows\\system32\\cmd.exe' })).toBe(
      'C:\\Windows\\system32\\cmd.exe',
    );
  });

  it('falls back to the shell’s name when no window title has been announced', () => {
    // The stated SECONDARY source. A typed terminal must never show the placeholder: the panel
    // plainly holds a shell, and the flavour is known from the moment the type was confirmed —
    // before the shell has had a chance to announce anything.
    const p = panel({ kind: 'terminal', config: { flavourLabel: 'Command Prompt' } });
    expect(panelDisplayTitle(p)).toBe('Command Prompt');
    expect(panelDisplayTitle(p, { terminalTitle: null })).toBe('Command Prompt');
  });

  it('falls back to the flavour ID when a panel predates the stored label', () => {
    const p = panel({ kind: 'terminal', config: { flavourId: 'git-bash' } });
    expect(panelDisplayTitle(p)).toBe('git-bash');
  });

  it('shows the placeholder for a terminal with neither a title nor a flavour', () => {
    expect(panelDisplayTitle(panel({ kind: 'terminal' }))).toBe('Panel 3');
  });

  it('shows an editor’s file name without its final extension', () => {
    const p = panel({ kind: 'editor' });
    expect(panelDisplayTitle(p, { editorFilePath: 'C:/proj/src/index.test.ts' })).toBe('index.test');
  });

  it('shows the placeholder for an editor holding a never-saved document', () => {
    expect(panelDisplayTitle(panel({ kind: 'editor' }))).toBe('Panel 3');
  });

  it('lets a user’s rename outrank every automatic source', () => {
    const p = panel({
      kind: 'terminal',
      title: 'Build',
      titleIsCustom: true,
      config: { flavourLabel: 'Command Prompt' },
    });
    expect(panelDisplayTitle(p, { terminalTitle: 'cmd.exe' })).toBe('Build');
    const e = panel({ kind: 'editor', title: 'Scratch', titleIsCustom: true });
    expect(panelDisplayTitle(e, { editorFilePath: 'C:/proj/alpha.ts' })).toBe('Scratch');
  });

  it('ignores a blank or whitespace-only source rather than showing an empty header', () => {
    const p = panel({ kind: 'terminal', config: { flavourLabel: '   ' } });
    expect(panelDisplayTitle(p, { terminalTitle: '  ' })).toBe('Panel 3');
  });
});

/**
 * 031 US4 (N8, FR-037) — the limit binds the RESULT, not one favoured source.
 *
 * #218 made this function the single place a panel's name is decided, which is precisely why the
 * bound belongs here: a shell that announces a 400-character window title, a file with a very long
 * stem and a name the user typed all leave through the same return. Putting the cap in the header
 * component instead would bound whichever source that component happened to render.
 */
describe('panelDisplayTitle bounds its result (N8)', () => {
  /** man + ZWJ + woman + ZWJ + girl — ONE cluster, 8 UTF-16 units. */
  const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';

  it('is unbounded when no limit is given, so existing callers are unaffected', () => {
    const p = panel({ kind: 'terminal' });
    const long = 'C:\\Windows\\system32\\cmd.exe — a very long announced window title';
    expect(panelDisplayTitle(p, { terminalTitle: long })).toBe(long);
    expect(panelDisplayTitle(p, { terminalTitle: long }, undefined)).toBe(long);
  });

  it('bounds a name the USER typed', () => {
    const p = panel({ title: 'Deployment scratchpad', titleIsCustom: true, kind: 'terminal' });
    expect(panelDisplayTitle(p, {}, 10)).toBe('Deployment');
  });

  it('bounds a live SHELL title', () => {
    const p = panel({ kind: 'terminal' });
    expect(panelDisplayTitle(p, { terminalTitle: 'C:\\Windows\\system32\\cmd.exe' }, 12)).toBe(
      'C:\\Windows\\s',
    );
  });

  it('bounds a terminal FLAVOUR label, and the flavour id behind it', () => {
    const label = panel({ kind: 'terminal', config: { flavourLabel: 'Command Prompt' } });
    expect(panelDisplayTitle(label, {}, 7)).toBe('Command');
    const id = panel({ kind: 'terminal', config: { flavourId: 'powershell-core' } });
    expect(panelDisplayTitle(id, {}, 5)).toBe('power');
  });

  it('bounds a name derived from an editor FILE path', () => {
    const p = panel({ kind: 'editor' });
    const path = 'C:/proj/src/document-authority.integration.test.ts';
    expect(panelDisplayTitle(p, { editorFilePath: path }, 9)).toBe('document-');
  });

  it('bounds the untyped PLACEHOLDER too — whatever the source means whatever the source', () => {
    expect(panelDisplayTitle(panel({ title: 'Panel 13' }), {}, 5)).toBe('Panel');
  });

  it('cuts on a grapheme boundary, never mid-cluster', () => {
    const p = panel({ kind: 'terminal' });
    const out = panelDisplayTitle(p, { terminalTitle: `ab${FAMILY}cd` }, 3);
    expect(out).toBe(`ab${FAMILY}`);
  });

  it('trims the trailing space a cut leaves behind (N9)', () => {
    // 'Panel 3' cut at 6 lands after the space; a header reading "Panel " is not a name.
    expect(panelDisplayTitle(panel(), {}, 6)).toBe('Panel');
  });

  it('leaves a name within the limit exactly as it was', () => {
    const p = panel({ kind: 'terminal', config: { flavourLabel: 'Command Prompt' } });
    expect(panelDisplayTitle(p, {}, 14)).toBe('Command Prompt');
    expect(panelDisplayTitle(p, {}, 64)).toBe('Command Prompt');
  });

  it('never returns an empty header for an absurd limit', () => {
    // A limit this small cannot arrive through the settings guard (10–128, FR-034), so this is
    // defensive: whatever it does, it must not blank the panel's name.
    expect(panelDisplayTitle(panel(), {}, 1)).toBe('P');
  });
});
