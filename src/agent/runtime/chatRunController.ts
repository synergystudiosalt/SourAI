import {
  filterRepeatedAgentRequests,
  type FilteredAgentRequests,
  type ParsedAgentResponse,
} from '../../utils/agentProtocol';

export const FINISH_WITH_EXISTING_RESULTS =
  '[Runtime: those workspace requests were already completed. Do not call another tool. Finish the requested work now using the results already present in this conversation.]';

/**
 * Owns progress and terminal-state policy for the chat agent. Provider output
 * can request work, but it cannot decide whether a duplicate runs or whether a
 * silent response is presented as success.
 */
export class ChatRunController {
  private readonly seenRequests = new Set<string>();
  private recoveryUsed = false;

  filter(response: ParsedAgentResponse): FilteredAgentRequests {
    return filterRepeatedAgentRequests(response, this.seenRequests);
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

  finalText(displayText: string, operationCount: number, exhausted: boolean): string {
    const answer = displayText.trim();
    if (answer) return answer;
    if (operationCount > 0) return 'Changes are ready for review.';
    return exhausted
      ? 'The model exhausted its workspace-tool budget without returning a final answer.'
      : 'The model returned no final answer after completing its workspace checks.';
  }
}
