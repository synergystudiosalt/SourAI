import {
  filterRepeatedAgentRequests,
  type FilteredAgentRequests,
  type ParsedAgentResponse,
} from '../../utils/agentProtocol';

export const FINISH_WITH_EXISTING_RESULTS =
  '[Runtime: those workspace requests were already completed. Do not call another tool. Finish the requested work now using the results already present in this conversation.]';
export const CONTINUE_AFTER_REASONING =
  '[Runtime: your previous turn ended after reasoning without a final answer or workspace change. Continue now and complete the requested work. Use workspace tools if needed, then return a concrete final result.]';
export const RETRY_AFTER_EMPTY =
  '[Runtime: your previous turn returned an empty response. You have all the workspace context you need. Continue now and complete the requested work — output your final answer or file changes.]';
export const UNRESOLVED_WORKSPACE_REQUEST = (
  paths: string | readonly string[],
  unresolvedCount?: number,
  totalCount?: number
) => {
  // Preserve the original one-path call shape for callers that only have an
  // example, while allowing the run controller to provide the useful detail it
  // now records.
  if (typeof paths === 'string' || unresolvedCount === undefined || totalCount === undefined) {
    const examplePath = typeof paths === 'string' ? paths : paths[0] || '';
    return `The model returned no final answer because its workspace requests could not be resolved. One unresolved path was "${examplePath}".`;
  }

  const shownPaths = paths.slice(0, 4).map((path) => `"${path}"`);
  const pathList = shownPaths.length > 1
    ? `${shownPaths.slice(0, -1).join(', ')}, and ${shownPaths.at(-1)}`
    : shownPaths[0];
  return (
    `The model returned no final answer because ${unresolvedCount} of ${totalCount} ` +
    `workspace requests could not be resolved.` +
    (pathList ? ` Missing paths included ${pathList}.` : '')
  );
};
export const SILENT_MODEL_RESPONSE =
  'The model returned no final answer after completing its workspace checks.';
export const NO_PROGRESS_RESPONSE =
  'The model stopped making progress: consecutive turns produced no answer, no file changes, and no workspace requests that had not already been made.';
export const LAST_TURN_NOTICE =
  '[Runtime: this is your final turn — no further workspace tools will be run. Answer now using what you already have. If you were mid-investigation, state what you found, what you believe the cause is, and the change you would make.]';

/**
 * Appended to the turn before the budget runs out.
 *
 * Investigating a bug legitimately costs several turns, and a run that spent
 * them all was cut off with an error rather than an answer — the work was done
 * and then discarded. Warning the model that its last turn has arrived converts
 * that into a usable reply.
 */
export function lastTurnNotice(turn: number, maxTurns: number): string | null {
  return turn >= maxTurns - 1 ? LAST_TURN_NOTICE : null;
}

/**
 * Consecutive turns yielding nothing before the run is abandoned.
 *
 * A model that keeps re-requesting what it already asked for has its repeats
 * stripped by the duplicate filter, leaving turns that do nothing at all. The
 * recovery nudge fires once; when that is ignored nothing else intervened, so a
 * run ground through its whole turn budget and reported an exhausted budget —
 * one observed case spent twelve turns on five tool calls. Two dead turns is
 * enough to conclude it is not going to recover.
 */
export const MAX_DEAD_TURNS = 2;

/**
 * Owns progress and terminal-state policy for the chat agent. Provider output
 * can request work, but it cannot decide whether a duplicate runs or whether a
 * silent response is presented as success.
 */
export class ChatRunController {
  private readonly seenRequests = new Set<string>();
  private recoveryUsed = false;
  private incompleteRecoveryUsed = false;
  private emptyRetryUsed = false;
  private workspaceRequestCount = 0;
  private resolvedWorkspaceRequestCount = 0;
  private readonly unresolvedPaths: string[] = [];
  private consecutiveDeadTurns = 0;

