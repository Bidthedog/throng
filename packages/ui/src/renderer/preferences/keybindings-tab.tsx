import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { KEYBINDINGS_METADATA, applyRemove, type ActionId, type FieldDescriptor } from '@throng/core';
import { useKeybindings } from '../config/config-store.js';
import { writeConfig } from '../config/write-config.js';
import { CaptureModal } from './capture-modal.js';

/**
 * The Key Bindings tab (feature 007, US3 + H2 — FR-030/031/033b). A grouped list
 * of bindings from {@link KEYBINDINGS_METADATA}, each row showing the action's
 * label, description, and current chord(s) as **deletable pills**. Double-clicking
 * a row opens the capture modal (FR-031) which ADDS a chord (FR-033); each pill's
 * `×` — and a right-click context menu — removes just that chord (FR-033b). All
 * changes write keybindings.json via the immediate-apply path.
 */
function groupDescriptors(): { group: string; items: FieldDescriptor[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, FieldDescriptor[]>();
  for (const d of KEYBINDINGS_METADATA) {
    if (!byGroup.has(d.group)) {
      byGroup.set(d.group, []);
      order.push(d.group);
    }
    byGroup.get(d.group)!.push(d);
  }
  return order.map((group) => ({ group, items: byGroup.get(group)! }));
}

interface ChordMenu {
  action: ActionId;
  token: string;
  x: number;
  y: number;
}

export function KeybindingsTab(): ReactElement {
  const keybindings = useKeybindings();
  const groups = useMemo(groupDescriptors, []);
  const [capturing, setCapturing] = useState<{ action: ActionId; label: string } | null>(null);
  const [chordMenu, setChordMenu] = useState<ChordMenu | null>(null);

  const writeBindings = (next: Record<string, string[]>): void => {
    void writeConfig(
      { kind: 'keybindings' },
      JSON.stringify({ version: keybindings.version, bindings: next }),
    );
  };

  const applyBindings = (next: Record<string, string[]>): void => {
    writeBindings(next);
    setCapturing(null);
  };

  const removeChord = (action: ActionId, token: string): void => {
    writeBindings(applyRemove(keybindings.bindings, action, token));
    setChordMenu(null);
  };

  // Dismiss the chord context menu on any outside click / Escape.
  useEffect(() => {
    if (!chordMenu) return;
    const close = (): void => setChordMenu(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setChordMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [chordMenu]);

  return (
    <div className="keybindings-tab" data-testid="keybindings-tab">
      {groups.map(({ group, items }) => (
        <section className="settings-group" key={group} data-testid={`keybindings-group-${group}`}>
          <h3 className="settings-group__title">{group}</h3>
          {items.map((d) => {
            const action = d.key as ActionId;
            const chords = keybindings.bindings[d.key] ?? [];
            return (
              <div
                className="settings-row keybinding-row"
                key={d.key}
                data-testid={`binding-${d.key}`}
                onDoubleClick={() => setCapturing({ action, label: d.label })}
                title="Double-click to add a binding"
              >
                <div className="settings-row__meta">
                  <label className="settings-row__label">{d.label}</label>
                  <p className="settings-row__desc">{d.description}</p>
                </div>
                <div className="settings-row__control">
                  <span className="keybinding-chord" data-testid={`binding-${d.key}-chord`}>
                    {chords.length ? (
                      chords.map((c, i) => (
                        <span
                          className="kb-pill"
                          key={c}
                          data-testid={`binding-${d.key}-pill-${i}`}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setChordMenu({ action, token: c, x: e.clientX, y: e.clientY });
                          }}
                        >
                          <kbd>{c}</kbd>
                          <button
                            type="button"
                            className="kb-pill__x"
                            data-testid={`binding-${d.key}-remove-${i}`}
                            title={`Remove ${c}`}
                            aria-label={`Remove ${c}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeChord(action, c);
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ))
                    ) : (
                      <em>unbound</em>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </section>
      ))}

      {chordMenu ? (
        <div
          className="kb-ctx-menu"
          data-testid="binding-context-menu"
          role="menu"
          style={{ left: chordMenu.x, top: chordMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="kb-ctx-menu__item"
            data-testid="binding-context-remove"
            onClick={() => removeChord(chordMenu.action, chordMenu.token)}
          >
            Remove “{chordMenu.token}”
          </button>
        </div>
      ) : null}

      {capturing ? (
        <CaptureModal
          action={capturing.action}
          label={capturing.label}
          bindings={keybindings.bindings}
          onApply={applyBindings}
          onClose={() => setCapturing(null)}
        />
      ) : null}
    </div>
  );
}
