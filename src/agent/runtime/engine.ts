import {
  AGENT_COMMAND_VERSION,
  parseAgentCommandV1,
  parseRunInputV1,
  type AgentCommandV1,
  type RunInputV1,
} from '../../contracts/commands';
import { normalizeError, SourError } from '../../contracts/errors';
import type { AgentEventV1, UsageV1 } from '../../contracts/events';
import { DEFAULT_RUN_BUDGETS, RunBudget, type RunBudgetLimits } from '../budgets';
import { replayRun, type RuntimeEventSink } from '../replay';
import { RunEventWriter } from './eventWriter';
import type {
  MutationApplyReport,
  MutationReviewGate,
  RuntimeOptions,
  RuntimeProposal,
  RuntimeProvider,
  RuntimeProviderChunk,
  RuntimeSubscription,
  RuntimeToolExecutor,
  StartRunRequest,
} from './types';

interface ActiveRun {
  readonly runId: string;
  readonly input: RunInputV1;
  readonly writer: RunEventWriter;
  readonly controller: AbortController;
  readonly budget: RunBudget;
  readonly steering: string[];
  readonly priorMessages: string[];
  /** Tool results produced during the current turn, consumed by the next one. */
  readonly toolResults: string[];
  /**
   * Resolves when an in-flight review has finished recording its outcome.
   *
   * Cancellation waits on this so a transaction that committed is recorded
   * before the run's terminal event, keeping the log in the order the world
   * actually happened.
   */
  mutationBarrier: Promise<void>;
  terminal: boolean;
  task?: Promise<void>;
}

/** Trusted continuation text. Never sourced from a model or a project file. */
const CONTINUE_AFTER_TOOLS =
  'Continue from the tool results above. If they answer the request, give the final answer now; otherwise call another tool.';
const MAX_TOOL_RESULT_BYTES = 16 * 1024;
const MAX_TOOL_RESULTS_PER_TURN = 8;

export class AgentRuntime {
  private readonly active = new Map<string, ActiveRun>();
  private readonly completedTasks = new Map<string, Promise<void>>();
  private readonly subscribers = new Set<RuntimeSubscription>();
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly limits: RunBudgetLimits;
  private readonly reviewGate?: MutationReviewGate;

  constructor(
    private readonly sink: RuntimeEventSink,
    private readonly provider: RuntimeProvider,
    private readonly tools: RuntimeToolExecutor,
    options: RuntimeOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.limits = Object.freeze({ ...DEFAULT_RUN_BUDGETS, ...options.budgets });
    this.reviewGate = options.reviewGate;
  }

  subscribe(subscriber: RuntimeSubscription): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  async start(request: StartRunRequest): Promise<string> {
    const input = parseRunInputV1(request.input);
    const runId = this.createId();
    const run = this.makeRun(runId, request.projectId, request.threadId, input, 0, []);
    this.active.set(runId, run);
    try {
      await run.writer.append('run.created', { input });
      await run.writer.append('run.status_changed', { status: 'running' });
      this.launch(run, input.message);
      return runId;
    } catch (error) {
      run.terminal = true;
      run.controller.abort('Run could not be persisted.');
      this.active.delete(runId);
      throw error;
    }
  }

  async dispatch(value: unknown): Promise<{ readonly runId?: string }> {
    const command = parseAgentCommandV1(value);
    switch (command.type) {
      case 'run.start':
        return {
          runId: await this.start({
            projectId: command.projectId,
            threadId: command.threadId,
            input: command.input,
          }),
        };
      case 'run.cancel':
        await this.cancel(command.runId);
        return { runId: command.runId };
      case 'run.steer':
        this.steer(command.runId, command.message);
        return { runId: command.runId };
      case 'run.resume':
        await this.resume(command.runId);
        return { runId: command.runId };
      case 'approval.resolve':
        throw runtimeError('approval_not_owned', 'Approval commands are handled by the approval service.');
    }
  }

