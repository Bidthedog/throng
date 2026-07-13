import { fileURLToPath } from 'node:url';

/**
 * The bundled application icon (#72) — what the OS shows in the taskbar, in
 * Alt-Tab, and (once packaging exists) on the executable itself. Every window we
 * create is given it; without it Electron falls back to its own default icon.
 *
 * Resolved relative to this module rather than the process cwd, which puts it two
 * levels below `packages/ui` from BOTH `src/main` (vitest, running the TypeScript
 * source) and `dist/main` (electron, running the build output) — so the same path
 * holds in either and the assets need no build-time copy step.
 *
 * The `.ico` holds SEVEN sizes, drawn from the two source SVGs: the simplified
 * `icon_small.svg` at <=32px and the detailed `icon_large.svg` above it. Windows
 * picks whichever entry matches the size it is about to draw, so the small artwork
 * is what actually appears in the taskbar. Regenerate with
 * `node scripts/build-app-icons.mjs` after changing the artwork.
 */
const assets = (file: string): string => fileURLToPath(new URL(`../../assets/${file}`, import.meta.url));

/** Multi-size Windows icon — the one to hand to `BrowserWindow`'s `icon:`. */
export const APP_ICON_ICO = assets('throng.ico');

/** 256px PNG, for the platforms whose window icon cannot read an `.ico` (Linux). */
export const APP_ICON_PNG = assets('throng-256.png');

/** The window icon for the current platform. */
export const appIcon = (): string => (process.platform === 'win32' ? APP_ICON_ICO : APP_ICON_PNG);
