import { reviveNotebook, type Notebook } from '../features/notebook/types';
import type { AgentChatMessage, ChatMessage, Conversation } from '../types';
import { openStorageDatabase, queryBound, queryOnly, type StorageDatabase } from './database';
import { LegacyLocalStorageMigration } from './legacyMigration';
import {
  EventsRepository,
  MessagesRepository,
  SettingsRepository,
  ThreadsRepository,
  type EventRecord,
  type JsonValue,
  type MemoryRecord,
  type MessageRecord,
  type ThreadRecord,
} from './repositories';
import { RECORD_SCHEMA_VERSION, STORE_NAMES } from './schema';
import { sha256Hex } from './blobStore';

const CHAT_PROJECT_ID = 'sourai:chat';
const NOTEBOOK_SCOPE = 'notebook';
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function token(value: string): string {
  return encodeURIComponent(value).replace(/%/g, '_');
}

function chatThreadId(id: string): string {
  return `chat:${token(id)}`;
}

function agentThreadId(projectId: string): string {
  return `agent:${token(projectId)}`;
}

function notebookKey(notebookId: string): string {
  return `notebook:${token(notebookId)}`;
}

function reviveChatMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    (record.role !== 'user' && record.role !== 'assistant') ||
    typeof record.content !== 'string' ||
    typeof record.timestamp !== 'number'
  ) {
    return null;
  }
  return { ...(record as unknown as ChatMessage), timestamp: new Date(record.timestamp) };
}

export class ClientPersistence {
  readonly settings: SettingsRepository;
  readonly threads: ThreadsRepository;
  readonly messages: MessagesRepository;
  readonly events: EventsRepository;

  constructor(readonly database: StorageDatabase) {
    this.settings = new SettingsRepository(database);
    this.threads = new ThreadsRepository(database);
    this.messages = new MessagesRepository(database);
    this.events = new EventsRepository(database);
  }

  async loadConversations(): Promise<Conversation[]> {
    const threads = await this.threads.listByProject(CHAT_PROJECT_ID);
    const conversations: Conversation[] = [];
    for (const thread of threads) {
      const events = await this.events.listByThread(thread.id);
      const messages = events
        .filter((event) => event.type === 'chat.message.persisted')
        .map((event) =>
          reviveChatMessage((event.payload as Record<string, unknown>).message)
        )
        .filter((message): message is ChatMessage => Boolean(message));
      conversations.push({
        id:
          typeof thread.metadata?.conversationId === 'string'
            ? thread.metadata.conversationId
            : thread.id,
        title: thread.title,
        messages,
        createdAt: new Date(thread.createdAt),
      });
    }
    return conversations;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const threadId = chatThreadId(conversation.id);
    const now = Date.now();
    const thread: ThreadRecord = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: threadId,
      projectId: CHAT_PROJECT_ID,
      title: conversation.title,
      status: 'idle',
      createdAt: conversation.createdAt.getTime(),
      updatedAt: Math.max(
        conversation.createdAt.getTime(),
        ...conversation.messages.map((message) => message.timestamp.getTime()),
        now
      ),
      archivedAt: null,
      metadata: { conversationId: conversation.id },
    };
    const messageRecords: MessageRecord[] = conversation.messages.map((message, sequence) => ({
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: `chat-message:${token(conversation.id)}:${token(message.id)}`,
      threadId,
      sequence,
      role: message.role,
      content: message.content,
      createdAt: message.timestamp.getTime(),
      data: { message: jsonValue({ ...message, timestamp: message.timestamp.getTime() }) },
    }));
    const eventRecords: EventRecord[] = messageRecords.map((message, sequence) => ({
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: `chat-event:${token(conversation.id)}:${sequence}`,
      projectId: CHAT_PROJECT_ID,
      threadId,
      runId: `chat-run:${token(conversation.id)}`,
      sequence,
      globalSequence: sequence,
      type: 'chat.message.persisted',
      createdAt: message.createdAt,
      correlationId: threadId,
      payload: { message: message.data!.message },
    }));