  steer(runId: string, message: string): void {
    const run = this.requireActive(runId);
    if (run.terminal || run.controller.signal.aborted) {
      throw runtimeError('run_not_active', 'The run cannot be steered after it stops.');
    }
    const clean = message.trim();
    if (!clean) throw runtimeError('steering_invalid', 'Steering input cannot be empty.');
    if (run.steering.length >= this.limits.maxTurns) {
      throw runtimeError('steering_queue_full', 'The steering queue is full.');
    }
    run.steering.push(clean);
  }

  async cancel(runId: string, reason = 'Cancelled by the user.'): Promise<void> {
    const run = this.active.get(runId);
    if (!run || run.terminal) return;
    run.terminal = true;
    // Abort first so a review nobody has committed to stops immediately, then
    // wait for any transaction that is already being applied and recorded.
    run.controller.abort(reason);
    await run.mutationBarrier.catch(() => undefined);
    run.steering.splice(0);
    run.toolResults.splice(0);
    await run.writer.append('run.cancelled', { reason });
    await run.writer.flush();
    this.active.delete(runId);
  }

  async resume(runId: string): Promise<void> {
    if (this.active.has(runId)) return;
    const replayed = replayRun(await this.sink.listRun(runId));
    if (replayed.terminal) {
      throw runtimeError('run_terminal', 'A completed, failed, or cancelled run cannot be resumed.');
    }
    if (replayed.providerRequestCount > 1 || replayed.toolCallCount > 0) {
      throw runtimeError(
        'run_resume_unsafe',
        'This interrupted run cannot be resumed without risking a repeated turn or tool effect.',
      );
    }
    const run = this.makeRun(
      runId,
      replayed.projectId,
      replayed.threadId,
      replayed.input,
      replayed.lastSequence + 1,
      [...replayed.completedMessages],
      {
        turns: replayed.providerRequestCount,
        toolCalls: replayed.toolCallCount,
        contextTokens: replayed.inputTokens,
        outputTokens: replayed.outputTokens,
        estimatedCostUsd: replayed.estimatedCostUsd,
      },
    );
    this.active.set(runId, run);
    await run.writer.append('run.status_changed', { status: 'running' });
    this.launch(run, replayed.input.message, replayed.draft || undefined);
  }

  async retry(runId: string): Promise<string> {
    const replayed = replayRun(await this.sink.listRun(runId));
    return this.start({
      projectId: replayed.projectId,
      threadId: replayed.threadId,
      input: replayed.input,
    });
  }

  async wait(runId: string): Promise<void> {
    await (this.active.get(runId)?.task ?? this.completedTasks.get(runId));
  }

  private launch(run: ActiveRun, message: string, partial?: string): void {
    const task = this.drive(run, message, partial).finally(() => {
      if (this.active.get(run.runId) === run && run.terminal) this.active.delete(run.runId);
    });
    run.task = task;
    this.completedTasks.set(run.runId, task);
  }

