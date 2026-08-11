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
