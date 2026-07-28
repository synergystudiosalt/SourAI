import { describe, expect, it } from 'vitest';
import { RunBudget } from './runBudgets';

const limits = {
  maxTurns: 1,
  maxToolCalls: 1,
  maxRuntimeMs: 10,
  maxContextTokens: 10,
  maxOutputTokens: 2,
  maxEstimatedCostUsd: 1,
};

describe('RunBudget', () => {
  it('enforces every bounded resource before accepting overage', () => {
    const budget = new RunBudget(limits, () => 0);
    budget.consume('turns');
    budget.consume('outputTokens', 2);
    budget.assertContext(10);
    expect(() => budget.consume('turns')).toThrow(/turns budget/);
    expect(() => budget.consume('outputTokens')).toThrow(/outputTokens budget/);
    expect(() => budget.assertContext(11)).toThrow(/contextTokens budget/);
  });

  it('enforces elapsed time with an injected monotonic clock', () => {
    let now = 0;
    const budget = new RunBudget(limits, () => now);
    now = 11;
    expect(() => budget.assertRuntime()).toThrow(/elapsedMs budget/);
  });
});
