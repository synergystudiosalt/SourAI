import { normalizeError, SourError } from '../../contracts/errors';
import { registerSecret, unregisterSecret } from '../../security/redaction';
import { createAgentComposition, type AgentComposition } from '../composition';
import { ContextScope } from '../context/scope';
import { parseWorkspaceSnapshotV1 } from '../context/snapshot';
import type { RuntimeEventSink } from '../replay';
import { WorkerMutationGate } from './mutationGate';
import {
  asRecord,
  attachAgentWorker,
  type AgentWorkerInitV1,
  type WorkerMessagePort,
} from './protocol';

/**
 * Worker-side composition owner.
 *
 * The worker starts with no provider, no filesystem, and no tools. It gains
 * them only from an `init` message that it validates itself, so a malformed or
 * partially trusted host message produces a degraded report rather than a
 * half-built agent.
 */

export interface AgentWorkerHostOptions {
  readonly sink: RuntimeEventSink;
  /** Test seam for composing without the catalog. */
  readonly compose?: typeof createAgentComposition;
  readonly fetch?: typeof fetch;
}

export function startAgentWorkerHost(
  port: WorkerMessagePort,
  options: AgentWorkerHostOptions
): () => void {
  const compose = options.compose ?? createAgentComposition;
  const gate = new WorkerMutationGate(port);
  let composition: AgentComposition | undefined;
  let detachRuntime: (() => void) | undefined;
  let credential: string | undefined;
  let busy = false;

  const setCredential = (value: string | undefined) => {
    if (credential === value) return;
    if (credential !== undefined) unregisterSecret(credential);
    credential = value;
    if (value !== undefined) registerSecret(value);
  };

  const build = (init: AgentWorkerInitV1) => {
    if (busy) {
      throw new SourError({
        code: 'worker_busy',
        message: 'The agent cannot be reconfigured while a run is active.',
        causeCategory: 'runtime',
        retryable: true,
        userAction: 'Stop the current run first.',
      });
    }
    const snapshot = parseWorkspaceSnapshotV1(init.snapshot);
    const scope = ContextScope.fromConfig(init.scope);
    gate.setRevision(snapshot.revision);
    const contextPaths = (init.contextPaths ?? []).filter(
      (path) => typeof path === 'string' && scope.allows(path)
    );

    detachRuntime?.();
    detachRuntime = undefined;
    composition = compose({
      sink: options.sink,
      snapshot,
      scope,
      providerId: String(init.providerId),
      modelId: String(init.modelId),
      contextPaths,
      credential: () => credential,
      ...(init.consent ? { consent: init.consent } : {}),
      ...(init.openFiles ? { openFiles: init.openFiles.filter((path) => typeof path === 'string') } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      // Mutation tools exist only when the host says it can review changes.
      ...(init.canReviewMutations === true ? { reviewGate: gate } : {}),
      onPlan: (plan) => port.postMessage({ kind: 'egress.planned', plan }),
    });

    const detachCommands = attachAgentWorker(composition.runtime, port, {
      onCommandEnvelope: ({ command, credential: provided }) => {
        if (command.type === 'run.start') setCredential(provided);
      },
    });
    // Busy state follows the run's own events rather than command acceptance,
    // so a rejected or failed start cannot leave the worker permanently locked.
    const detachBusy = composition.runtime.subscribe((event) => {
      if (event.type === 'run.created') {
        busy = true;
        return;
      }
      if (
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled'
      ) {
        busy = false;
        setCredential(undefined);
      }
    });
    detachRuntime = () => {
      detachBusy();
      detachCommands();
    };
    port.postMessage({ kind: 'worker.ready', capabilities: composition.capabilities });
  };

  const onMessage = (message: MessageEvent<unknown>) => {
    const envelope = asRecord(message.data);
    if (!envelope) return;
    if (envelope.kind === 'init') {
      try {
        const init = asRecord(envelope.init);
        if (!init) throw new TypeError('Worker init payload must be an object.');
        build(init as unknown as AgentWorkerInitV1);
      } catch (cause) {
        port.postMessage({
          kind: 'worker.degraded',
          error: normalizeError(cause, {
            code: 'worker_init_failed',
            message: 'The agent could not be configured for this project.',
            causeCategory: 'runtime',
            retryable: false,
          }).toData(),
        });
      }
      return;
    }
    if (envelope.kind === 'mutation.applying') {
      gate.commit(envelope.approvalId);
      return;
    }
    if (envelope.kind === 'mutation.reviewed') {
      gate.resolve(envelope.approvalId, envelope.report);
      return;
    }
    if (envelope.kind === 'workspace.revision') {
      if (typeof envelope.revision === 'number') gate.setRevision(envelope.revision);
      return;
    }
    if (envelope.kind === 'command' && !composition) {
      port.postMessage({
        kind: 'command.rejected',
        error: new SourError({
          code: 'worker_not_initialized',
          message: 'The agent has not been configured yet.',
          causeCategory: 'runtime',
          retryable: true,
          userAction: 'Wait for the agent to report readiness.',
        }).toData(),
      });
    }
  };

  port.addEventListener('message', onMessage);
  return () => {
    port.removeEventListener('message', onMessage);
    detachRuntime?.();
    gate.abandon('The agent session ended before this change was reviewed.');
    setCredential(undefined);
  };
}
