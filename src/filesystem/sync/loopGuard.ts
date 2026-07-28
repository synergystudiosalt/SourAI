import type { FileChange, FileChangeOrigin } from '../types';

/**
 * Prevents a consumer from reflecting its own writes and suppresses duplicate
 * watcher delivery without discarding changes from a different origin.
 */
export class FileChangeLoopGuard {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly capacity = 2_048) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new TypeError('Loop guard capacity must be a positive safe integer.');
    }
  }

  shouldProcess(change: FileChange, consumerOrigin: FileChangeOrigin): boolean {
    if (change.origin === consumerOrigin) return false;
    const key = [
      change.revision,
      change.origin,
      change.type,
      change.from ?? '',
      change.path,
    ].join('\u0000');
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.order.push(key);
    if (this.order.length > this.capacity) {
      const oldest = this.order.shift();
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }
}
