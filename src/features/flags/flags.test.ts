import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SourError } from '../../contracts/errors';
import {
  clearAllFlagOverrides,
  clearFlagOverride,
  getFlagDefinition,
  getFlagsSnapshot,
  isEnabled,
  listFlagDefinitions,
  parseEnvFlag,
  resetFlagCacheForTests,
  resolveFlag,
  setFlagOverride,
  subscribeToFlags,
} from './index';

const LEGACY_OVERRIDE_STORAGE_KEY = 'sour_flag_overrides';
const overrideStorageKey = (key: string) => `sour_flag_override:${key}`;

beforeEach(() => {
  resetFlagCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetFlagCacheForTests();
});

describe('parseEnvFlag', () => {
  it('accepts only the documented truthy and falsy spellings', () => {
    for (const value of ['true', 'TRUE', ' 1 ', 'on']) expect(parseEnvFlag(value)).toBe(true);
    for (const value of ['false', 'FALSE', '0', 'off']) expect(parseEnvFlag(value)).toBe(false);
  });

  it('falls through to the coded default for unset or unrecognised values', () => {
    // An unset Cloudflare Pages variable arrives as an empty string, which must
    // not be coerced to `false` — that would silently disable a default-on flag.
    for (const value of [undefined, '', 'yes', 'enabled', 'null']) {
      expect(parseEnvFlag(value)).toBeUndefined();
    }
  });
});

describe('registry', () => {
  it('has a unique key, an env var, and an owning phase for every flag', () => {
    const definitions = listFlagDefinitions();
    expect(definitions.length).toBeGreaterThan(0);
    expect(new Set(definitions.map((d) => d.key)).size).toBe(definitions.length);
    expect(new Set(definitions.map((d) => d.envVar)).size).toBe(definitions.length);
    for (const definition of definitions) {
      expect(definition.envVar).toMatch(/^VITE_/);
      expect(definition.phase).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(20);
    }
  });

  it('keeps every unfinished migration path off by default', () => {
    // A default-on flag for an unimplemented phase would ship a half-migrated
    // code path. Only `localFolderProjects` is on, and it already exists today.
    const defaultOn = listFlagDefinitions().filter((d) => d.defaultValue).map((d) => d.key);
    expect(defaultOn).toEqual(['clientAgentRuntime', 'localFolderProjects']);
  });

  it('rejects an unknown key', () => {
    // @ts-expect-error — deliberately outside the FlagKey union.
    expect(() => getFlagDefinition('nope')).toThrow(/Unknown feature flag/);
  });
});

describe('resolution order', () => {
  it('uses the coded default when nothing else is set', () => {
    const resolved = resolveFlag('webContainers');
    expect(resolved.source).toBe('default');
    expect(resolved.value).toBe(false);
  });

  it('prefers a build environment value over the default', async () => {
    vi.stubEnv('VITE_ENABLE_WEBLLM', 'true');
    vi.resetModules();
    const fresh = await import('./index');
    const resolved = fresh.resolveFlag('webllm');
    expect(resolved.source).toBe('env');
    expect(resolved.value).toBe(true);
  });

  it('prefers a runtime override over the build environment', async () => {
    vi.stubEnv('VITE_ENABLE_WEBLLM', 'true');
    vi.resetModules();
    const fresh = await import('./index');
    fresh.setFlagOverride('webllm', false);
    const resolved = fresh.resolveFlag('webllm');
    expect(resolved.source).toBe('override');
    expect(resolved.value).toBe(false);
    fresh.clearAllFlagOverrides();
  });
});

