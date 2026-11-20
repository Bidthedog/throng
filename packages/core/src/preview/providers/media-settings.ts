/**
 * 074 FR-011 — the Maximum file size setting the media providers each declare, in one shape: a slider in 5 MB steps
 * over the range `editor.maxOpenFileBytes` uses, with the field beside it for an exact number (018). Pure data.
 */
import type { ProviderSettingDeclaration } from '../provider.js';

const MB = 1024 * 1024;

/**
 * 074 FR-027b (2026-11-19) — whether a picture's transparent areas are hatched (in the theme's Picture Transparency
 * Marker colour) or show the canvas plainly. `noun` names the pictures ("images", "SVGs"). Ships on.
 */
export function transparencyHatchSetting(noun: string): ProviderSettingDeclaration {
  return {
    leaf: 'transparencyHatch',
    label: 'Hatch transparent areas',
    description: `Draw diagonal hatching behind the transparent parts of ${noun}, so their edges show against the background. The hatch colour is the theme's Picture Transparency Marker.`,
    control: 'toggle',
    default: true,
  };
}

/** `noun` names what is capped ("SVG files", "images"); `shipped` is in bytes and sits on a 5 MB stop. */
export function maxFileBytesSetting(noun: string, shipped: number): ProviderSettingDeclaration {
  return {
    leaf: 'maxFileBytes',
    label: 'Maximum file size',
    description: `${noun} larger than this are not read; the preview says how large the file is instead. Measured in bytes; the slider moves in 5 MB steps.`,
    control: 'number',
    default: shipped,
    min: 5 * MB,
    max: 250 * MB,
    step: 5 * MB,
  };
}
