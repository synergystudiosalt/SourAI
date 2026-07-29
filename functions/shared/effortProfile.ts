/**
 * Reasoning-effort profiles.
 *
 * The effort slider used to be almost cosmetic: it capped the agent tool loop
 * and appended a sentence to the system prompt, but every actual generation
 * parameter was hardcoded. This module is the single source of truth that
 * turns the selected effort into real, observable behaviour:
 *
 * - `maxTurns`      - how long the agent tool loop may run
 * - `temperature`   - falls as effort rises, for more deterministic edits
 * - `openAiEffort`  - the provider's own reasoning control, where offered
 * - `context`       - how much of the project is sent in the first place
 *
 * There is deliberately no output-token knob and no Gemini thinking budget.
 * Capping output truncated whole-file edits mid-token. Reserving a thinking
 * budget was worse: Gemini charges thinking against the same output budget, so
 * the allowance consumed the entire reply. Measured on one payload, Light
 * (budget 0) returned 162 characters where Standard, Deep and UltraCODE
 * returned 0, 18 and 0. Providers use their own defaults; effort scales what
 * goes in and how long the loop runs, not how much the model may say.
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
  /** OpenAI-compatible `reasoning_effort`, for models that accept it. */
  readonly openAiEffort: 'low' | 'medium' | 'high';
  readonly context: EffortContextBudget;
}

export const EFFORT_PROFILES: Record<AgentReasoningEffort, EffortProfile> = {
  light: {
    id: 'light',
    label: 'Light',
    description: 'Fast answers and small edits',
    maxTurns: 3,
    temperature: 0.45,
    openAiEffort: 'low',
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
    openAiEffort: 'medium',
    context: {
      activeFileChars: 6000,
      mentionedFileChars: 4000,
      maxProjectFiles: 200,
      historyMessages: 22,
    },
  },
  deep: {
    id: 'deep',
    label: 'Deep',
    description: 'More analysis and verification',
    maxTurns: 8,
    temperature: 0.2,
    openAiEffort: 'high',
    context: {
      activeFileChars: 7500,
      mentionedFileChars: 5000,
      maxProjectFiles: 275,
      historyMessages: 27,
    },
  },
  ultracode: {
    id: 'ultracode',
    label: 'UltraCODE',
    description: 'Maximum coding rigor',
    maxTurns: 12,
    temperature: 0.15,
    openAiEffort: 'high',
    context: {
      // Sized so one request stays inside a modest free-tier budget. Groq's
      // on-demand tier caps at 8000 tokens per minute, and an UltraCODE
      // request was measured at 9599 — over the entire per-minute allowance
      // on its own, which fails as a 413 that no retry or key rotation can
      // help. History is what grows per turn, so it is held tightest.
      activeFileChars: 9000,
      mentionedFileChars: 6000,
      maxProjectFiles: 350,
      historyMessages: 32,
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
