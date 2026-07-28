/**
 * Reasoning-effort profiles.
 *
 * The effort slider used to be almost cosmetic: it capped the agent tool loop
 * and appended a sentence to the system prompt, but every actual generation
 * parameter was hardcoded. This module is the single source of truth that
 * turns the selected effort into real, observable behaviour:
 *
 * - `maxTurns`        - how long the agent tool loop may run
 * - `temperature`     - falls as effort rises, for more deterministic edits
 * - `maxOutputTokens` - rises as effort rises, so long edits aren't truncated
 * - `openAiEffort` /
 *   `thinkingBudget`  - the provider's own reasoning control
 * - `context`         - how much of the project is sent in the first place
 *
 * Shared by the Pages Function and the client (via the `@/` root alias) so the
 * two can never drift apart.
 */

export type AgentReasoningEffort = 'light' | 'standard' | 'deep' | 'ultracode';

export interface EffortContextBudget {
  /** Characters of the currently open file to include. */
  readonly activeFileChars: number;
  /** Characters of each @-mentioned file to include. */
  readonly mentionedFileChars: number;
  /** How many project paths to list in the context block. */
  readonly maxProjectFiles: number;
  /** How many prior chat messages to replay. */
  readonly historyMessages: number;
}

export interface EffortProfile {
  readonly id: AgentReasoningEffort;
  readonly label: string;
  readonly description: string;
  readonly maxTurns: number;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  /** OpenAI-compatible `reasoning_effort`, for models that accept it. */
  readonly openAiEffort: 'low' | 'medium' | 'high';
  /**
   * Gemini `thinkingConfig.thinkingBudget`, in tokens.
   * 0 disables thinking entirely, which is what makes Light genuinely faster.
   */
  readonly thinkingBudget: number;
  readonly context: EffortContextBudget;
}

export const EFFORT_PROFILES: Record<AgentReasoningEffort, EffortProfile> = {
  light: {
    id: 'light',
    label: 'Light',
    description: 'Fast answers and small edits',
    maxTurns: 3,
    temperature: 0.45,
    maxOutputTokens: 2048,
    openAiEffort: 'low',
    thinkingBudget: 0,
    context: {
      activeFileChars: 4000,
      mentionedFileChars: 3000,
      maxProjectFiles: 120,
      historyMessages: 16,
    },
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    description: 'Balanced coding workflow',
    maxTurns: 6,
    temperature: 0.3,
    maxOutputTokens: 4096,
    openAiEffort: 'medium',
    thinkingBudget: 2048,
    context: {
      activeFileChars: 8000,
      mentionedFileChars: 6000,
      maxProjectFiles: 300,
      historyMessages: 40,
    },
  },
  deep: {
    id: 'deep',
    label: 'Deep',
    description: 'More analysis and verification',
    maxTurns: 8,
    temperature: 0.2,
    maxOutputTokens: 6144,
    openAiEffort: 'high',
    thinkingBudget: 8192,
    context: {
      activeFileChars: 14000,
      mentionedFileChars: 10000,
      maxProjectFiles: 500,
      historyMessages: 60,
    },
  },
  ultracode: {
    id: 'ultracode',
    label: 'UltraCODE',
    description: 'Maximum coding rigor',
    maxTurns: 12,
    temperature: 0.15,
    // Kept at a ceiling every provider accepts. Asking for more risks a 400 on
    // models with an 8k output limit, and long generations are carried by
    // stream continuation rather than by a bigger single cap.
    maxOutputTokens: 8192,
    openAiEffort: 'high',
    thinkingBudget: 24576,
    context: {
      activeFileChars: 24000,
      mentionedFileChars: 16000,
      maxProjectFiles: 800,
      historyMessages: 80,
    },
  },
};

/** Ordered fastest -> most rigorous. Drives the slider position. */
export const EFFORT_ORDER: readonly AgentReasoningEffort[] = [
  'light',
  'standard',
  'deep',
  'ultracode',
];

export function isAgentReasoningEffort(value: unknown): value is AgentReasoningEffort {
  // `in` would walk the prototype chain and accept 'toString', 'constructor',
  // etc., which resolves to a function rather than a profile.
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EFFORT_PROFILES, value);
}

/** Never throws: unknown input falls back to the balanced profile. */
export function resolveEffortProfile(value: unknown): EffortProfile {
  return isAgentReasoningEffort(value) ? EFFORT_PROFILES[value] : EFFORT_PROFILES.standard;
}
