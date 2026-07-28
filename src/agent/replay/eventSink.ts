import { parseAgentEventV1, type AgentEventV1 } from '../../contracts/events';
import type { EventsRepository } from '../../storage/repositories/events';
import {
  RECORD_SCHEMA_VERSION,
} from '../../storage/schema';
import type { EventRecord, JsonValue } from '../../storage/repositories/records';

export interface RuntimeEventSink {
  append(event: AgentEventV1): Promise<boolean>;
  listRun(runId: string): Promise<readonly AgentEventV1[]>;
  listThread(threadId: string): Promise<readonly AgentEventV1[]>;
}

/** Deterministic test/browser-memory sink with append-only idempotency. */
export class MemoryEventSink implements RuntimeEventSink {
  private readonly events = new Map<string, AgentEventV1>();

  async append(value: AgentEventV1): Promise<boolean> {
    const event = parseAgentEventV1(value);
    const previous = this.events.get(event.id);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(event)) {
        throw new Error(`Conflicting event id: ${event.id}`);
      }
      return false;
    }
    const collision = [...this.events.values()].some(
      (item) =>
        item.runId === event.runId && item.sequence === event.sequence,
    );
    if (collision) throw new Error(`Event sequence collision: ${event.sequence}`);
    this.events.set(event.id, event);
    return true;
  }

  async listRun(runId: string): Promise<readonly AgentEventV1[]> {
    return sorted([...this.events.values()].filter((event) => event.runId === runId));
  }

  async listThread(threadId: string): Promise<readonly AgentEventV1[]> {
    return sorted([...this.events.values()].filter((event) => event.threadId === threadId));
  }
}

/** IndexedDB repository bridge. Runtime events are validated on both sides. */
export class RepositoryEventSink implements RuntimeEventSink {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly repository: EventsRepository) {}

  append(event: AgentEventV1): Promise<boolean> {
    const operation = this.tail.then(async () => {
      const accepted = parseAgentEventV1(event);
      return this.repository.appendWithNextGlobalSequence(toRecord(accepted));
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  async listRun(runId: string): Promise<readonly AgentEventV1[]> {
    return (await this.repository.listByRun(runId)).map(fromRecord);
  }

  async listThread(threadId: string): Promise<readonly AgentEventV1[]> {
    return (await this.repository.listByThread(threadId)).map(fromRecord);
  }
}

function toRecord(event: AgentEventV1): Omit<EventRecord, 'globalSequence'> {
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    id: event.id,
    projectId: event.projectId,
    threadId: event.threadId,
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    createdAt: event.createdAt,
    ...(event.causationId ? { causationId: event.causationId } : {}),
    correlationId: event.correlationId,
    payload: event.payload as unknown as JsonValue,
  };
}

function fromRecord(record: EventRecord): AgentEventV1 {
  return parseAgentEventV1({
    id: record.id,
    version: 1,
    projectId: record.projectId,
    threadId: record.threadId,
    runId: record.runId,
    sequence: record.sequence,
    type: record.type,
    createdAt: record.createdAt,
    ...(record.causationId ? { causationId: record.causationId } : {}),
    correlationId: record.correlationId ?? record.runId,
    payload: record.payload,
  });
}

function sorted(events: AgentEventV1[]): AgentEventV1[] {
  return events.sort((left, right) => left.sequence - right.sequence);
}
