/**
 * Worker test harness.
 *
 * The agent orchestrator, the storage layer, and the indexer all run in
 * dedicated workers. Booting real workers in unit tests is slow and hides the
 * failure mode that actually bites: passing something across `postMessage`
 * that cannot be structured-cloned (a callback, a React element, or a
 * `Proxy`). Platform handles such as `FileSystemHandle` are intentionally not
 * listed here: browsers define those as serializable even though a plain-JS
 * test double containing methods is not.
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
type ErrorListener = (event: ErrorEvent) => void;

interface IdleTrackable {
  readonly isIdle: boolean;
  whenIdle(): Promise<void>;
}

/** Workers known to the harness, so compatibility flushes can drain all of them. */
const trackedWorkers = new Set<IdleTrackable>();

export class FakeWorker<TIn = unknown, TOut = unknown> {
  private readonly mainListeners = new Set<MessageListener<TOut>>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly inboundQueue: TIn[] = [];
  private inboundScheduled = false;
  private inFlightHandlers = 0;
  private pendingDeliveries = 0;
  private readonly idleWaiters = new Set<() => void>();
  private terminated = false;
  /** Every message that crossed the boundary, in order. */
  readonly sent: TIn[] = [];
  readonly received: TOut[] = [];

  constructor(private readonly handlers: FakeWorkerHandlers<TIn, TOut>) {}

  /** Main-thread side: send a message to the worker. */
  postMessage(message: TIn): void {
    if (this.terminated) throw new Error('postMessage called on a terminated worker');
    const cloned = cloneAcrossBoundary(message, 'main → worker');
    trackedWorkers.add(this);
    this.sent.push(cloned);
    this.inboundQueue.push(cloned);
    this.scheduleInboundTask();
  }

  /**
   * A real Worker receives each message from the browser task queue, after the
   * sender's current task and its microtasks complete. Using `queueMicrotask`
   * here makes promise callbacks observe the wrong ordering, so one queued
   * timer is used per message.
   */
  private scheduleInboundTask(): void {
    if (this.inboundScheduled || this.terminated || this.inboundQueue.length === 0) return;
    this.inboundScheduled = true;
    setTimeout(() => {
      this.inboundScheduled = false;
      if (this.terminated) {
        this.resolveIdleWaiters();
        return;
      }
      if (this.inboundQueue.length === 0) {
        this.resolveIdleWaiters();
        return;
      }
      // `undefined` is valid structured-cloneable message data, so queue
      // length—not the shifted value—determines whether work exists.
      const message = this.inboundQueue.shift() as TIn;
      this.inFlightHandlers++;
      this.scheduleInboundTask();

      // Starting from an already-resolved promise catches both a synchronous
      // throw and an async rejection from the handler.
      void Promise.resolve()
        .then(() => this.handlers.onMessage(message, (reply) => this.emit(reply)))
        .catch((error) => this.emitError(error))
        .finally(() => {
          this.inFlightHandlers--;
          this.resolveIdleWaiters();
        });
    }, 0);
  }

  private emit(reply: TOut): void {
    if (this.terminated) return;
    const cloned = cloneAcrossBoundary(reply, 'worker → main');
    trackedWorkers.add(this);
    this.received.push(cloned);
    this.pendingDeliveries++;
    setTimeout(() => {
      try {
        if (this.terminated) return;
        const event = { data: cloned } as MessageEvent<TOut>;
        for (const listener of this.mainListeners) listener(event);
      } finally {
        this.pendingDeliveries--;
        this.resolveIdleWaiters();
      }
    }, 0);
  }

  private emitError(error: unknown): void {
    const event = createWorkerErrorEvent(error);
    trackedWorkers.add(this);
    this.pendingDeliveries++;
    setTimeout(() => {
      try {
        if (this.terminated) return;
        for (const listener of this.errorListeners) listener(event);
      } finally {
        this.pendingDeliveries--;
        this.resolveIdleWaiters();
      }
    }, 0);
  }

  addEventListener(type: 'message', listener: MessageListener<TOut>): void;
  addEventListener(type: 'error', listener: ErrorListener): void;
  addEventListener(type: 'message' | 'error', listener: MessageListener<TOut> | ErrorListener): void {
    if (type === 'message') this.mainListeners.add(listener as MessageListener<TOut>);
    else this.errorListeners.add(listener as ErrorListener);
  }

  removeEventListener(type: 'message', listener: MessageListener<TOut>): void;
  removeEventListener(type: 'error', listener: ErrorListener): void;
  removeEventListener(type: 'message' | 'error', listener: MessageListener<TOut> | ErrorListener): void {
    if (type === 'message') this.mainListeners.delete(listener as MessageListener<TOut>);
    else this.errorListeners.delete(listener as ErrorListener);
  }

  terminate(): void {
    this.terminated = true;
    this.inboundQueue.length = 0;
    this.mainListeners.clear();
    this.errorListeners.clear();
    trackedWorkers.delete(this);
    this.resolveIdleWaiters();
  }

  get isTerminated(): boolean {
    return this.terminated;
  }

  /** True when no queued, scheduled, executing, or outbound work remains. */
  get isIdle(): boolean {
    return (
      this.terminated ||
      (
        this.inboundQueue.length === 0 &&
        !this.inboundScheduled &&
        this.inFlightHandlers === 0 &&
        this.pendingDeliveries === 0
      )
    );
  }

  /**
   * Resolves only after the complete worker/message chain is idle.
   *
   * Replies posted by async handlers and new inbound messages posted by main
   * listeners are included because both increment tracked work before the
   * preceding task can become idle.
   */
  whenIdle(): Promise<void> {
    if (this.isIdle) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }

  private resolveIdleWaiters(): void {
    if (!this.isIdle) return;
    trackedWorkers.delete(this);
    const waiters = [...this.idleWaiters];
    this.idleWaiters.clear();
    for (const resolve of waiters) resolve();
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

function createWorkerErrorEvent(error: unknown): ErrorEvent {
  const message = error instanceof Error ? error.message : String(error);
  return new ErrorEvent('error', {
    message,
    filename: 'fake-worker',
    lineno: 0,
    colno: 0,
    error,
    cancelable: true,
  });
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

/**
 * Waits for complete worker/message chains rather than guessing a timer count.
 *
 * Passing workers limits the wait to those instances. With no arguments, every
 * worker created by this harness is drained for backwards compatibility.
 */
export async function flushAsync(...workers: IdleTrackable[]): Promise<void> {
  const explicitWorkers = workers.length > 0 ? workers : null;
  while (true) {
    const current = explicitWorkers ?? [...trackedWorkers];
    await Promise.all(current.map((worker) => worker.whenIdle()));
    // Let promise continuations from the final task enqueue follow-up work
    // before confirming that the chain is truly quiescent.
    await Promise.resolve();
    const finalWorkers = explicitWorkers ?? [...trackedWorkers];
    if (finalWorkers.every((worker) => worker.isIdle)) return;
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
