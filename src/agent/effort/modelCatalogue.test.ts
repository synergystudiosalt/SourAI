import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTE,
  LEGACY_MODEL_IDS,
  migrateModelId,
  MODEL_IDS,
  MODEL_ROUTES,
  resolveModelRoute,
} from '@/functions/shared/ai';
import type { AIModel } from '../../types';

const SELECTABLE_MODEL_IDS: readonly AIModel[] = MODEL_IDS;

describe('model catalogue', () => {
  it('defines exactly the selectable lineup in tier order', () => {
    expect(SELECTABLE_MODEL_IDS).toEqual([
      'sour-omni-flash',
      'sour-intelligence',
      'sour-velocity',
      'sour-lumen',
      'sour-overdrive',
    ]);
    expect(MODEL_ROUTES).toEqual({
      'sour-omni-flash': {
        label: 'Omni-Flash 3.0',
        provider: 'mistral',
        model: 'mistral-small-latest',
        reasoning: null,
        prefill: 'mistral',
      },
      'sour-intelligence': {
        label: 'Intelligence 3.0',
        provider: 'groq',
        model: 'qwen/qwen3.6-27b',
        reasoning: null,
        prefill: 'openai',
      },
      'sour-velocity': {
        label: 'Velocity 2.0',
        provider: 'cerebras',
        model: 'zai-glm-4.7',
        reasoning: null,
        prefill: 'openai',
      },
      'sour-lumen': {
        label: 'Lumen 1.5',
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        reasoning: 'gemini_thinking',
        prefill: null,
      },
      'sour-overdrive': {
        label: 'Overdrive 4.0',
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        reasoning: 'gemini_thinking',
        prefill: null,
      },
    });
  });

  it('resolves every selectable AIModel union member', () => {
    for (const id of SELECTABLE_MODEL_IDS) {
      expect(resolveModelRoute(id)).toBe(MODEL_ROUTES[id]);
    }
  });

  it('has unique, non-empty display labels', () => {
    const labels = SELECTABLE_MODEL_IDS.map((id) => MODEL_ROUTES[id].label);
    expect(labels.every((label) => label.trim().length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('defines all legacy ID replacements', () => {
    expect(LEGACY_MODEL_IDS).toEqual({
      'sour-overclock': 'sour-velocity',
      'sour-ultra': 'sour-lumen',
      'sour-overcode': 'sour-overdrive',
    });
  });

  it.each([
    ['sour-overclock', 'sour-velocity'],
    ['sour-ultra', 'sour-lumen'],
    ['sour-overcode', 'sour-overdrive'],
  ] as const)('migrates legacy id %s to %s', (legacyId, currentId) => {
    expect(migrateModelId(legacyId)).toBe(currentId);
    expect(resolveModelRoute(legacyId)).toBe(MODEL_ROUTES[currentId]);
  });

  it('uses sour-omni-flash as the default route', () => {
    expect(DEFAULT_ROUTE).toBe(MODEL_ROUTES['sour-omni-flash']);
    expect(resolveModelRoute('unknown-model')).toBe(DEFAULT_ROUTE);
    expect(resolveModelRoute(undefined)).toBe(DEFAULT_ROUTE);
  });
});
