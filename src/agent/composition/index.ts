import { SourError } from '../../contracts/errors';
import { SnapshotWorkspaceFileSystem } from '../../filesystem/snapshot/SnapshotWorkspaceFileSystem';
import type { WorkspaceFileSystem } from '../../filesystem';
import type { RunBudgetLimits } from '../budgets';
import { ContextScope } from '../context/scope';
import type { WorkspaceSnapshotV1 } from '../context/snapshot';
import { createProviderFromCatalog, findCatalogEntry, type CustomEndpointConsent } from '../providers/catalog';
import type { AgentProvider } from '../providers/types';
import type { RuntimeEventSink } from '../replay';
import { AgentRuntime } from '../runtime';
import type { MutationReviewGate } from '../runtime/types';
import { READ_ONLY_TOOLS } from '../tools/readOnly';
import { MUTATION_TOOLS } from '../tools/mutationTools';
import { ToolRegistry } from '../tools/registry';
import type { Diagnostic } from '../tools/types';
import type { AgentCapabilityReportV1 } from './capabilities';
import { createRuntimeProvider, describeDestination } from './providerBridge';
import { createScopedFileSystem } from './scopedFileSystem';
import { RegistryToolExecutor } from './toolExecutor';
import type { EgressPlan } from './prompt';

export * from './capabilities';
export * from './prompt';
export { createRuntimeProvider, describeDestination, toProviderTools } from './providerBridge';
export { createScopedFileSystem } from './scopedFileSystem';
export { RegistryToolExecutor } from './toolExecutor';

/**
 * The single place the production agent is assembled.
 *
 * Everything the runtime is allowed to touch — provider, model, tools,
 * filesystem, context scope, budgets — is passed in here and nowhere else, so
 * a capability cannot appear at runtime that was not granted at composition
 * time.
 */

export interface AgentCompositionInput {
  readonly sink: RuntimeEventSink;
  readonly snapshot: WorkspaceSnapshotV1;
  readonly scope: ContextScope;
  readonly providerId: string;
  readonly modelId: string;
  readonly contextPaths: readonly string[];
  readonly credential?: () => string | undefined;
  readonly consent?: CustomEndpointConsent;
  readonly budgets?: Partial<RunBudgetLimits>;
  readonly openFiles?: readonly string[];
  readonly diagnostics?: readonly Diagnostic[];
  readonly onPlan?: (plan: EgressPlan) => void;
  /**
   * Supplying a reviewer is what enables mutation tools at all. Without it the
   * composition is structurally read-only.
   */
  readonly reviewGate?: MutationReviewGate;
  /** Test seam. Production passes nothing and the catalog builds the provider. */
  readonly provider?: AgentProvider;
  readonly fetch?: typeof fetch;
}

export interface AgentComposition {
  readonly runtime: AgentRuntime;
  readonly capabilities: AgentCapabilityReportV1;
  readonly filesystem: WorkspaceFileSystem;
}

export function createAgentComposition(input: AgentCompositionInput): AgentComposition {
  const provider =
    input.provider ??
    createProviderFromCatalog({
      providerId: input.providerId,
      ...(input.consent ? { consent: input.consent } : {}),
      ...(input.fetch ? { fetch: input.fetch } : {}),
    });

  const browser = provider.descriptor.capabilities.browser;
  if (browser.state !== 'supported') {
    throw new SourError({
      code: 'provider_unavailable',
      message: `${provider.descriptor.label} cannot run in this browser.`,
      causeCategory: 'unsupported',
      retryable: false,
      userAction: browser.state === 'unsupported' ? browser.reason : browser.reason,
    });
  }

  // Mutation tools exist only when a reviewer does. Without a gate there is no
  // path from a proposal to the workspace, so none is offered.
  const registry = new ToolRegistry(
    input.reviewGate ? [...READ_ONLY_TOOLS, ...MUTATION_TOOLS] : [...READ_ONLY_TOOLS]
  );
  const filesystem = createScopedFileSystem(
    new SnapshotWorkspaceFileSystem(input.snapshot),
    input.scope
  );

  const runtimeProvider = createRuntimeProvider({
    provider,
    modelId: input.modelId,
    snapshot: input.snapshot,
    scope: input.scope,
    tools: (mode) => registry.listForProfile(mode),
    contextPaths: input.contextPaths,
    ...(input.credential ? { credential: input.credential } : {}),
    ...(input.onPlan ? { onPlan: input.onPlan } : {}),
  });

  const openFiles = [...(input.openFiles ?? [])];
  const diagnostics = [...(input.diagnostics ?? [])];
  const executor = new RegistryToolExecutor(registry, {
    filesystem,
    listOpenFiles: () => openFiles.filter((path) => input.scope.allows(path)),
    inspectDiagnostics: () => diagnostics,
    pathPolicy: {
      allows: (path) => input.scope.allows(path),
      reason: (path) => {
        const decision = input.scope.decide(path);
        return decision.allowed ? 'allowed' : decision.reason;
      },
    },
  });

  const runtime = new AgentRuntime(input.sink, runtimeProvider, executor, {
    ...(input.budgets ? { budgets: input.budgets } : {}),
    ...(input.reviewGate ? { reviewGate: input.reviewGate } : {}),
  });

  return {
    runtime,
    filesystem,
    capabilities: buildCapabilityReport(input, provider, registry),
  };
}

function buildCapabilityReport(
  input: AgentCompositionInput,
  provider: AgentProvider,
  registry: ToolRegistry
): AgentCapabilityReportV1 {
  const entry = findCatalogEntry(input.providerId);
  const destination = describeDestination(provider);
  const toolNames = registry.list().map((tool) => tool.name);
  return Object.freeze({
    version: 1,
    storage: Object.freeze({
      available: true,
      detail: 'Runs and events are appended to local durable storage.',
    }),
    filesystem: Object.freeze({
      available: input.snapshot.files.length > 0,
      detail: input.snapshot.files.length
        ? `${input.snapshot.files.length} project files are readable in this run.`
        : 'No readable project files are in scope for this run.',
    }),
    provider: Object.freeze({
      available: true,
      detail:
        entry?.kind === 'demo'
          ? 'Demo provider selected: deterministic echo, not a model.'
          : `${provider.descriptor.label} · ${input.modelId}`,
    }),
    tools: Object.freeze({
      available: toolNames.length > 0,
      detail: `${toolNames.length} read-only tools are available.`,
    }),
    toolNames: Object.freeze(toolNames),
    mutation: Object.freeze({
      available: input.reviewGate !== undefined,
      detail: input.reviewGate
        ? 'Write mode can propose changes; each one needs your approval before it is applied.'
        : 'This session has no reviewer, so no mutation tool is available.',
    }),
    egress: Object.freeze(destination),
    context: Object.freeze({
      fileCount: input.snapshot.files.length,
      totalBytes: input.snapshot.totalBytes,
      excludedCount: input.snapshot.excluded.length,
      truncated: input.snapshot.truncated,
    }),
  });
}
