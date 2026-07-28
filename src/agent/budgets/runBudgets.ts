import { SourError } from '../../contracts/errors';

export interface RunBudgetLimits {
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly maxRuntimeMs: number;
  readonly maxContextTokens: number;
  readonly maxOutputTokens: number;
  readonly maxEstimatedCostUsd: number;
}

export interface RunBudgetUsage {
  readonly turns: number;
  readonly toolCalls: number;
  readonly contextTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly elapsedMs: number;
}

export const DEFAULT_RUN_BUDGETS: RunBudgetLimits = Object.freeze({
  maxTurns: 12,
  maxToolCalls: 32,
  maxRuntimeMs: 10 * 60_000,
  maxContextTokens: 120_000,
  maxOutputTokens: 24_000,
  maxEstimatedCostUsd: 10,
});

type Counter = Exclude<keyof RunBudgetUsage, 'elapsedMs'>;

export class RunBudget {
  private readonly startedAt: number;
  private counters: Record<Counter, number> = {
    turns: 0,
    toolCalls: 0,
    contextTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };

  constructor(
    readonly limits: RunBudgetLimits = DEFAULT_RUN_BUDGETS,
    private readonly now: () => number = Date.now,
  ) {
    validateLimits(limits);
    this.startedAt = now();
  }

  consume(counter: Counter, amount = 1): void {
    if (!Number.isFinite(amount) || amount < 0) {
      throw budgetError('budget_usage_invalid', `Invalid ${counter} usage.`);
    }
    const next = this.counters[counter] + amount;
    const limit = limitFor(this.limits, counter);
    if (next > limit) throw exhausted(counter, limit);
    this.counters = { ...this.counters, [counter]: next };
    this.assertRuntime();
  }

  assertContext(tokens: number): void {
    if (!Number.isSafeInteger(tokens) || tokens < 0) {
      throw budgetError('budget_usage_invalid', 'Invalid context token estimate.');
    }
    this.counters = { ...this.counters, contextTokens: tokens };
    if (tokens > this.limits.maxContextTokens) {
      throw exhausted('contextTokens', this.limits.maxContextTokens);
    }
    this.assertRuntime();
  }

  assertRuntime(): void {
    if (this.now() - this.startedAt > this.limits.maxRuntimeMs) {
      throw exhausted('elapsedMs', this.limits.maxRuntimeMs);
    }
  }

  snapshot(): RunBudgetUsage {
    return Object.freeze({
      ...this.counters,
      elapsedMs: Math.max(0, this.now() - this.startedAt),
    });
  }
}

function limitFor(limits: RunBudgetLimits, counter: Counter): number {
  switch (counter) {
    case 'turns': return limits.maxTurns;
    case 'toolCalls': return limits.maxToolCalls;
    case 'contextTokens': return limits.maxContextTokens;
    case 'outputTokens': return limits.maxOutputTokens;
    case 'estimatedCostUsd': return limits.maxEstimatedCostUsd;
  }
}

function validateLimits(limits: RunBudgetLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value < 0) {
      throw budgetError('budget_limit_invalid', `Invalid run budget: ${name}.`);
    }
  }
}

function exhausted(kind: keyof RunBudgetUsage, limit: number): SourError {
  return budgetError('run_budget_exhausted', `The run exceeded its ${kind} budget.`, {
    kind,
    limit,
  });
}

function budgetError(code: string, message: string, details?: Record<string, unknown>): SourError {
  return new SourError({
    code,
    message,
    causeCategory: 'policy',
    retryable: false,
    userAction: 'Increase the run budget or reduce the requested scope.',
    details,
  });
}