  private async drive(run: ActiveRun, firstMessage: string, partial?: string): Promise<void> {
    let message: string | undefined = firstMessage;
    let continuation = partial;
    let toolResults: readonly string[] | undefined;
    try {
      while (message !== undefined) {
        this.assertLive(run);
        run.budget.consume('turns');
        const requestId = this.createId();
        await run.writer.append('provider.request_started', {
          requestId,
          providerId: this.provider.id,
          modelId: this.provider.modelId,
        });
        let draft = continuation ?? '';
        continuation = undefined;
        const iterator = this.provider.stream({
          runId: run.runId,
          turn: run.budget.snapshot().turns,
          input: run.input,
          message,
          previousAssistantMessages: [...run.priorMessages],
          ...(draft ? { partialAssistantMessage: draft } : {}),
          ...(toolResults?.length ? { toolResults } : {}),
          signal: run.controller.signal,
        })[Symbol.asyncIterator]();
        toolResults = undefined;
        try {
          while (true) {
            const remainingMs = Math.max(
              0,
              this.limits.maxRuntimeMs - run.budget.snapshot().elapsedMs,
            );
            const next = await nextWithinBudget(iterator, remainingMs, run.controller);
            if (next.done) break;
            this.assertLive(run);
            draft = await this.acceptChunk(run, requestId, next.value, draft);
          }
        } finally {
          void iterator.return?.().catch(() => undefined);
        }
        this.assertLive(run);
        if (draft) {
          const messageId = this.createId();
          await run.writer.append('assistant.message_completed', {
            messageId,
            content: draft,
            modelId: this.provider.modelId,
          });
          run.priorMessages.push(draft);
        }
        const produced = run.toolResults.splice(0);
        const steer = run.steering.shift();
        if (steer !== undefined) {
          message = steer;
        } else if (produced.length > 0) {
          // A turn that only called tools has not answered anything yet. The
          // turn budget bounds how long this can continue.
          toolResults = produced;
          message = CONTINUE_AFTER_TOOLS;
        } else {
          message = undefined;
        }
      }
      this.assertLive(run);
      run.terminal = true;
      await run.writer.append('run.completed', {});
    } catch (cause) {
      if (run.terminal) return;
      run.terminal = true;
      const error = normalizeError(cause, {
        code: 'agent_run_failed',
        message: 'The agent run failed.',
        causeCategory: 'runtime',
      });
      await run.writer.append('run.failed', { error: error.toData() });
    } finally {
      await run.writer.flush();
    }
  }

  private async acceptChunk(
    run: ActiveRun,
    requestId: string,
    chunk: RuntimeProviderChunk,
    draft: string,
  ): Promise<string> {
    switch (chunk.type) {
      case 'text.delta': {
        const tokens = chunk.outputTokens ?? estimateTokens(chunk.delta);
        run.budget.consume('outputTokens', tokens);
        await run.writer.append('provider.output_delta', {
          requestId,
          delta: chunk.delta,
        });
        return draft + chunk.delta;
      }
      case 'usage':
        this.acceptUsage(run.budget, chunk.usage);
        await run.writer.append('usage.changed', chunk.usage);
        return draft;
      case 'tool.call':
        await this.executeTool(run, chunk.call);
        return draft;
    }
  }

  private acceptUsage(budget: RunBudget, usage: UsageV1): void {
    budget.assertContext(usage.inputTokens);
    const snapshot = budget.snapshot();
    if (usage.outputTokens > snapshot.outputTokens) {
      budget.consume('outputTokens', usage.outputTokens - snapshot.outputTokens);
    }
    if ((usage.estimatedCostUsd ?? 0) > snapshot.estimatedCostUsd) {
      budget.consume(
        'estimatedCostUsd',
        (usage.estimatedCostUsd ?? 0) - snapshot.estimatedCostUsd,
      );
    }
  }

  private async executeTool(
    run: ActiveRun,
    call: Extract<RuntimeProviderChunk, { type: 'tool.call' }>['call'],
  ): Promise<void> {
    this.assertLive(run);
    run.budget.consume('toolCalls');
    await run.writer.append('tool.proposed', {
      toolCallId: call.id,
      toolName: call.name,
      ...(call.summary ? { summary: call.summary } : {}),
    });
    if (run.input.mode !== 'write' && this.tools.isMutating(call.name)) {
      const error = runtimeError(
        'profile_mutation_denied',
        `${run.input.mode} mode cannot execute mutation tools.`,
      );
      await run.writer.append('tool.validation_failed', {
        toolCallId: call.id,
        error: error.toData(),
      });
      return;
    }
    this.assertLive(run);
    await run.writer.append('tool.started', { toolCallId: call.id });
    try {
      const result = await this.tools.execute(call, {
        runId: run.runId,
        mode: run.input.mode,
        signal: run.controller.signal,
      });
      this.assertLive(run);
      if (result.proposal) {
        const reviewing = this.review(run, call.id, call.name, result.proposal);
        run.mutationBarrier = reviewing.then(
          () => undefined,
          () => undefined
        );
        const outcome = await reviewing;
        await run.writer.append('tool.completed', {
          toolCallId: call.id,
          summary: outcome.summary,
        });
        // The provider is told what actually happened, not what it proposed.
        this.recordToolResult(run, call.name, call.id, outcome.factsForModel);
        return;
      }
      await run.writer.append('tool.completed', {
        toolCallId: call.id,
        ...(result.summary ? { summary: result.summary } : {}),
        ...(result.artifactIds ? { artifactIds: result.artifactIds } : {}),
      });
      this.recordToolResult(run, call.name, call.id, { ok: true, result: result.output ?? null });
    } catch (cause) {
      if (run.controller.signal.aborted) throw cause;
      const error = normalizeError(cause, {
        code: 'tool_execution_failed',
        message: 'The tool failed.',
        causeCategory: 'runtime',
      });
      await run.writer.append('tool.failed', {
        toolCallId: call.id,
        error: error.toData(),
      });
      this.recordToolResult(run, call.name, call.id, {
        ok: false,
        error: { code: error.code, message: error.message },
      });
    }
  }

