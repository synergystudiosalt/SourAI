/**
 * Feature flag resolution and runtime overrides.
 *
 * Resolution order, highest priority first:
 *   1. runtime override  (development builds, or an explicit opt-in build)
 *   2. build environment (`VITE_ENABLE_*`)
 *   3. coded default
 *
 * Overrides live in `localStorage` because they must be readable before the
 * IndexedDB layer boots and because losing them costs nothing. They are never
 * authoritative for anything a user would miss.
 */

import { SourError } from '../../contracts/errors';
import {
  type FlagDefinition,
  type FlagKey,
  getFlagDefinition,
  listFlagDefinitions,
  parseEnvFlag,
} from './registry';

const OVERRIDE_STORAGE_KEY = 'sour_flag_overrides';

export type FlagSource = 'override' | 'env' | 'default';

export interface ResolvedFlag {
  readonly key: FlagKey;
  readonly value: boolean;
  readonly source: FlagSource;
  readonly definition: FlagDefinition;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let overrides: Partial<Record<FlagKey, boolean>> | null = null;
/** Cached immutable snapshot — `useSyncExternalStore` requires referential stability. */
let snapshot: Readonly<Record<FlagKey, boolean>> | null = null;

/**
 * Whether runtime overrides may be applied at all.
 *
 * Production builds keep flags immutable so that a compromised page (or a
 * curious user following a support article) cannot switch on an unfinished
 * mutation path. Setting `VITE_ALLOW_FLAG_OVERRIDES=true` is an explicit,
 * documented decision for preview deployments.
 */
export function areOverridesAllowed(): boolean {
  if (import.meta.env.DEV) return true;
  return parseEnvFlag(import.meta.env.VITE_ALLOW_FLAG_OVERRIDES) === true;
}

function readOverrides(): Partial<Record<FlagKey, boolean>> {
  if (overrides) return overrides;
  overrides = {};
  if (!areOverridesAllowed()) return overrides;
  try {
    const raw = globalThis.localStorage?.getItem(OVERRIDE_STORAGE_KEY);
    if (!raw) return overrides;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return overrides;
    for (const definition of listFlagDefinitions()) {
      const value = (parsed as Record<string, unknown>)[definition.key];
      if (typeof value === 'boolean') overrides[definition.key] = value;
    }
  } catch {
    // Corrupt or unavailable storage (private mode, disabled cookies, quota).
    // Flags fall back to build configuration, which is always a safe state.
  }
  return overrides;
}

function persistOverrides(): void {
  try {
    const current = readOverrides();
    if (Object.keys(current).length === 0) {
      globalThis.localStorage?.removeItem(OVERRIDE_STORAGE_KEY);
    } else {
      globalThis.localStorage?.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(current));
    }
  } catch {
    // Overrides are a developer convenience; failing to persist them must not
    // break the session.
  }
}

function invalidate(): void {
  snapshot = null;
  for (const listener of listeners) listener();
}

/** Resolves one flag along with where its value came from. */
export function resolveFlag(key: FlagKey): ResolvedFlag {
  const definition = getFlagDefinition(key);

  const override = readOverrides()[key];
  if (override !== undefined) {
    return { key, value: override, source: 'override', definition };
  }

  const fromEnv = parseEnvFlag(definition.envValue);
  if (fromEnv !== undefined) {
    return { key, value: fromEnv, source: 'env', definition };
  }

  return { key, value: definition.defaultValue, source: 'default', definition };
}

/** Whether a feature is switched on. Does not imply the browser supports it. */
export function isEnabled(key: FlagKey): boolean {
  return resolveFlag(key).value;
}

/** Every flag with its provenance — used by the settings screen and bug reports. */
export function resolveAllFlags(): readonly ResolvedFlag[] {
  return listFlagDefinitions().map((definition) => resolveFlag(definition.key));
}

/** Stable snapshot of all flag values, for `useSyncExternalStore`. */
export function getFlagsSnapshot(): Readonly<Record<FlagKey, boolean>> {
  if (!snapshot) {
    const next = {} as Record<FlagKey, boolean>;
    for (const definition of listFlagDefinitions()) {
      next[definition.key] = resolveFlag(definition.key).value;
    }
    snapshot = Object.freeze(next);
  }
  return snapshot;
}

export function subscribeToFlags(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sets a runtime override. Throws when the build forbids overrides. */
export function setFlagOverride(key: FlagKey, value: boolean): void {
  if (!areOverridesAllowed()) {
    throw new SourError({
      code: 'flag_override_forbidden',
      message: 'Feature flags are fixed at build time in this deployment.',
      causeCategory: 'policy',
      retryable: false,
      userAction: 'Rebuild with the corresponding VITE_ENABLE_* variable to change this.',
      details: { key },
    });
  }
  getFlagDefinition(key); // rejects unknown keys
  readOverrides()[key] = value;
  persistOverrides();
  invalidate();
}

/** Removes an override so the flag falls back to env/default. */
export function clearFlagOverride(key: FlagKey): void {
  const current = readOverrides();
  if (!(key in current)) return;
  delete current[key];
  persistOverrides();
  invalidate();
}

export function clearAllFlagOverrides(): void {
  overrides = {};
  persistOverrides();
  invalidate();
}

/** Test seam: drops cached state so a fresh `localStorage` is re-read. */
export function resetFlagCacheForTests(): void {
  overrides = null;
  snapshot = null;
}
