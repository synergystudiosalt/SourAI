/**
 * What the assembled runtime can actually do, reported to the UI at startup.
 *
 * Every field describes a verified condition of *this* composition. Nothing is
 * inferred from a feature flag: a flag can only turn a capability off, never
 * assert that it works.
 */

export interface CapabilityStatus {
  readonly available: boolean;
  readonly detail: string;
}

export interface AgentCapabilityReportV1 {
  readonly version: 1;
  readonly storage: CapabilityStatus;
  readonly filesystem: CapabilityStatus;
  readonly provider: CapabilityStatus;
  readonly tools: CapabilityStatus;
  readonly toolNames: readonly string[];
  readonly mutation: CapabilityStatus;
  readonly egress: {
    readonly kind: 'local' | 'remote';
    readonly host?: string;
    readonly label: string;
  };
  readonly context: {
    readonly fileCount: number;
    readonly totalBytes: number;
    readonly excludedCount: number;
    readonly truncated: boolean;
  };
}

export function degradedReport(reason: string): AgentCapabilityReportV1 {
  const unavailable: CapabilityStatus = Object.freeze({ available: false, detail: reason });
  return Object.freeze({
    version: 1,
    storage: unavailable,
    filesystem: unavailable,
    provider: unavailable,
    tools: unavailable,
    toolNames: Object.freeze([]),
    mutation: Object.freeze({
      available: false,
      detail: 'Mutation tools are not enabled in this phase.',
    }),
    egress: Object.freeze({ kind: 'local' as const, label: 'this browser' }),
    context: Object.freeze({ fileCount: 0, totalBytes: 0, excludedCount: 0, truncated: false }),
  });
}
