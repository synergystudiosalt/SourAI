import { describe, expect, it } from 'vitest';
import { buildOpenAICompatibleBody, MODEL_ROUTES, resolveModelRoute } from '@/functions/shared/ai';
import { EFFORT_PROFILES } from '@/functions/shared/effortProfile';

const MESSAGES = [{ role: 'user', content: 'hi' }];

function bodyFor(effortId: keyof typeof EFFORT_PROFILES, reasoning: 'openai_effort' | null) {
  const p = EFFORT_PROFILES[effortId];
  return buildOpenAICompatibleBody(
    'some-model',
    MESSAGES,
    'system',
    {
      temperature: p.temperature,
      openAiEffort: p.openAiEffort,
    },
    reasoning
  );
}

describe('buildOpenAICompatibleBody', () => {
  it('carries temperature from the effort profile', () => {
    const light = bodyFor('light', null);
    const ultra = bodyFor('ultracode', null);

    expect(light.temperature).toBe(EFFORT_PROFILES.light.temperature);
    expect(ultra.temperature).toBe(EFFORT_PROFILES.ultracode.temperature);
    // The whole point: two efforts must not produce the same request.
    expect(light.temperature).not.toBe(ultra.temperature);
  });

  // Capping output truncated whole-file edits mid-token, and recovering from
  // that relied on the model continuing a prefill turn, which Mistral refused.
  it('never caps output tokens, so a long file cannot be truncated', () => {
    for (const id of ['light', 'standard', 'deep', 'ultracode'] as const) {
      expect('max_tokens' in bodyFor(id, null)).toBe(false);
    }
  });

  it('sends reasoning_effort only for routes that declare support', () => {
    expect(bodyFor('ultracode', 'openai_effort').reasoning_effort).toBe('high');
    expect(bodyFor('light', 'openai_effort').reasoning_effort).toBe('low');
    expect('reasoning_effort' in bodyFor('ultracode', null)).toBe(false);
  });

  it('omits tuning fields entirely when no tuning is supplied', () => {
    const body = buildOpenAICompatibleBody('m', MESSAGES, 'system', undefined, 'openai_effort');
    expect('temperature' in body).toBe(false);
    expect('max_tokens' in body).toBe(false);
    expect('reasoning_effort' in body).toBe(false);
  });

  it('prepends the system instruction ahead of the conversation', () => {
    const body = buildOpenAICompatibleBody('m', MESSAGES, 'SYS', undefined, null);
    expect((body.messages as any[])[0]).toEqual({ role: 'system', content: 'SYS' });
    expect((body.messages as any[])[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('merges extra fields such as the stream flag', () => {
    const body = buildOpenAICompatibleBody('m', MESSAGES, 'SYS', undefined, null, { stream: true });
    expect(body.stream).toBe(true);
  });
});

describe('model route reasoning capability', () => {
  it('declares a control only where the provider matches', () => {
    for (const route of Object.values(MODEL_ROUTES)) {
      if (route.reasoning === 'gemini_thinking') expect(route.provider).toBe('gemini');
      if (route.reasoning === 'openai_effort') expect(route.provider).not.toBe('gemini');
    }
  });

  it('falls back to a known route for unrecognised models', () => {
    expect(resolveModelRoute('nope')).toBe(MODEL_ROUTES['sour-omni-flash']);
    expect(resolveModelRoute(undefined)).toBe(MODEL_ROUTES['sour-omni-flash']);
  });
});
