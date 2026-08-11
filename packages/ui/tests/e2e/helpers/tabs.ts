/**
 * Tab-strip E2E helpers (031).
 *
 * Two jobs, both about not re-deriving the same thing in five specs:
 *
 *  - {@link seedTabs} makes the strip overflow. Every US1/US3/US5 spec needs that and none of them
 *    care how it is done, so the "+ then type then Enter" dance lives here once.
 *  - {@link stripGeometry} reads what the strip actually looks like. US1's whole claim is about
 *    GEOMETRY — a tab's height and position — rather than about a class being present, so the
 *    measurement has to come from `getBoundingClientRect()` in the real renderer. Reading it in one
 *    place also stops each spec inventing its own selectors, which is what makes a restructure like
 *    031's cost twenty spec edits instead of one.
 */
import type { Page } from '@playwright/test';

/** A tab's on-screen box, as the renderer actually laid it out. */
export interface TabBox {
  testId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What the strip looks like right now. */
export interface StripGeometry {
  tabs: TabBox[];
  /** The scrolling track's metrics. `scrollWidth > clientWidth` is the definition of overflow. */
  track: { scrollLeft: number; scrollWidth: number; clientWidth: number };
  /**
   * True when a NATIVE horizontal scrollbar occupies space in the strip — the 031 defect.
   *
   * Measured as `offsetHeight - clientHeight` on the scrolling element, which is exactly the space a
   * horizontal scrollbar takes out of the content box. Checking `overflow-x` in CSS would not do:
   * the property can say `auto` while no scrollbar is present, and it is the STOLEN SPACE that
   * clipped the tabs, not the declaration.
   */
  hasNativeScrollbar: boolean;
  /** Whether each fade overlay is showing. */
  fades: { left: boolean; right: boolean };
}

/**
 * Create tabs named `names`, in order, and return their test ids.
 *
 * Clicking "+" creates a tab AND opens its rename field (tab-group.tsx: `setRenamingTabId(ws.addTab())`),
 * so each name is typed into the field that is already focused rather than by re-entering rename.
 */
export async function seedTabs(win: Page, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    await win.getByTestId('tab-add').click();
    const input = win.locator('[data-testid^="tab-rename-input-"]');
    await input.waitFor({ state: 'visible' });
    const testId = (await input.getAttribute('data-testid')) ?? '';
    await input.fill(name);
    await input.press('Enter');
    // The id is the suffix of the rename input's testid; the chip's testid uses the same id.
    ids.push(`tab-${testId.replace('tab-rename-input-', '')}`);
  }
  return ids;
}

/** Measure the strip as it is currently laid out. */
export async function stripGeometry(win: Page): Promise<StripGeometry> {
  return win.evaluate(() => {
    const strip = document.querySelector('[data-testid="tab-strip"]');
    if (!strip) throw new Error('no tab strip in the DOM');

    // The scrolling element is the track once 031 lands, and was the strip itself before it. Reading
    // whichever exists keeps this helper usable on both sides of the restructure, which is what lets
    // the same spec fail before it and pass after.
    const track = strip.querySelector('[data-testid="tabstrip-track"]') ?? strip;
    const el = track as HTMLElement;

    const boxes = [...strip.querySelectorAll('[data-testid^="tab-"]')]
      .filter((n) => /^tab-[^-]/.test(n.getAttribute('data-testid') ?? ''))
      .filter((n) => !(n.getAttribute('data-testid') ?? '').startsWith('tab-add'))
      .map((n) => {
        const r = n.getBoundingClientRect();
        return {
          testId: n.getAttribute('data-testid') ?? '',
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
        };
      });

    return {
      tabs: boxes,
      track: { scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth },
      hasNativeScrollbar: el.offsetHeight - el.clientHeight > 0,
      fades: {
        left: strip.getAttribute('data-fade-left') === 'true',
        right: strip.getAttribute('data-fade-right') === 'true',
      },
    };
  });
}

/** True when the tabs no longer fit the track. */
export function isOverflowing(g: StripGeometry): boolean {
  return g.track.scrollWidth > g.track.clientWidth;
}