  /**
   * Runs the propose → review → apply sequence for one mutation tool call.
   *
   * Every step is recorded before the next one starts, so a reload mid-review
   * finds a pending proposal rather than a gap, and the model is handed the
   * recorded outcome rather than being trusted to describe it.
   */
  private async review(
    run: ActiveRun,
    toolCallId: string,
    toolName: string,
    proposal: RuntimeProposal
  ): Promise<{ readonly summary: string; readonly factsForModel: Record<string, unknown> }> {
    const gate = this.reviewGate;
    if (!gate) {
      const error = runtimeError(
        'mutation_review_unavailable',
        'This session cannot apply workspace changes.'
      );
      await run.writer.append('tool.failed', { toolCallId, error: error.toData() });
      return {
        summary: 'Change proposal could not be reviewed.',
        factsForModel: { ok: false, error: error.message },
      };
    }

    const projectRevision = await gate.projectRevision();
    const approvalId = this.createId();
    await run.writer.append('proposal.created', {
      proposalId: proposal.id,
      toolCallId,
      summary: proposal.summary,
      digest: proposal.digest,
      paths: [...proposal.paths],
      changeCount: proposal.changeCount,
      projectRevision,
    });
    await run.writer.append('approval.requested', {
      approvalId,
      toolCallId,
      summary: proposal.summary,
      risk: proposal.changeCount > 1 ? 'high' : 'medium',
      proposalId: proposal.id,
      digest: proposal.digest,
      paths: [...proposal.paths],
    });
    // This event carries the status transition itself; a separate
    // `run.status_changed` would be a no-op transition and is not emitted.
    await run.writer.append('run.waiting_for_user', {
      reason: 'A workspace change needs your review.',
      approvalId,
    });
    await run.writer.flush();

    const report = await gate.review({
      runId: run.runId,
      projectId: run.writer.projectId,
      threadId: run.writer.threadId,
      toolCallId,
      toolName,
      approvalId,
      proposal,
      projectRevision,
      signal: run.controller.signal,
    });

    // A change that was actually applied is recorded even if the run is being
    // cancelled: the log has to describe the workspace, not the intention.
    if (report.outcome?.status !== 'applied') this.assertLive(run);
    if (report.decision !== 'approved') {
      // Expiry is itself the resolution; emitting a denial after it would
      // resolve the same approval twice and break replay.
      if (report.decision === 'expired') {
        await run.writer.append('approval.expired', { approvalId });
      } else {
        await run.writer.append('approval.resolved', {
          approvalId,
          decision: 'denied',
          ...(report.reason ? { reason: report.reason } : {}),
        });
      }
      await run.writer.append('run.status_changed', { status: 'running' });
      const reason = report.reason ?? 'The user declined the change.';
      return {
        summary: reason,
        factsForModel: { ok: false, applied: false, decision: report.decision, reason },
      };
    }

    await run.writer.append('approval.resolved', {
      approvalId,
      decision: 'approved',
      ...(report.digest ? { digest: report.digest } : {}),
    });
    if (report.digest && report.digest !== proposal.digest) {
      await run.writer.append('proposal.superseded', {
        proposalId: proposal.id,
        reason: 'The user changed the proposal before approving it.',
      });
    }

    const outcome = report.outcome;
    const facts = await this.recordOutcome(run, approvalId, proposal, outcome);
    // A cancelled run stays cancelled; it just now carries an accurate record of
    // what was applied before it stopped.
    this.assertLive(run);
    await run.writer.append('run.status_changed', { status: 'running' });
    return facts;
  }