describe('overrides', () => {
  it('round-trips through storage and clears back to the default', () => {
    expect(isEnabled('pyodide')).toBe(false);
    setFlagOverride('pyodide', true);
    expect(isEnabled('pyodide')).toBe(true);

    resetFlagCacheForTests();
    expect(isEnabled('pyodide')).toBe(true); // survived a reload

    clearFlagOverride('pyodide');
    expect(resolveFlag('pyodide').source).toBe('default');
  });

  it('notifies subscribers and produces a new snapshot on change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToFlags(listener);
    const before = getFlagsSnapshot();

    setFlagOverride('remoteMcp', true);

    expect(listener).toHaveBeenCalledTimes(1);
    const after = getFlagsSnapshot();
    expect(after).not.toBe(before);
    expect(after.remoteMcp).toBe(true);
    unsubscribe();

    setFlagOverride('remoteMcp', false);
    expect(listener).toHaveBeenCalledTimes(1); // no longer subscribed
    clearAllFlagOverrides();
  });

  it('returns a referentially stable snapshot while nothing changes', () => {
    expect(getFlagsSnapshot()).toBe(getFlagsSnapshot());
  });

  it('refreshes cached flags when another tab changes override storage', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToFlags(listener);
    const before = getFlagsSnapshot();
    const storageKey = overrideStorageKey('webllm');

    window.localStorage.setItem(storageKey, 'true');
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: storageKey,
        newValue: 'true',
        storageArea: window.localStorage,
      })
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getFlagsSnapshot()).not.toBe(before);
    expect(resolveFlag('webllm')).toMatchObject({ source: 'override', value: true });
    unsubscribe();
  });

  it('keeps unrelated writes from two tabs that reached the write barrier with stale snapshots', async () => {
    vi.resetModules();
    const tabA = await import('./index');
    expect(tabA.resolveFlag('webllm').source).toBe('default');

    vi.resetModules();
    const tabB = await import('./index');
    expect(tabB.resolveFlag('pyodide').source).toBe('default');

    // Both module instances populated their caches before either write. Each
    // tab now commits an unrelated flag without a shared read-modify-write key.
    tabA.setFlagOverride('webllm', true);
    tabB.setFlagOverride('pyodide', true);

    expect(window.localStorage.getItem(overrideStorageKey('webllm'))).toBe('true');
    expect(window.localStorage.getItem(overrideStorageKey('pyodide'))).toBe('true');
    expect(window.localStorage.getItem(LEGACY_OVERRIDE_STORAGE_KEY)).toBeNull();

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: overrideStorageKey('pyodide'),
        newValue: 'true',
        storageArea: window.localStorage,
      })
    );
    expect(tabA.resolveFlag('webllm')).toMatchObject({ source: 'override', value: true });
    expect(tabA.resolveFlag('pyodide')).toMatchObject({ source: 'override', value: true });
  });

  it('migrates valid legacy aggregate values without replacing newer per-flag values', () => {
    window.localStorage.setItem(
      LEGACY_OVERRIDE_STORAGE_KEY,
      JSON.stringify({ webllm: true, pyodide: true })
    );
    window.localStorage.setItem(overrideStorageKey('webllm'), 'false');
    resetFlagCacheForTests();

    expect(resolveFlag('webllm')).toMatchObject({ source: 'override', value: false });
    expect(resolveFlag('pyodide')).toMatchObject({ source: 'override', value: true });
    expect(window.localStorage.getItem(overrideStorageKey('webllm'))).toBe('false');
    expect(window.localStorage.getItem(overrideStorageKey('pyodide'))).toBe('true');
    expect(window.localStorage.getItem(LEGACY_OVERRIDE_STORAGE_KEY)).toBeNull();
  });

  it('migrates a legacy write received from an older tab', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToFlags(listener);
    const legacy = JSON.stringify({ auditLog: true });
    window.localStorage.setItem(LEGACY_OVERRIDE_STORAGE_KEY, legacy);

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: LEGACY_OVERRIDE_STORAGE_KEY,
        newValue: legacy,
        storageArea: window.localStorage,
      })
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(resolveFlag('auditLog')).toMatchObject({ source: 'override', value: true });
    expect(window.localStorage.getItem(overrideStorageKey('auditLog'))).toBe('true');
    expect(window.localStorage.getItem(LEGACY_OVERRIDE_STORAGE_KEY)).toBeNull();
    unsubscribe();
  });

  it('ignores same-named storage events from sessionStorage', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToFlags(listener);
    window.sessionStorage.setItem(overrideStorageKey('webllm'), 'true');

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: overrideStorageKey('webllm'),
        newValue: 'true',
        storageArea: window.sessionStorage,
      })
    );

    expect(listener).not.toHaveBeenCalled();
    expect(resolveFlag('webllm').source).toBe('default');
    unsubscribe();
  });

  it('survives corrupt override storage without throwing', () => {
    window.localStorage.setItem(LEGACY_OVERRIDE_STORAGE_KEY, '{not json');
    resetFlagCacheForTests();
    expect(() => getFlagsSnapshot()).not.toThrow();
    expect(resolveFlag('webllm').source).toBe('default');
    expect(window.localStorage.getItem(LEGACY_OVERRIDE_STORAGE_KEY)).toBeNull();
  });

  it('ignores non-boolean values found in override storage', () => {
    window.localStorage.setItem(
      LEGACY_OVERRIDE_STORAGE_KEY,
      JSON.stringify({ webllm: 'true', pyodide: true })
    );
    resetFlagCacheForTests();
    expect(resolveFlag('webllm').source).toBe('default');
    expect(resolveFlag('pyodide').source).toBe('override');
    expect(window.localStorage.getItem(overrideStorageKey('webllm'))).toBeNull();
    expect(window.localStorage.getItem(overrideStorageKey('pyodide'))).toBe('true');
  });

  it('refuses overrides when the build forbids them', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_ALLOW_FLAG_OVERRIDES', 'false');
    vi.resetModules();
    const fresh = await import('./index');

    expect(fresh.areOverridesAllowed()).toBe(false);
    // `vi.resetModules()` gives the re-imported module its own copy of every
    // dependency, so the thrown SourError is not an instance of the class this
    // file imported. Assert on the contract instead of on class identity.
    expect(() => fresh.setFlagOverride('webllm', true)).toThrow(/fixed at build time/);
    try {
      fresh.setFlagOverride('webllm', true);
      expect.unreachable('setFlagOverride should have thrown');
    } catch (error) {
      const data = (error as SourError).toData();
      expect(data.code).toBe('flag_override_forbidden');
      expect(data.causeCategory).toBe('policy');
      expect(data.retryable).toBe(false);
    }
    expect(fresh.isEnabled('webllm')).toBe(false);
  });

  it('ignores overrides already present in storage when the build forbids them', async () => {
    window.localStorage.setItem(
      LEGACY_OVERRIDE_STORAGE_KEY,
      JSON.stringify({ webContainers: true })
    );
    window.localStorage.setItem(overrideStorageKey('webllm'), 'true');
    vi.stubEnv('DEV', false);
    vi.resetModules();
    const fresh = await import('./index');

    expect(fresh.resolveFlag('webContainers').source).toBe('default');
    expect(fresh.isEnabled('webContainers')).toBe(false);
    expect(fresh.resolveFlag('webllm').source).toBe('default');
    // A production build ignores developer overrides without rewriting user
    // storage, so a later explicitly enabled preview can still migrate it.
    expect(window.localStorage.getItem(LEGACY_OVERRIDE_STORAGE_KEY)).not.toBeNull();
  });
});
