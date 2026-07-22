import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type Ref,
} from 'react';
import { Icon } from '../common/icon.js';
import { clampToViewport } from '../common/clamp-to-viewport.js';

export interface MenuItem {
  /** The row's text. Required for a real action item; omitted for a `separator`. */
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Theme icon token shown before the label (e.g. 'rename', 'send', 'destroy'). */
  icon?: string;
  /**
   * The command's first keyboard shortcut, shown in brackets after the label in smaller text
   * (US1, #125) — e.g. `Ctrl+C`. Resolved live from the keybindings at the build site via
   * `firstBinding`; absent when the command is unbound (no brackets, no layout shift).
   */
  shortcut?: string;
  /** A nested submenu, shown as a flyout after a hover dwell. Nests to any depth. */
  submenu?: MenuItem[];
  /**
   * A non-interactive section divider (FR-018a) rather than an action. When set, the item renders
   * as a horizontal rule and carries no label/icon/shortcut/action; keyboard navigation skips it.
   */
  separator?: boolean;
  /**
   * Override the item's test identifier (default `menu-item-<label>`).
   *
   * This exists so a bespoke menu can be folded into this one WITHOUT renaming the identifiers its
   * tests already assert. The cog menu's `cog-menu-settings` is used by roughly ten end-to-end specs
   * to reach the preferences window; renaming it would have turned a menu unification into a
   * ten-file test migration, and the temptation would have been to skip the unification instead.
   */
  testId?: string;
}

const DEFAULT_SUBMENU_DELAY_MS = 100;

/**
 * One level of the context menu. Renders its items and, for any item with a
 * `submenu`, a flyout (recursively another `MenuLevel`) that opens after a hover
 * dwell — so menus nest to arbitrary depth (e.g. "Sync to" → sub-workspace → Tab).
 * Each level tracks which of its own items is open.
 */
