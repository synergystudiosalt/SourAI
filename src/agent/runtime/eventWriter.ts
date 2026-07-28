import {
  createAgentEventV1,
  type AgentEventPayloadsV1,
  type AgentEventTypeV1,
  type AgentEventV1,
} from '../../contracts/events';
import type { RuntimeEventSink } from '../replay';
import type { RuntimeSubscription } from './types';

export class RunEventWriter {
  private sequence: number;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly envelope: {
      readonly projectId: string;
      readonly threadId: string;
      readonly runId: string;
      readonly correlationId: string;
    },
    initialSequence: number,
    private readonly sink: RuntimeEventSink,
    private readonly subscribers: Set<RuntimeSubscription>,
    private readonly now: () => number,
    private readonly createId: () => string,
  ) {
    this.sequence = initialSequence;
  }

  get projectId(): string {
    return this.envelope.projectId;
  }

  get threadId(): string {
    return this.envelope.threadId;
  }

  append<T extends AgentEventTypeV1>(
    type: T,
    payload: AgentEventPayloadsV1[T],
    causationId?: string,
  ): Promise<AgentEventV1> {
    const operation = this.tail.then(async () => {
      const event = createAgentEventV1({
        ...this.envelope,
        id: this.createId(),
        sequence: this.sequence,
        type,
        payload,
        createdAt: this.now(),
        ...(causationId ? { causationId } : {}),
      }) as AgentEventV1;
      await this.sink.append(event);
      this.sequence += 1;
      for (const subscriber of this.subscribers) {
        try {
          subscriber(event);
        } catch {
          // A UI subscriber is outside the durability boundary and must never
          // turn an already-persisted event into a failed append.
        }
      }
      return event;
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  flush(): Promise<void> {
    return this.tail.then(() => undefined);
  }
}
