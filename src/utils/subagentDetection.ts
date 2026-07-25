/**
 * Subagent detection and orchestration
 * Implements parent→subagent hierarchy with mandatory approval gates,
 * visible thinking, context tracking, and error checking.
 */

export interface SubagentPlan {
  task: string;
  type: 'code' | 'analysis' | 'research' | 'test' | 'doc';
  risk: 'low' | 'medium' | 'high' | 'critical';
  constraints: string[];
  approvalLevel: 'auto' | 'manual' | 'critical';
  estimatedContextTokens: number;
}

export interface SubagentResult {
  status: 'success' | 'error' | 'partial';
  thinking: string;
  actions: string[];
  errors: string[];
  output: string;
  contextUsed: number;
}

/**
 * Detect if a request should use subagents based on complexity and risk.
 * Never auto-spawns — always requires parent approval.
 */
export function shouldUseSubagents(userRequest: string): boolean {
  const plan = planSubagent(userRequest);
  return plan !== null;
}

/**
 * Plan a subagent delegation with risk assessment and constraints.
 * Returns null if the task is too simple for subagent delegation.
 */
export function planSubagent(task: string): SubagentPlan | null {
  const lower = task.toLowerCase();
  const wordCount = task.split(/\s+/).length;

  // Only suggest subagents for substantial, multi-part tasks
  if (wordCount < 8) return null;

  // Determine type
  let type: SubagentPlan['type'] = 'code';
  if (lower.includes('research') || lower.includes('find') || lower.includes('search')) type = 'research';
  else if (lower.includes('test') || lower.includes('spec')) type = 'test';
  else if (lower.includes('doc') || lower.includes('readme') || lower.includes('comment')) type = 'doc';
  else if (lower.includes('analyze') || lower.includes('review') || lower.includes('audit')) type = 'analysis';

  // Determine risk level
  let risk: SubagentPlan['risk'] = 'low';
  if (lower.includes('delete') || lower.includes('remove') || lower.includes('migrate')) risk = 'high';
  if (lower.includes('critical') || lower.includes('security') || lower.includes('auth') || lower.includes('database')) risk = 'critical';
  else if (lower.includes('refactor') || lower.includes('restructure') || lower.includes('rewrite')) risk = 'medium';

  // Constraints
  const constraints: string[] = [];
  constraints.push('Show all reasoning in <think> tags');
  constraints.push('Check context before starting');
  constraints.push('Run <check_for_errors> before reporting');
  if (risk === 'high' || risk === 'critical') constraints.push('No auto-execute — wait for parent approval');

  // Approval level
  let approvalLevel: SubagentPlan['approvalLevel'] = 'manual';
  if (risk === 'critical') approvalLevel = 'critical';
  else if (risk === 'low') approvalLevel = 'auto';

  // Estimate context (rough: 1 token ~= 4 chars)
  const estimatedContextTokens = Math.min(Math.ceil(task.length / 4) + 500, 100_000);

  return { task, type, risk, constraints, approvalLevel, estimatedContextTokens };
}

/**
 * Format a subagent task for delegation with full context.
 */
export function formatSubagentPrompt(originalRequest: string, plan: SubagentPlan): string {
  const lines = [
    `As part of a larger request, complete this delegated task:`,
    ``,
    `## Task`,
    plan.task,
    ``,
    `## Type`,
    plan.type,
    ``,
    `## Risk Level`,
    plan.risk.toUpperCase(),
    ``,
    `## Constraints`,
    ...plan.constraints.map(c => `- ${c}`),
    ``,
    `## Context`,
    `This is part of: "${originalRequest.slice(0, 500)}"`,
    ``,
    `## Required Format`,
    `- Wrap all reasoning in <think> tags`,
    `- Report all actions taken`,
    `- Run <check_for_errors> before finishing`,
    `- Return status: success | error | partial`,
    `- Report context usage`,
  ];
  return lines.join('\n');
}

/**
 * Validate a subagent result meets the required format.
 */
export function validateSubagentResult(result: Partial<SubagentResult>): result is SubagentResult {
  if (!result.status || !['success', 'error', 'partial'].includes(result.status)) return false;
  if (typeof result.thinking !== 'string') return false;
  if (!Array.isArray(result.actions)) return false;
  if (!Array.isArray(result.errors)) return false;
  if (typeof result.output !== 'string') return false;
  if (typeof result.contextUsed !== 'number') return false;
  return true;
}

/**
 * Check if parallel subagent execution is safe.
 * Never allows true parallelism — subagents run sequentially with parent oversight.
 */
export function canRunSequentially(tasks: string[]): boolean {
  // All subagents run sequentially, not in parallel
  return true;
}

/**
 * Estimate context impact of running a subagent.
 */
export function estimateContextImpact(plan: SubagentPlan): { current: number; after: number; wouldExceed: boolean } {
  const current = plan.estimatedContextTokens;
  const after = current + 2000; // overhead for delegation/response
  return {
    current,
    after,
    wouldExceed: after > 90_000,
  };
}

/**
 * Generate a structured error report for a failed subagent.
 */
export function buildSubagentError(task: string, error: string): SubagentResult {
  return {
    status: 'error',
    thinking: `Task failed: ${error}`,
    actions: ['Attempted to execute delegated task'],
    errors: [error],
    output: '',
    contextUsed: 0,
  };
}