function MenuLevel({
  items,
  onClose,
  submenuDelayMs,
  testId,
  isRoot = false,
  rootRef,
  style,
}: {
  items: MenuItem[];
  onClose: () => void;
  submenuDelayMs: number;
  testId: string;
  /**
   * Passed explicitly rather than inferred from `testId === 'context-menu'`, which is how it used to
   * be decided. That inference broke the moment a folded-in menu (the cog) kept its own root id: the
   * root would have been treated as a SUBMENU, taking the flyout's positioning and losing the root's
   * flip/clamp — a bug you would only ever see near a screen edge.
   */
  isRoot?: boolean;
  rootRef?: Ref<HTMLUListElement>;
  style?: CSSProperties;
}): ReactElement {
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openLabel, setOpenLabel] = useState<string | null>(null);

  /*
   * Keyboard navigation (018 / FR-013a).
   *
   * This menu handled Escape and nothing else — no arrows, no Enter, no roles. That was survivable
   * while it was only ever opened by a right-click, but FR-013 folds the COG MENU into it, and the
   * cog menu today is a list of real <button role="menuitem"> elements that a keyboard user can
   * reach. Migrating it onto a mouse-only menu would have been an ACCESSIBILITY REGRESSION shipped
   * under the banner of unifying the menus.
   *
   * Roving focus: exactly one item is tabbable at a time and holds DOM focus; the arrows move it.
   */
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  // Separators (FR-018a) and disabled items are not keyboard-navigable.
  const enabled = items.map((it, i) => (it.disabled || it.separator ? -1 : i)).filter((i) => i >= 0);
  /**
   * NOTHING is active until the user says so.
   *
   * This used to start on the first item, and the menu opened with that item FOCUSED — so it looked
   * highlighted, permanently, whether or not the pointer was anywhere near it. Opening the cog menu
   * pre-selected "Settings" and the user had to move the mouse away from a highlight they had not
   * asked for. A menu should open with nothing chosen; a highlight is an answer to a question the user
   * has not yet asked.
   *
   * Keyboard navigation is unaffected: the LIST takes focus on open (so the first arrow key lands in
   * the menu rather than scrolling the page behind it), and the first Down/Up moves onto a real item.
   */
  const NONE = -1;
  const [active, setActive] = useState<number>(NONE);

  const focusItem = (index: number): void => {
    setActive(index);
    itemRefs.current[index]?.focus();
  };

  const step = (delta: number): void => {
    if (enabled.length === 0) return;
    // From "nothing chosen", Down lands on the first item and Up on the last — which is what every
    // menu on this platform does, and what a keyboard user reaches for without thinking.
    if (active === NONE) {
      focusItem((delta > 0 ? enabled[0] : enabled.at(-1))!);
      return;
    }
    const at = enabled.indexOf(active);
    // Wrap: Down on the last item returns to the first.
    const next = enabled[(at + delta + enabled.length) % enabled.length]!;
    focusItem(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        step(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        step(-1);
        break;
      case 'Home':
        e.preventDefault();
        if (enabled[0] !== undefined) focusItem(enabled[0]);
        break;
      case 'End':
        e.preventDefault();
        if (enabled.at(-1) !== undefined) focusItem(enabled.at(-1)!);
        break;
      case 'ArrowRight': {
        const item = items[active];
        if (item?.submenu?.length) {
          e.preventDefault();
          e.stopPropagation();
          setOpenLabel(item.label ?? null);
        }
        break;
      }
      case 'ArrowLeft':
        if (openLabel !== null) {
          e.preventDefault();
          e.stopPropagation();
          setOpenLabel(null);
        }
        break;
      case 'Enter':
      case ' ': {
        const item = items[active];
        if (!item || item.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        if (item.submenu?.length) {
          setOpenLabel((cur) => (cur === item.label ? null : (item.label ?? null)));
          return;
        }
        item.onClick?.();
        onClose();
        break;
      }
      default:
        break;
    }
  };

  // Take focus when the menu opens, so the very first arrow key lands somewhere sensible rather than
  // scrolling the page behind it.
  //
  // Deliberately ON MOUNT ONLY. `enabled` is rebuilt on every render, so depending on it would
  // re-run this whenever the item list changed — snatching focus back from a submenu the user had
  // just arrowed into. The ref makes that explicit rather than suppressing the lint rule.
  const focusedOnOpen = useRef(false);
  useEffect(() => {
    if (focusedOnOpen.current) return;
    focusedOnOpen.current = true;
    // The LIST, not the first item. Focusing an item would highlight it, and the menu would open with
    // a choice already made for the user. The list holds the key handler, so the arrows still work.
    ulRef.current?.focus();
  }, [enabled]);

  // A nested flyout opens to the right (left:100%); if that would push it off the
  // screen (deeply nested menus near the right edge — only a scrollbar showed
  // before), flip it to open leftward / upward so every item stays fully visible.
  const ulRef = useRef<HTMLUListElement | null>(null);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const setUlRef = (node: HTMLUListElement | null): void => {
    ulRef.current = node;
    if (typeof rootRef === 'function') rootRef(node);
    else if (rootRef) (rootRef as { current: HTMLUListElement | null }).current = node;
  };
  useLayoutEffect(() => {
    if (isRoot || !ulRef.current) return;
    const r = ulRef.current.getBoundingClientRect();
    if (r.right > window.innerWidth) setFlipX(true);
    if (r.bottom > window.innerHeight) setFlipY(true);
  }, [isRoot]);

  const cancelHover = (): void => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  return (
    <ul
      ref={setUlRef}
      className={`context-menu${isRoot ? '' : ' context-menu--sub'}${flipX ? ' context-menu--flip-x' : ''}${flipY ? ' context-menu--flip-y' : ''}`}
      style={style}
      data-testid={testId}
      role="menu"
      // Focusable, but not in the tab order: it is a focus HOLDER so the arrow keys reach the menu
      // without any item having to look chosen.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, index) => {
        // FR-018a — a section divider: non-interactive, no role="menuitem", skipped by navigation.
        if (item.separator) {
          return <li key={`sep-${index}`} className="context-menu__separator" role="separator" aria-hidden />;
        }
        const hasSub = !!item.submenu && item.submenu.length > 0;
        return (
          <li
            key={item.label}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            className={`context-menu__item${item.disabled ? ' context-menu__item--disabled' : ''}${hasSub ? ' context-menu__item--parent' : ''}`}
            data-testid={item.testId ?? `menu-item-${item.label}`}
            role="menuitem"
            aria-disabled={item.disabled ?? false}
            aria-haspopup={hasSub || undefined}
            // Roving tabindex: one item is reachable, and it is the one that has focus.
            tabIndex={index === active && !item.disabled ? 0 : -1}
            onFocus={() => setActive(index)}
            onMouseEnter={() => {
              cancelHover();
              if (hasSub && !item.disabled) {
                hoverTimer.current = setTimeout(() => setOpenLabel(item.label ?? null), submenuDelayMs);
              } else {
                setOpenLabel(null);
              }
            }}
            onMouseLeave={cancelHover}
            onClick={(e) => {
              if (item.disabled) return;
              if (hasSub) {
                e.stopPropagation();
                cancelHover();
                setOpenLabel((cur) => (cur === item.label ? null : (item.label ?? null))); // click toggles
                return;
              }
              item.onClick?.();
              onClose();
            }}
          >
            <span className="context-menu__icon" aria-hidden>
              {item.icon ? <Icon token={item.icon} /> : ''}
            </span>
            <span className="context-menu__label">{item.label}</span>
            {item.shortcut ? (
              // US1 (#125): the command's first binding, in smaller text after the label. Only
              // rendered when present, so an unbound item is byte-identical to before (FR-004).
              <span className="context-menu__shortcut" data-testid={`menu-shortcut-${item.label}`}>
                ({item.shortcut})
              </span>
            ) : null}
            {hasSub ? (
              // The submenu arrow was a literal ▸ character, while the theme has shipped a `chevron`
              // icon token all along. An icon drawn from a hard-coded glyph is an icon outside the
              // theming system, which is the whole complaint of FR-014.
              <span className="context-menu__chevron" aria-hidden>
                <Icon token="chevron" />
              </span>
            ) : null}
            {hasSub && openLabel === item.label ? (
              <MenuLevel
                items={item.submenu!}
                onClose={onClose}
                submenuDelayMs={submenuDelayMs}
                testId={`submenu-${item.label}`}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A lightweight right-click context menu rendered at a screen position
 * (FR-036/037), with themeable per-item icons and **arbitrarily nested** submenus
 * that open after a configurable hover dwell. Closes on an outside pointer-press
 * or Escape.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
  submenuDelayMs = DEFAULT_SUBMENU_DELAY_MS,
  testId = 'context-menu',
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  submenuDelayMs?: number;
  /** Root test id. A menu folded into this one keeps its own (e.g. `cog-menu`) — see FR-053. */
  testId?: string;
}): ReactElement {
  const ref = useRef<HTMLUListElement>(null);

  // Keep the root menu fully on-screen (FR-089): when it would overflow the right
  // edge, open it to the LEFT of the cursor; when it would overflow the bottom,
  // open it ABOVE the cursor — then clamp so no part is off-screen. The cursor is a
  // POINT anchor (zero-size rect). Shared with the colour picker via clampToViewport
  // (US11/FR-036). Measured before paint (useLayoutEffect) so it never flashes off-screen.
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(
      clampToViewport(
        { left: x, top: y, right: x, bottom: y },
        { width: r.width, height: r.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [x, y, items]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    // FR-017a — close when the window loses focus.
    //
    // The single-menu-open invariant holds WITHIN a window: the provider keeps one menu state, so
    // opening any menu replaces any other. It cannot reach ACROSS windows, because throng runs the
    // main window, each sub-workspace and the preferences window as separate renderer processes —
    // and coordinating them would need inter-process messaging for no benefit the user can name.
    //
    // Closing on blur delivers what "application-wide" was actually reaching for: the user never
    // sees a menu hanging open in a window they have clicked away from. One listener, no protocol.
    const onBlur = (): void => onClose();
    const handle = setTimeout(() => {
      window.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('keydown', onKey);
      window.addEventListener('blur', onBlur);
    }, 0);
    return () => {
      clearTimeout(handle);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [onClose]);

  return (
    <MenuLevel
      items={items}
      onClose={onClose}
      submenuDelayMs={submenuDelayMs}
      testId={testId}
      isRoot
      rootRef={ref}
      style={{ left: pos.left, top: pos.top }}
    />
  );
}
