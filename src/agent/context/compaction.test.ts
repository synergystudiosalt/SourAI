import { describe, expect, it } from 'vitest';
import {
  applyCompaction,
  buildCompactionRequest,
  DEFAULT_KEEP_RECENT,
  estimateHistoryTokens,
  estimateTokens,
  planCompaction,
  SUMMARY_PREFIX,
  type CompactableMessage,
} from './compaction';

const msg = (role: 'user' | 'assistant', content: string): CompactableMessage => ({ role, content });
/** Roughly `tokens` worth of text, via the four-chars-per-token estimate. */
const bulk = (tokens: number) => 'x'.repeat(tokens * 4);

describe('estimateTokens', () => {
  it('approximates four characters per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('charges per-message overhead the provider adds for roles', () => {
    expect(estimateHistoryTokens([msg('user', 'abcd')])).toBe(5);
    expect(estimateHistoryTokens([])).toBe(0);
  });
});

describe('planCompaction', () => {
  const long = Array.from({ length: 12 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', bulk(200)));

  it('does nothing while the history fits', () => {
    const plan = planCompaction([msg('user', 'hi')], { budgetTokens: 5000 });
    expect(plan.needed).toBe(false);
    expect(plan.keep).toHaveLength(1);
    expect(plan.summarise).toEqual([]);
  });

  it('compacts once the history no longer fits', () => {
    const plan = planCompaction(long, { budgetTokens: 500 });
    expect(plan.needed).toBe(true);
    expect(plan.summarise.length).toBe(long.length - DEFAULT_KEEP_RECENT);
    expect(plan.keep).toHaveLength(DEFAULT_KEEP_RECENT);
  });

  it('always keeps the most recent turns verbatim', () => {
    const plan = planCompaction(long, { budgetTokens: 500, keepRecent: 3 });
    expect(plan.keep).toEqual(long.slice(-3));
    // Nothing is both summarised and kept.
    expect(plan.summarise).toEqual(long.slice(0, -3));
  });

  // The system prompt and file context are rebuilt every turn and cannot be
  // compacted, so the history has to fit in what is left after them.
  it('subtracts fixed overhead from the budget', () => {
    const history = [msg('user', bulk(300)), msg('assistant', bulk(300))];
    expect(planCompaction(history, { budgetTokens: 5000 }).needed).toBe(false);
    const squeezed = planCompaction(history, { budgetTokens: 5000, fixedOverheadTokens: 4800 });
    expect(squeezed.availableTokens).toBe(200);
  });

  it('does not summarise when there is too little to be worth a request', () => {
    // Over budget, but everything is recent — a summarising call would cost
    // more than it saves and would discard the only context there is.
    const plan = planCompaction([msg('user', bulk(9000))], { budgetTokens: 100 });
    expect(plan.needed).toBe(false);
    expect(plan.keep).toHaveLength(1);
  });

  it('never drops a message: summarise and keep together cover the input', () => {
    const plan = planCompaction(long, { budgetTokens: 500 });
    expect([...plan.summarise, ...plan.keep]).toEqual(long);
  });

  it('reports an overhead larger than the budget as zero, not negative', () => {
    const plan = planCompaction(long, { budgetTokens: 100, fixedOverheadTokens: 900 });
    expect(plan.availableTokens).toBe(0);
    expect(plan.needed).toBe(true);
  });
});

describe('buildCompactionRequest', () => {
  it('labels each turn so the summariser can follow who said what', () => {
    const [request] = buildCompactionRequest([msg('user', 'add a car'), msg('assistant', 'done')]);
    expect(request.role).toBe('user');
    expect(request.content).toContain('User: add a car');
    expect(request.content).toContain('Assistant: done');
  });

  it('asks for the things worth carrying forward', () => {
    const [request] = buildCompactionRequest([msg('user', 'x')]);
    expect(request.content).toMatch(/file path/i);
    expect(request.content).toMatch(/tried and failed/i);
    expect(request.content).toMatch(/not done yet/i);
  });
});

describe('applyCompaction', () => {
  const keep = [msg('user', 'latest')];

  it('prefixes the summary so it reads as context, not as something said', () => {
    const out = applyCompaction('They chose Three.js.', keep);
    expect(out[0].content.startsWith(SUMMARY_PREFIX)).toBe(true);
    expect(out[0].content).toContain('They chose Three.js.');
    expect(out[1]).toEqual(keep[0]);
  });

  // If the summarising request failed, losing older context is recoverable;
  // claiming a summary exists when it does not is worse than saying nothing.
  it('inserts nothing when the summary is empty or whitespace', () => {
    expect(applyCompaction('', keep)).toEqual(keep);
    expect(applyCompaction('   \n ', keep)).toEqual(keep);
  });

  it('shrinks the history it replaces', () => {
    const long = Array.from({ length: 12 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', bulk(200)));
    const plan = planCompaction(long, { budgetTokens: 500 });
    const compacted = applyCompaction('A short summary of what happened.', plan.keep);
    expect(estimateHistoryTokens(compacted)).toBeLessThan(estimateHistoryTokens(long));
  });
});
