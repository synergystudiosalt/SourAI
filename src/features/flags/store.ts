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

const LEGACY_OVERRIDE_STORAGE_KEY = 'sour_flag_overrides';
const OVERRIDE_STORAGE_PREFIX = 'sour_flag_override:';

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
let storageListenerInstalled = false;

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

function parseOverrides(raw: string | null): Partial<Record<FlagKey, boolean>> {
  const parsedOverrides: Partial<Record<FlagKey, boolean>> = {};
  if (!raw || !areOverridesAllowed()) return parsedOverrides;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsedOverrides;
    for (const definition of listFlagDefinitions()) {
      const value = (parsed as Record<string, unknown>)[definition.key];
      if (typeof value === 'boolean') parsedOverrides[definition.key] = value;
    }
  } catch {
    // Corrupt or unavailable storage (private mode, disabled cookies, quota).
    // Flags fall back to build configuration, which is always a safe state.
  }
  return parsedOverrides;
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function overrideStorageKey(key: FlagKey): string {
  return `${OVERRIDE_STORAGE_PREFIX}${key}`;
}

function flagFromStorageKey(storageKey: string): FlagKey | null {
  if (!storageKey.startsWith(OVERRIDE_STORAGE_PREFIX)) return null;
  const candidate = storageKey.slice(OVERRIDE_STORAGE_PREFIX.length);
  return listFlagDefinitions().find((definition) => definition.key === candidate)?.key ?? null;
}

function parseStoredOverride(raw: string | null): boolean | undefined {
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'boolean' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Copies valid values from the pre-Phase-0 aggregate key without replacing a
 * value already written in the per-flag format. The legacy key is removed only
 * after every valid override can be read from its destination key; otherwise
 * it remains available as a fallback on the next load.
 */
function migrateLegacyOverrides(
  storage: Storage
): Partial<Record<FlagKey, boolean>> {
  let raw: string | null;
  try {
    raw = storage.getItem(LEGACY_OVERRIDE_STORAGE_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};

  const legacy = parseOverrides(raw);
  let migrationComplete = true;
  for (const definition of listFlagDefinitions()) {
    const legacyValue = legacy[definition.key];
    if (legacyValue === undefined) continue;
    try {
      const key = overrideStorageKey(definition.key);
      const currentValue = parseStoredOverride(storage.getItem(key));
      if (currentValue === undefined) {
        storage.setItem(key, JSON.stringify(legacyValue));
      }
      if (parseStoredOverride(storage.getItem(key)) === undefined) {
        migrationComplete = false;
      }
    } catch {
      migrationComplete = false;
    }
  }

  if (migrationComplete) {
    try {
      storage.removeItem(LEGACY_OVERRIDE_STORAGE_KEY);
    } catch {
      // Leaving the legacy key is harmless: per-flag values take precedence.
    }
  }
  return legacy;
}

function readStoredOverrides(): Partial<Record<FlagKey, boolean>> {
  if (!areOverridesAllowed()) return {};
  const storage = getLocalStorage();
  if (!storage) return {};

  const legacy = migrateLegacyOverrides(storage);
  const current: Partial<Record<FlagKey, boolean>> = {};
  for (const definition of listFlagDefinitions()) {
    let stored: boolean | undefined;
    try {
      stored = parseStoredOverride(storage.getItem(overrideStorageKey(definition.key)));
    } catch {
      stored = undefined;
    }
    const value = stored ?? legacy[definition.key];
    if (value !== undefined) current[definition.key] = value;
  }
  return current;
}

function handleStorageChange(event: StorageEvent): void {
  const storage = getLocalStorage();
  if (event.storageArea && storage && event.storageArea !== storage) return;
  if (
    event.key !== null &&
    event.key !== LEGACY_OVERRIDE_STORAGE_KEY &&
    flagFromStorageKey(event.key) === null
  ) {
    return;
  }
  // The event has already committed in the source tab. Drop the complete
  // snapshot so a clear event, a legacy migration, and a per-flag change all
  // converge through the same storage read.
  overrides = null;
  invalidate();
}

function ensureStorageListener(): void {
  if (storageListenerInstalled || typeof globalThis.addEventListener !== 'function') return;
  globalThis.addEventListener('storage', handleStorageChange);
  storageListenerInstalled = true;
}

function readOverrides(): Partial<Record<FlagKey, boolean>> {
  ensureStorageListener();
  if (overrides) return overrides;
  overrides = readStoredOverrides();
  return overrides;
}

function persistOverride(key: FlagKey, value: boolean | undefined): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    const storageKey = overrideStorageKey(key);
    if (value === undefined) {
      storage.removeItem(storageKey);
    } else {
      storage.setItem(storageKey, JSON.stringify(value));
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
  ensureStorageListener();
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
  persistOverride(key, value);
  const current = readStoredOverrides();
  current[key] = value;
  overrides = current;
  invalidate();
}

/** Removes an override so the flag falls back to env/default. */
export function clearFlagOverride(key: FlagKey): void {
  getFlagDefinition(key); // rejects unknown keys
  const current = readStoredOverrides();
  if (!(key in current)) return;
  persistOverride(key, undefined);
  delete current[key];
  overrides = current;
  invalidate();
}

export function clearAllFlagOverrides(): void {
  const storage = getLocalStorage();
  if (storage) {
    for (const definition of listFlagDefinitions()) {
      try {
        storage.removeItem(overrideStorageKey(definition.key));
      } catch {
        // Keep clearing the remaining independent keys when one removal fails.
      }
    }
    try {
      storage.removeItem(LEGACY_OVERRIDE_STORAGE_KEY);
    } catch {
      // The in-memory session can still be cleared when storage is unavailable.
    }
  }
  overrides = {};
  invalidate();
}

/** Test seam: drops cached state so a fresh `localStorage` is re-read. */
export function resetFlagCacheForTests(): void {
  overrides = null;
  snapshot = null;
}
