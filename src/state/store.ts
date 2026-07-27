import type { AgentEventV1 } from '../contracts/events';
import {
  createAgentDomainState,
  reduceAgentEvent,
  replayAgentEvents,
  selectVisibleAgentState,
  type AgentDomainStateV1,
  type AgentVisibleStateV1,
} from './domain';

export type AgentStoreListener = (
  visibleState: AgentVisibleStateV1,
  domainState: AgentDomainStateV1,
) => void;

export interface AgentDomainStore {
  getState(): AgentDomainStateV1;
  getVisibleState(): AgentVisibleStateV1;
  /** Returns false when the event ID was already applied. */
  dispatch(event: AgentEventV1): boolean;
  /**
   * Applies a batch atomically and returns its accepted event count.
   * If one event is invalid, no event from the batch is committed.
   */
  dispatchMany(events: readonly AgentEventV1[]): number;
  subscribe(listener: AgentStoreListener): () => void;
}

export function createAgentDomainStore(
  initialEvents: readonly AgentEventV1[] = [],
): AgentDomainStore {
  let state = replayAgentEvents(initialEvents, createAgentDomainState());
  const listeners = new Set<AgentStoreListener>();

  const notify = (): void => {
    const visible = selectVisibleAgentState(state);
    for (const listener of [...listeners]) {
      listener(visible, state);
    }
  };

  return {
    getState: () => state,
    getVisibleState: () => selectVisibleAgentState(state),

    dispatch(event): boolean {
      const next = reduceAgentEvent(state, event);
      if (next === state) return false;
      state = next;
      notify();
      return true;
    },

    dispatchMany(events): number {
      let candidate = state;
      let accepted = 0;

      for (const event of events) {
        const next = reduceAgentEvent(candidate, event);
        if (next !== candidate) accepted++;
        candidate = next;
      }

      if (candidate !== state) {
        state = candidate;
        notify();
      }
      return accepted;
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

