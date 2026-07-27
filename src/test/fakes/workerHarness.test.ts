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

    await worker.whenIdle();
    expect(received).toEqual([2, 4]);
  });

  it('uses the task queue, so sender microtasks run before worker delivery', async () => {
    const order: string[] = [];
    const worker = new FakeWorker({
      onMessage: () => {
        order.push('worker');
      },
    });

    worker.postMessage({});
    await Promise.resolve().then(() => order.push('sender microtask'));

    expect(order).toEqual(['sender microtask']);
    await worker.whenIdle();
    expect(order).toEqual(['sender microtask', 'worker']);
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

    const errors: ErrorEvent[] = [];
    worker.addEventListener('error', (event) => {
      expect(event.type).toBe('error');
      expect(event.cancelable).toBe(true);
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
      errors.push(event);
    });
    worker.postMessage({});
    await worker.whenIdle();

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('worker blew up');
    expect(errors[0].error).toBeInstanceOf(Error);
    expect((errors[0].error as Error).message).toBe('worker blew up');
    expect(errors[0].filename).toBe('fake-worker');
    expect(errors[0].defaultPrevented).toBe(true);
  });

  it('routes a synchronous handler throw to error listeners', async () => {
    const worker = new FakeWorker({
      onMessage: () => {
        throw new Error('synchronous worker failure');
      },
    });

    const errors: ErrorEvent[] = [];
    worker.addEventListener('error', (event) => errors.push(event));
    worker.postMessage({});
    await worker.whenIdle();

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('synchronous worker failure');
    expect((errors[0].error as Error).message).toBe('synchronous worker failure');
  });

  it('stops delivering after terminate', async () => {
    const worker = new FakeWorker<{ n: number }, { n: number }>({
      onMessage: (message, post) => post(message),
    });
    const received: unknown[] = [];
    worker.addEventListener('message', (event) => received.push(event.data));

    worker.postMessage({ n: 1 });
    worker.terminate();
    await worker.whenIdle();

    expect(received).toEqual([]);
    expect(worker.isTerminated).toBe(true);
    expect(() => worker.postMessage({ n: 2 })).toThrow(/terminated/);
  });

  it('drains listener-triggered message chains longer than three task turns', async () => {
    const worker = new FakeWorker<number, number>({
      onMessage: (message, post) => post(message),
    });
    const received: number[] = [];
    worker.addEventListener('message', (event) => {
      received.push(event.data);
      if (event.data < 12) worker.postMessage(event.data + 1);
    });

    worker.postMessage(0);
    await flushAsync(worker);

    expect(received).toEqual(Array.from({ length: 13 }, (_, index) => index));
    expect(worker.isIdle).toBe(true);
  });

  it('waits for in-flight async handlers and their outbound delivery', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = new FakeWorker<string, string>({
      onMessage: async (message, post) => {
        await gate;
        post(message.toUpperCase());
      },
    });
    const received: string[] = [];
    worker.addEventListener('message', (event) => received.push(event.data));

    worker.postMessage('ready');
    let idleResolved = false;
    const idle = worker.whenIdle().then(() => {
      idleResolved = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(idleResolved).toBe(false);

    release?.();
    await idle;
    expect(received).toEqual(['READY']);
  });

  it('delivers undefined as valid structured-cloneable message data', async () => {
    const handled: unknown[] = [];
    const worker = new FakeWorker<undefined, string>({
      onMessage: (message, post) => {
        handled.push(message);
        post('handled');
      },
    });

    worker.postMessage(undefined);
    await worker.whenIdle();

    expect(handled).toEqual([undefined]);
    expect(worker.received).toEqual(['handled']);
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
