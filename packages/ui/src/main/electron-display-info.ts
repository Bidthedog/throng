import type { Display } from 'electron';
import {
  createStaticDisplayInfo,
  type DisplayBounds,
  type DisplayDescriptor,
  type IDisplayInfo,
  type WindowBounds,
} from '@throng/core';

/** Supplies the current displays; the composition root binds `screen.getAllDisplays`. */
export type DisplaySource = () => Display[];

/**
 * `IDisplayInfo` over Electron `screen` (research D8 — `screen` is main-only).
 * The display SOURCE is injected (so this stays unit-testable without an Electron
 * runtime); the geometry is delegated to the pure core `createStaticDisplayInfo`.
 * Used by the window-manager to restore sub-workspace windows onto a visible
 * display (FR-028, US4).
 */
export class ElectronDisplayInfo implements IDisplayInfo {
  constructor(private readonly source: DisplaySource) {}

  private descriptors(): DisplayDescriptor[] {
    return this.source().map((d) => ({
      id: String(d.id),
      bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
    }));
  }

  listDisplays(): DisplayDescriptor[] {
    return this.descriptors();
  }

  isVisible(bounds: WindowBounds): boolean {
    return createStaticDisplayInfo(this.descriptors()).isVisible(bounds);
  }

  clampToVisible(bounds: WindowBounds): WindowBounds {
    return createStaticDisplayInfo(this.descriptors()).clampToVisible(bounds);
  }

  primaryBounds(): DisplayBounds {
    return createStaticDisplayInfo(this.descriptors()).primaryBounds();
  }

  centerOnPrimary(width: number, height: number): DisplayBounds {
    return createStaticDisplayInfo(this.descriptors()).centerOnPrimary(width, height);
  }
}
