/**
 * The Resource Monitor settings as the renderer uses them (055 R11): read from the live app settings
 * and resolved by core's `resolveResourceMonitorSettings`, the one place the cross-field rules live —
 * the interval raised to the history window's minimum, a warning kept below its critical.
 */
import { useMemo } from 'react';
import { resolveResourceMonitorSettings, type ResolvedResourceMonitorSettings } from '@throng/core';
import { useAppSettings } from '../config/config-store.js';

export function useResourceMonitorSettings(): ResolvedResourceMonitorSettings {
  const raw = useAppSettings().resourceMonitor;
  return useMemo(() => resolveResourceMonitorSettings(raw), [raw]);
}
