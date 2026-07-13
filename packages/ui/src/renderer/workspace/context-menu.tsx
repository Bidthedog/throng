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

export interface MenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Theme icon token shown before the label (e.g. 'rename', 'send', 'destroy'). */
  icon?: string;
  /** A nested submenu, shown as a flyout after a hover dwell. Nests to any depth. */
  submenu?: MenuItem[];
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
  rootRef,
  style,
}: {
  items: MenuItem[];
  onClose: () => void;
  submenuDelayMs: number;
  testId: string;
  rootRef?: Ref<HTMLUListElement>;
  style?: CSSProperties;
}): ReactElement {
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  const isRoot = testId === 'context-menu';

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
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => {
        const hasSub = !!item.submenu && item.submenu.length > 0;
        return (
          <li
            key={item.label}
            className={`context-menu__item${item.disabled ? ' context-menu__item--disabled' : ''}${hasSub ? ' context-menu__item--parent' : ''}`}
            data-testid={`menu-item-${item.label}`}
            onMouseEnter={() => {
              cancelHover();
              if (hasSub && !item.disabled) {
                hoverTimer.current = setTimeout(() => setOpenLabel(item.label), submenuDelayMs);
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
                setOpenLabel((cur) => (cur === item.label ? null : item.label)); // click toggles
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
            {hasSub ? (
              <span className="context-menu__chevron" aria-hidden>
                ▸
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
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  submenuDelayMs?: number;
}): ReactElement {
  const ref = useRef<HTMLUListElement>(null);

  // Keep the root menu fully on-screen (FR-089): when it would overflow the right
  // edge, open it to the LEFT of the cursor; when it would overflow the bottom,
  // open it ABOVE the cursor — then clamp so no part is off-screen. Measured before
  // paint (useLayoutEffect) so it never flashes off-screen.
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x + r.width > vw ? x - r.width : x; // flip left near the right edge
    let top = y + r.height > vh ? y - r.height : y; // flip up near the bottom edge
    left = Math.max(0, Math.min(left, vw - r.width));
    top = Math.max(0, Math.min(top, vh - r.height));
    setPos({ left, top });
  }, [x, y, items]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const handle = setTimeout(() => {
      window.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(handle);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <MenuLevel
      items={items}
      onClose={onClose}
      submenuDelayMs={submenuDelayMs}
      testId="context-menu"
      rootRef={ref}
      style={{ left: pos.left, top: pos.top }}
    />
  );
}
