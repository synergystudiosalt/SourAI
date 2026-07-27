import { useSyncExternalStore } from 'react';

import type { FlagKey } from './registry';
import { getFlagsSnapshot, subscribeToFlags } from './store';

/**
 * Reads a feature flag and re-renders when a runtime override changes.
 *
 * The flag answers "is this feature switched on", never "does this browser
 * support it". Capability detection is a separate check (see
 * `docs/adr/0003-execution-runtimes.md`); a feature needs both.
 */
export function useFlag(key: FlagKey): boolean {
  const flags = useSyncExternalStore(subscribeToFlags, getFlagsSnapshot, getFlagsSnapshot);
  return flags[key];
}

/** All flag values at once, for screens that render several toggles. */
export function useFlags(): Readonly<Record<FlagKey, boolean>> {
  return useSyncExternalStore(subscribeToFlags, getFlagsSnapshot, getFlagsSnapshot);
}
