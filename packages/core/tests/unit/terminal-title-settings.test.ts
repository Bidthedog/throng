/**
 * 053 FR-014 / FR-008 — the terminal title template and its two length limits are settings.
 *
 * Defaults, the descriptors that render them in Preferences, the tolerant read of each leaf, a write
 * keeping them (`cloneTerminals`), and a hand-edited invalid template reported through the
 * descriptor's own `validate` — the same rule the Preferences control will call.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_TERMINAL_TITLE_TEMPLATE,
  SETTINGS_METADATA,
  checkSettingsText,
  parseAppSettings,
  validateTitleTemplate,
} from '../../src/index.js';

const descriptor = (key: string) => SETTINGS_METADATA.find((d) => d.key === key);

describe('terminal title settings — defaults and descriptors (053 FR-014)', () => {
  it('ships the default template and two limits of 40', () => {
    expect(DEFAULT_APP_SETTINGS.terminals.titleTemplate).toBe(DEFAULT_TERMINAL_TITLE_TEMPLATE);
    expect(DEFAULT_APP_SETTINGS.terminals.titleCommandMaxLength).toBe(40);
    expect(DEFAULT_APP_SETTINGS.terminals.titlePathMaxLength).toBe(40);
  });

  it('renders the template as a text control validated by the template parser', () => {
    const d = descriptor('terminals.titleTemplate');
    expect(d).toBeDefined();
    expect(d!.control).toBe('text');
    expect(d!.group).toBe('Terminal');
    expect(d!.validate).toBe(validateTitleTemplate);
    expect(d!.description.length).toBeGreaterThan(0);
  });

  it.each(['terminals.titleCommandMaxLength', 'terminals.titlePathMaxLength'])(
    'renders %s as a slider from 10 to 200 in steps of 5',
    (key) => {
      const d = descriptor(key);
      expect(d).toBeDefined();
      expect(d!).toMatchObject({ control: 'slider', min: 10, max: 200, step: 5, group: 'Terminal' });
    },
  );
});

describe('terminal title settings — read side (053 FR-014, FR-008)', () => {
  it('reads each leaf when it is well-formed', () => {
    const s = parseAppSettings({
      terminals: { titleTemplate: '{shell}', titleCommandMaxLength: 60, titlePathMaxLength: 25 },
    });
    expect(s.terminals.titleTemplate).toBe('{shell}');
    expect(s.terminals.titleCommandMaxLength).toBe(60);
    expect(s.terminals.titlePathMaxLength).toBe(25);
  });

  it('falls back per leaf for a value of the wrong type', () => {
    const s = parseAppSettings({
      terminals: { titleTemplate: 42, titleCommandMaxLength: 'long', titlePathMaxLength: null },
    });
    expect(s.terminals.titleTemplate).toBe(DEFAULT_TERMINAL_TITLE_TEMPLATE);
    expect(s.terminals.titleCommandMaxLength).toBe(40);
    expect(s.terminals.titlePathMaxLength).toBe(40);
  });

  it('keeps an INVALID template as written — the renderer falls back, settings validity reports it', () => {
    // Rewriting it on read would erase what the user typed; FR-008 asks for a fallback and a notice.
    const s = parseAppSettings({ terminals: { titleTemplate: '({shell}' } });
    expect(s.terminals.titleTemplate).toBe('({shell}');
  });

  it('survives a parse of the parsed settings — the write path keeps every leaf', () => {
    const once = parseAppSettings({
      terminals: { titleTemplate: '{app}', titleCommandMaxLength: 15, titlePathMaxLength: 100 },
    });
    const twice = parseAppSettings(JSON.parse(JSON.stringify(once)));
    expect(twice.terminals).toMatchObject({
      titleTemplate: '{app}',
      titleCommandMaxLength: 15,
      titlePathMaxLength: 100,
    });
  });
});

describe('terminal title settings — settings validity (053 FR-008)', () => {
  const doc = (terminals: Record<string, unknown>) =>
    JSON.stringify({ ...DEFAULT_APP_SETTINGS, terminals: { ...DEFAULT_APP_SETTINGS.terminals, ...terminals } });

  it('reports an invalid template with the parser’s message', () => {
    const validity = checkSettingsText(doc({ titleTemplate: '({shell}' }));
    expect(validity.kind).toBe('checked');
    if (validity.kind !== 'checked') return;
    expect(validity.problems).toHaveLength(1);
    expect(validity.problems[0]!.key).toBe('terminals.titleTemplate');
    expect(validity.problems[0]!.reason).toContain('Unclosed bracket at 0');
  });

  it('accepts a valid template', () => {
    const validity = checkSettingsText(doc({ titleTemplate: '({title} ?? {app}) | {shell}' }));
    expect(validity).toEqual({ kind: 'checked', problems: [] });
  });

  it('reports a limit outside 10–200', () => {
    const validity = checkSettingsText(doc({ titlePathMaxLength: 5 }));
    expect(validity.kind === 'checked' && validity.problems.map((p) => p.key)).toEqual([
      'terminals.titlePathMaxLength',
    ]);
  });
});