  private async recordOutcome(
    run: ActiveRun,
    approvalId: string,
    proposal: RuntimeProposal,
    outcome: MutationApplyReport | undefined
  ): Promise<{ readonly summary: string; readonly factsForModel: Record<string, unknown> }> {
    if (!outcome) {
      const message = 'The change was approved but no result was reported.';
      return { summary: message, factsForModel: { ok: false, applied: false, error: message } };
    }

    if (outcome.status === 'conflict') {
      for (const conflict of outcome.conflicts) {
        await run.writer.append('file.conflict', {
          path: conflict.path || proposal.paths[0] || '',
          ...(conflict.expectedHash ? { expectedHash: conflict.expectedHash } : {}),
          ...(conflict.actualHash ? { actualHash: conflict.actualHash } : {}),
        });
      }
      return {
        summary: 'The workspace changed; the proposal was not applied.',
        factsForModel: {
          ok: false,
          applied: false,
          conflicts: outcome.conflicts.map((conflict) => ({
            path: conflict.path,
            reason: conflict.reason,
          })),
          nextStep: 'Re-read the affected files and propose the change again.',
        },
      };
    }

    if (outcome.status === 'failed') {
      const transactionId = outcome.transactionId;
      if (transactionId) {
        await run.writer.append('file.transaction_started', {
          transactionId,
          paths: [...proposal.paths],
          ...(outcome.checkpointId ? { checkpointId: outcome.checkpointId } : {}),
        });
        await run.writer.append('file.transaction_rolled_back', {
          transactionId,
          error: outcome.error,
          restored: outcome.rolledBack,
          ...(outcome.checkpointId ? { checkpointId: outcome.checkpointId } : {}),
        });
      }
      return {
        summary: outcome.error.message,
        factsForModel: {
          ok: false,
          applied: false,
          rolledBack: outcome.rolledBack,
          error: outcome.error.message,
        },
      };
    }

    await run.writer.append('checkpoint.created', {
      checkpointId: outcome.checkpointId,
      revision: outcome.previousRevision,
    });
    await run.writer.append('file.transaction_started', {
      transactionId: outcome.transactionId,
      paths: [...proposal.paths],
      checkpointId: outcome.checkpointId,
      projectRevision: outcome.previousRevision,
    });
    await run.writer.append('approval.consumed', {
      approvalId,
      transactionId: outcome.transactionId,
    });
    await run.writer.append('file.transaction_completed', {
      transactionId: outcome.transactionId,
      revision: outcome.revision,
      changedPaths: [...outcome.changedPaths],
      checkpointId: outcome.checkpointId,
      previousRevision: outcome.previousRevision,
    });
    await run.writer.append('verification.started', {
      transactionId: outcome.transactionId,
      checks: outcome.verification.map((check) => check.id),
    });
    await run.writer.append('verification.completed', {
      transactionId: outcome.transactionId,
      results: outcome.verification.map((check) => ({ ...check })),
    });

    const failed = outcome.verification.filter((check) => check.status === 'failed');
    return {
      summary: `Applied ${outcome.changedPaths.length} file(s) at revision ${outcome.revision}.`,
      factsForModel: {
        ok: failed.length === 0,
        applied: true,
        changedPaths: [...outcome.changedPaths],
        revision: outcome.revision,
        checkpointId: outcome.checkpointId,
        verification: outcome.verification.map((check) => ({
          id: check.id,
          status: check.status,
          detail: check.detail,
        })),
        ...(failed.length > 0
          ? { nextStep: 'A verification check failed. Inspect the changed files and fix them.' }
          : {}),
      },
    };
  }

