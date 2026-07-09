/**
 * IFontEnumeration (feature 007, FR-038a) — the OS seam for listing installed
 * font families (Principle II). Enumeration is OS-specific and may be slow, so
 * callers run it in the background and cache the result; the seam itself is pure
 * of caching. A failure resolves to an empty list (never throws) so the font
 * picker falls back to a curated list rather than crashing.
 */
export interface IFontEnumeration {
  /** Installed font-family names (order unspecified, de-duplicated, no empties). */
  listInstalledFamilies(): Promise<string[]>;
}
