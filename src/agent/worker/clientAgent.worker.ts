/// <reference lib="webworker" />

import { RepositoryEventSink } from '../replay';
import { openStorageDatabase } from '../../storage/database';
import { EventsRepository } from '../../storage/repositories/events';
import { startAgentWorkerHost } from './host';
import type { WorkerMessagePort } from './protocol';

/**
 * Production agent worker.
 *
 * It contributes durable storage and nothing else: the provider, model, tools,
 * filesystem, and context scope all arrive with the host's `init` message and
 * are validated there. There is no default provider, so a run cannot silently
 * fall back to a stand-in.
 */
const port = self as unknown as WorkerMessagePort;

/**
 * Storage opens asynchronously, so messages can arrive before the host exists.
 * Buffering them here means the first `init` is never dropped and the panel does
 * not have to wait for a handshake before configuring the run.
 */
const pending: unknown[] = [];
const buffer = (event: MessageEvent<unknown>) => {
  if (pending.length < 64) pending.push(event.data);
};
port.addEventListener('message', buffer);

void openStorageDatabase()
  .then((database) => {
    startAgentWorkerHost(port, { sink: new RepositoryEventSink(new EventsRepository(database)) });
    port.removeEventListener('message', buffer);
    for (const data of pending.splice(0)) {
      self.dispatchEvent(new MessageEvent('message', { data }));
    }
  })
  .catch(() => {
    port.removeEventListener('message', buffer);
    pending.splice(0);
    port.postMessage({
      kind: 'worker.degraded',
      error: {
        code: 'worker_storage_failed',
        message: 'The local agent could not open durable event storage.',
        retryable: true,
        causeCategory: 'storage',
      },
    });
  });