  /**
   * Tool facts are handed back to the provider verbatim and bounded. The
   * runtime states the outcome; a model cannot restate a failure as a success.
   */
  private recordToolResult(
    run: ActiveRun,
    toolName: string,
    toolCallId: string,
    outcome: Record<string, unknown>
  ): void {
    if (run.toolResults.length >= MAX_TOOL_RESULTS_PER_TURN) return;
    let serialized: string;
    try {
      serialized = JSON.stringify({ tool: toolName, toolCallId, ...outcome }) ?? '';
    } catch {
      serialized = JSON.stringify({ tool: toolName, toolCallId, ok: false, error: 'unserializable' });
    }
    run.toolResults.push(
      serialized.length > MAX_TOOL_RESULT_BYTES
        ? `${serialized.slice(0, MAX_TOOL_RESULT_BYTES)}… [truncated]`
        : serialized
    );
  }

  private makeRun(
    runId: string,
    projectId: string,
    threadId: string,
    input: RunInputV1,
    sequence: number,
    priorMessages: string[],
    restored?: {
      readonly turns: number;
      readonly toolCalls: number;
      readonly contextTokens: number;
      readonly outputTokens: number;
      readonly estimatedCostUsd: number;
    },
  ): ActiveRun {
    const correlationId = runId;
    const budget = new RunBudget(this.limits, this.now);
    if (restored) {
      budget.consume('turns', restored.turns);
      budget.consume('toolCalls', restored.toolCalls);
      budget.assertContext(restored.contextTokens);
      budget.consume('outputTokens', restored.outputTokens);
      budget.consume('estimatedCostUsd', restored.estimatedCostUsd);
    }
    return {
      runId,
      input,
      writer: new RunEventWriter(
        { runId, projectId, threadId, correlationId },
        sequence,
        this.sink,
        this.subscribers,
        this.now,
        this.createId,
      ),
      controller: new AbortController(),
      budget,
      steering: [],
      priorMessages,
      toolResults: [],
      mutationBarrier: Promise.resolve(),
      terminal: false,
    };
  }

  private assertLive(run: ActiveRun): void {
    run.budget.assertRuntime();
    if (run.terminal || run.controller.signal.aborted) {
      throw new DOMException('The run was cancelled.', 'AbortError');
    }
  }

  private requireActive(runId: string): ActiveRun {
    const run = this.active.get(runId);
    if (!run) throw runtimeError('run_not_active', 'The run is not active.');
    return run;
  }
}

export function startCommand(request: StartRunRequest, requestId: string, now = Date.now()): AgentCommandV1 {
  return {
    version: AGENT_COMMAND_VERSION,
    requestId,
    createdAt: now,
    type: 'run.start',
    ...request,
  };
}

function estimateTokens(value: string): number {
  return value.length === 0 ? 0 : Math.max(1, Math.ceil(value.length / 4));
}

function runtimeError(code: string, message: string): SourError {
  return new SourError({
    code,
    message,
    causeCategory: 'runtime',
    retryable: false,
  });
}

function nextWithinBudget<T>(
  iterator: AsyncIterator<T>,
  remainingMs: number,
  controller: AbortController,
): Promise<IteratorResult<T>> {
  if (remainingMs <= 0) {
    controller.abort('Runtime budget exceeded.');
    return Promise.reject(runtimeError('run_budget_exhausted', 'The run exceeded its runtime budget.'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort('Runtime budget exceeded.');
      reject(runtimeError('run_budget_exhausted', 'The run exceeded its runtime budget.'));
    }, remainingMs);
    iterator.next().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