  /**
   * Records whether a turn achieved anything: an answer, a file operation, or a
   * workspace request that had not already been made. Repeats do not count —
   * they are exactly what a stalled model produces.
   */
  recordTurnOutcome(productive: boolean): void {
    this.consecutiveDeadTurns = productive ? 0 : this.consecutiveDeadTurns + 1;
  }

  /** True once the run should be abandoned rather than spending more turns. */
  get stalled(): boolean {
    return this.consecutiveDeadTurns >= MAX_DEAD_TURNS;
  }

  filter(response: ParsedAgentResponse): FilteredAgentRequests {
    return filterRepeatedAgentRequests(response, this.seenRequests);
  }

  recordWorkspaceRequest(path: string, resolved: boolean): void {
    this.workspaceRequestCount += 1;
    if (resolved) {
      this.resolvedWorkspaceRequestCount += 1;
    } else if (!this.unresolvedPaths.includes(path)) {
      this.unresolvedPaths.push(path);
    }
  }

  consumeRecovery(
    repeatedRequestCount: number,
    turn: number,
    maxTurns: number
  ): string | null {
    if (repeatedRequestCount <= 0 || this.recoveryUsed || turn >= maxTurns) return null;
    this.recoveryUsed = true;
    return FINISH_WITH_EXISTING_RESULTS;
  }

  consumeIncomplete(
    hadReasoning: boolean,
    displayText: string,
    operationCount: number,
    turn: number,
    maxTurns: number
  ): string | null {
    if (
      !hadReasoning ||
      displayText.trim() ||
      operationCount > 0 ||
      this.incompleteRecoveryUsed ||
      turn >= maxTurns
    ) {
      return null;
    }
    this.incompleteRecoveryUsed = true;
    return CONTINUE_AFTER_REASONING;
  }

  /**
   * One-shot retry for a completely empty response.
   *
   * When the model returns nothing at all — no text, no operations, no tool
   * requests, no reasoning — after workspace reads were already resolved, the
   * most likely cause is a transient generation failure (context too large for
   * one attempt, output-token limit, or a provider hiccup). Nudging once
   * recovers the majority of these without wasting the whole turn budget.
   */
  consumeEmptyRetry(
    displayText: string,
    operationCount: number,
    hadReasoning: boolean,
    requestCount: number,
    turn: number,
    maxTurns: number
  ): string | null {
    if (
      displayText.trim() ||
      operationCount > 0 ||
      hadReasoning ||
      requestCount > 0 ||
      this.emptyRetryUsed ||
      this.resolvedWorkspaceRequestCount === 0 ||
      turn >= maxTurns
    ) {
      return null;
    }
    this.emptyRetryUsed = true;
    return RETRY_AFTER_EMPTY;
  }

  finalText(displayText: string, operationCount: number, exhausted: boolean): string {
    const answer = displayText.trim();
    if (answer) return answer;
    if (operationCount > 0) return 'Changes are ready for review.';
    const unresolvedWorkspaceRequestCount =
      this.workspaceRequestCount - this.resolvedWorkspaceRequestCount;
    // A strict majority makes unresolved requests the dominant, diagnosable
    // cause without blaming missing paths when successes and failures are tied.
    if (unresolvedWorkspaceRequestCount > this.resolvedWorkspaceRequestCount) {
      return UNRESOLVED_WORKSPACE_REQUEST(
        this.unresolvedPaths,
        unresolvedWorkspaceRequestCount,
        this.workspaceRequestCount
      );
    }
    // Checked before the budget message: a stalled run is abandoned early and
    // has turns to spare, so "exhausted its budget" would misdescribe it.
    if (
      this.stalled ||
      (this.consecutiveDeadTurns > 0 && (this.recoveryUsed || this.incompleteRecoveryUsed))
    ) {
      return NO_PROGRESS_RESPONSE;
    }
    return exhausted
      ? 'The model exhausted its workspace-tool budget without returning a final answer.'
      : SILENT_MODEL_RESPONSE;
  }
}
