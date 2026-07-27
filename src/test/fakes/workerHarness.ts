/**
 * Worker test harness.
 *
 * The agent orchestrator, the storage layer, and the indexer all run in
 * dedicated workers. Booting real workers in unit tests is slow and hides the
 * failure mode that actually bites: passing something across `postMessage`
 * that cannot be structured-cloned (a `FileSystemHandle`, a class instance
 * with methods, a React element, a `Proxy`).
 *
 * `FakeWorker` runs the worker body in the same realm but forces every message
 * through `structuredClone`, so those bugs surface here instead of in the
 * browser.
 */

export interface FakeWorkerHandlers<TIn, TOut> {
  /** Worker-side message handler. May emit any number of replies. */
  onMessage(message: TIn, post: (reply: TOut) => void): void | Promise<void>;
}

type MessageListener<T> = (event: MessageEvent<T>) => void;

export class FakeWorker<TIn = unknown, TOut = unknown> {
  private readonly mainListeners = new Set<MessageListener<TOut>>();
  private readonly errorListeners = new Set<(event: unknown) => void>();
  private terminated = false;
  /** Every message that crossed the boundary, in order. */
  readonly sent: TIn[] = [];
  readonly received: TOut[] = [];

  constructor(private readonly handlers: FakeWorkerHandlers<TIn, TOut>) {}

  /** Main-thread side: send a message to the worker. */
  postMessage(message: TIn): void {
    if (this.terminated) throw new Error('postMessage called on a terminated worker');
    const cloned = cloneAcrossBoundary(message, 'main → worker');
    this.sent.push(cloned);
    // Deliver asynchronously, like a real worker, so tests cannot accidentally
    // depend on synchronous delivery.
    queueMicrotask(() => {
      if (this.terminated) return;
      void Promise.resolve(this.handlers.onMessage(cloned, (reply) => this.emit(reply))).catch((error) => {
        for (const listener of this.errorListeners) listener(error);
      });
    });
  }

  private emit(reply: TOut): void {
    if (this.terminated) return;
    const cloned = cloneAcrossBoundary(reply, 'worker → main');
    this.received.push(cloned);
    queueMicrotask(() => {
      if (this.terminated) return;
      const event = { data: cloned } as MessageEvent<TOut>;
      for (const listener of this.mainListeners) listener(event);
    });
  }

  addEventListener(type: 'message', listener: MessageListener<TOut>): void;
  addEventListener(type: 'error', listener: (error: unknown) => void): void;
  addEventListener(type: 'message' | 'error', listener: MessageListener<TOut> | ((error: unknown) => void)): void {
    if (type === 'message') this.mainListeners.add(listener as MessageListener<TOut>);
    else this.errorListeners.add(listener as (error: unknown) => void);
  }

  removeEventListener(type: 'message', listener: MessageListener<TOut>): void;
  removeEventListener(type: 'error', listener: (error: unknown) => void): void;
  removeEventListener(type: 'message' | 'error', listener: MessageListener<TOut> | ((error: unknown) => void)): void {
    if (type === 'message') this.mainListeners.delete(listener as MessageListener<TOut>);
    else this.errorListeners.delete(listener as (error: unknown) => void);
  }

  terminate(): void {
    this.terminated = true;
    this.mainListeners.clear();
    this.errorListeners.clear();
  }

  get isTerminated(): boolean {
    return this.terminated;
  }

  /** Resolves with the next message matching `predicate`, or rejects on timeout. */
  nextMessage(predicate: (message: TOut) => boolean = () => true, timeoutMs = 1000): Promise<TOut> {
    return new Promise<TOut>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeEventListener('message', listener);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for a worker message`));
      }, timeoutMs);

      const listener: MessageListener<TOut> = (event) => {
        if (!predicate(event.data)) return;
        clearTimeout(timer);
        this.removeEventListener('message', listener);
        resolve(event.data);
      };

      this.addEventListener('message', listener);
    });
  }
}

/**
 * Enforces the `postMessage` contract. A real worker boundary throws
 * `DataCloneError` for non-cloneable values; so does this.
 */
export function cloneAcrossBoundary<T>(value: T, direction: string): T {
  try {
    return structuredClone(value);
  } catch (error) {
    throw new Error(
      `Value is not structured-cloneable and cannot cross the ${direction} worker boundary. ` +
        `Send plain data instead of handles, class instances, or functions. Original: ${String(error)}`
    );
  }
}

/** Flushes pending microtasks and timers so queued worker messages deliver. */
export async function flushAsync(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Deterministic clock for budget, timeout, and lease-expiry tests. Nothing in
 * the runtime may read `Date.now()` directly once the orchestrator lands; it
 * takes a clock so those paths stay testable without fake timers.
 */
export class ManualClock {
  constructor(private current = 1_700_000_000_000) {}

  now = (): number => this.current;

  advance(ms: number): void {
    this.current += ms;
  }
}
