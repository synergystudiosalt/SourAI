import { SourError } from '../../contracts/errors';
import type { AgentProfile, ToolRisk } from '../tools/types';

export type ToolPolicyDecision = 'allow' | 'require-approval';

/**
 * Capability policy is enforced independently of UI state and approval state.
 * Ask and Plan can therefore never be upgraded into mutating profiles by a
 * malicious provider call or a forged "approved" flag.
 */
export function authorizeTool(profile: AgentProfile, risk: ToolRisk): ToolPolicyDecision {
  if (risk === 'read') return 'allow';
  if (profile === 'write') return 'require-approval';
  throw new SourError({
    code: 'tool_forbidden_for_profile',
    message: `${profile === 'ask' ? 'Ask' : 'Plan'} profile cannot propose workspace mutations.`,
    causeCategory: 'policy',
    retryable: false,
    details: { profile, risk },
  });
}