    await this.database.transaction(
      ['threads', 'messages', 'events'],
      'readwrite',
      async (transaction) => {
        await transaction.put('threads', thread);
        const oldMessages = await transaction.getAllFromIndex<MessageRecord>(
          'messages',
          'byThreadSequence',
          queryBound([threadId, 0], [threadId, MAX_SEQUENCE])
        );
        const oldEvents = await transaction.getAllFromIndex<EventRecord>(
          'events',
          'byThreadGlobalSequence',
          queryBound([threadId, 0], [threadId, MAX_SEQUENCE])
        );
        for (const record of oldMessages) await transaction.delete('messages', record.id);
        for (const record of oldEvents) await transaction.delete('events', record.id);
        for (const record of messageRecords) await transaction.put('messages', record);
        for (const record of eventRecords) await transaction.put('events', record);
      }
    );
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const threadId = chatThreadId(conversationId);
    await this.database.transaction(
      ['threads', 'messages', 'events'],
      'readwrite',
      async (transaction) => {
        const messages = await transaction.getAllFromIndex<MessageRecord>(
          'messages',
          'byThreadSequence',
          queryBound([threadId, 0], [threadId, MAX_SEQUENCE])
        );
        const events = await transaction.getAllFromIndex<EventRecord>(
          'events',
          'byThreadGlobalSequence',
          queryBound([threadId, 0], [threadId, MAX_SEQUENCE])
        );
        for (const record of messages) await transaction.delete('messages', record.id);
        for (const record of events) await transaction.delete('events', record.id);
        await transaction.delete('threads', threadId);
      }
    );
  }

  /**
   * Notebooks live in one settings record each.
   *
   * A notebook is a single document — sources, transcript and studio output are
   * only ever read and written together — so the thread/message split the chat
   * uses would buy nothing here but joins.
   */
  async loadNotebooks(): Promise<Notebook[]> {
    const records = await this.settings.list(NOTEBOOK_SCOPE);
    return records
      .map((record) => reviveNotebook(record.value))
      .filter((notebook): notebook is Notebook => notebook !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async saveNotebook(notebook: Notebook): Promise<void> {
    await this.settings.set(notebookKey(notebook.id), NOTEBOOK_SCOPE, jsonValue(notebook));
  }

  async deleteNotebook(notebookId: string): Promise<void> {
    await this.settings.delete(notebookKey(notebookId));
  }

  async loadAgentMessages(projectId: string): Promise<AgentChatMessage[]> {
    const threads = await this.threads.listByProject(projectId);
    const thread =
      threads.find((candidate) => candidate.id === agentThreadId(projectId)) ?? threads[0];
    if (!thread) return [];
    const records = await this.messages.listByThread(thread.id);
    return records
      .map((record) => {
        const source = record.data?.agentMessage ?? record.data?.legacy;
        return source && typeof source === 'object'
          ? (source as unknown as AgentChatMessage)
          : ({
              id: record.id,
              role: record.role,
              content: record.content,
              createdAt: record.createdAt,
            } as AgentChatMessage);
      })
      .filter((message) => message.role === 'user' || message.role === 'assistant');
  }

  async saveAgentMessages(
    projectId: string,
    projectName: string,
    messages: readonly AgentChatMessage[]
  ): Promise<void> {
    const threadId = agentThreadId(projectId);
    const now = Date.now();
    const createdAt = messages[0]?.createdAt ?? now;
    const thread: ThreadRecord = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: threadId,
      projectId,
      title: projectName,
      status: 'idle',
      createdAt,
      updatedAt: Math.max(createdAt, ...messages.map((message) => message.createdAt), now),
      archivedAt: null,
    };
    const records: MessageRecord[] = messages.map((message, sequence) => ({
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: `agent-message:${token(projectId)}:${token(message.id)}`,
      threadId,
      sequence,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      data: { agentMessage: jsonValue(message) },
    }));
    await this.database.transaction(['threads', 'messages'], 'readwrite', async (transaction) => {
      await transaction.put('threads', thread);
      const old = await transaction.getAllFromIndex<MessageRecord>(
        'messages',
        'byThreadSequence',
        queryBound([threadId, 0], [threadId, MAX_SEQUENCE])
      );
      for (const record of old) await transaction.delete('messages', record.id);
      for (const record of records) await transaction.put('messages', record);
    });
  }

  async loadContext(projectId: string, projectName: string): Promise<Record<string, string>> {
    const legacyProjectId = `legacy-project-name:${token(projectName)}`;
    const records = await this.database.transaction(['memories'], 'readonly', async (transaction) => {
      const current = await transaction.getAllFromIndex<MemoryRecord>(
        'memories',
        'byProjectKind',
        queryOnly([projectId, 'context'])
      );
      const legacy = await transaction.getAllFromIndex<MemoryRecord>(
        'memories',
        'byProjectKind',
        queryOnly([legacyProjectId, 'context'])
      );
      return [...legacy, ...current];
    });
    return Object.fromEntries(records.map((record) => [record.key, record.value]));
  }

  async setContext(projectId: string, key: string, value: string): Promise<void> {
    const now = Date.now();
    const record: MemoryRecord = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: `context:${token(projectId)}:${token(key)}`,
      projectId,
      kind: 'context',
      key,
      value,
      contentHash: await sha256Hex(new TextEncoder().encode(value)),
      createdAt: now,
      updatedAt: now,
    };
    await this.database.transaction(['memories'], 'readwrite', (transaction) =>
      transaction.put('memories', record)
    );
  }

  async removeContext(projectId: string, key: string): Promise<void> {
    await this.database.transaction(['memories'], 'readwrite', (transaction) =>
      transaction.delete('memories', `context:${token(projectId)}:${token(key)}`)
    );
  }

  async resetPreservingUsage(): Promise<void> {
    const usage = await Promise.all([
      this.settings.getValue('usage.messageUnits'),
      this.settings.getValue('usage.limitResetTime'),
    ]);
    await this.database.transaction(STORE_NAMES, 'readwrite', async (transaction) => {
      for (const store of STORE_NAMES) await transaction.clear(store);
    });
    if (usage[0] !== undefined) {
      await this.settings.set('usage.messageUnits', 'usage', usage[0]);
    }
    if (usage[1] !== undefined) {
      await this.settings.set('usage.limitResetTime', 'usage', usage[1]);
    }
  }
}

let persistencePromise: Promise<ClientPersistence> | null = null;

/** Test seam for environments such as jsdom that do not implement IndexedDB. */
export function setClientPersistenceForTests(persistence: ClientPersistence | null): void {
  persistencePromise = persistence ? Promise.resolve(persistence) : null;
}

export function getClientPersistence(): Promise<ClientPersistence> {
  if (!persistencePromise) {
    persistencePromise = openStorageDatabase()
      .then(async (database) => {
        await new LegacyLocalStorageMigration({ database }).run();
        return new ClientPersistence(database);
      })
      .catch((error) => {
        persistencePromise = null;
        throw error;
      });
  }
  return persistencePromise;
}
