/**
 * The plain-text url detector's pattern, handed to WebLinksAddon (#198).
 *
 * 045 D10: the pattern now lives in `@throng/core` as `WEB_URL_REGEX`, moved byte for byte, so
 * terminals and editors share one web grammar (FR-102, FR-104). This name is kept so
 * `terminal-url.test.ts` and the terminal's existing imports pass unchanged.
 */
export { WEB_URL_REGEX as TERMINAL_URL_REGEX } from '@throng/core';
