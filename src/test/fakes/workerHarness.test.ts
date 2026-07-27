import { describe, expect, it } from 'vitest';

import { FakeWorker, ManualClock, cloneAcrossBoundary, flushAsync } from './workerHarness';

describe('FakeWorker', () => {
  it('delivers messages asynchronously and in order', async () => {
    const worker = new FakeWorker<{ n: number }, { doubled: number }>({
      onMessage: (message, post) => post({ doubled: message.n * 2 }),
    });

    const received: number[] = [];
    worker.addEventListener('message', (event) => received.push(event.data.doubled));

    worker.postMessage({ n: 1 });
    worker.postMessage({ n: 2 });
    expect(received).toEqual([]); // nothing is delivered synchronously

    await flushAsync();
    expect(received).toEqual([2, 4]);
  });

  it('rejects a value that cannot cross a real postMessage boundary', () => {
    const worker = new FakeWorker({ onMessage: () => {} });

    // A handle, a class instance with methods, or a callback all fail here for
    // exactly the reason they fail in a browser.
    expect(() => worker.postMessage({ done: () => {} })).toThrow(/structured-cloneable/);
    expect(() => cloneAcrossBoundary({ el: Symbol('x') }, 'test')).toThrow(/structured-cloneable/);
  });

  it('routes a handler rejection to error listeners rather than an unhandled rejection', async () => {
    const worker = new FakeWorker({
      onMessage: async () => {
        throw new Error('worker blew up');
      },
    });

    const errors: unknown[] = [];
    worker.addEventListener('error', (error) => errors.push(error));
    worker.postMessage({});
    await flushAsync();

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('worker blew up');
  });

  it('stops delivering after terminate', async () => {
    const worker = new FakeWorker<{ n: number }, { n: number }>({
      onMessage: (message, post) => post(message),
    });
    const received: unknown[] = [];
    worker.addEventListener('message', (event) => received.push(event.data));

    worker.postMessage({ n: 1 });
    worker.terminate();
    await flushAsync();

    expect(received).toEqual([]);
    expect(worker.isTerminated).toBe(true);
    expect(() => worker.postMessage({ n: 2 })).toThrow(/terminated/);
  });

  it('nextMessage resolves on a match and rejects on timeout', async () => {
    const worker = new FakeWorker<{ id: string }, { id: string; ok: boolean }>({
      onMessage: (message, post) => post({ id: message.id, ok: true }),
    });

    const pending = worker.nextMessage((message) => message.id === 'b');
    worker.postMessage({ id: 'a' });
    worker.postMessage({ id: 'b' });
    await expect(pending).resolves.toEqual({ id: 'b', ok: true });

    const idle = new FakeWorker({ onMessage: () => {} });
    await expect(idle.nextMessage(() => true, 10)).rejects.toThrow(/Timed out/);
  });
});

describe('ManualClock', () => {
  it('only advances when told to', () => {
    const clock = new ManualClock(1000);
    expect(clock.now()).toBe(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
  });
});
