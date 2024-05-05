import { Base } from "../Base";
import { BaseLogOptions } from "../BaseLog";

import { LockFunc, lockNoOp } from "./locks";

type LockOptions = {
  storageKey: string;
  lock?: LockFunc;
} & BaseLogOptions;

export class Lock extends Base {
  protected lock: LockFunc;
  lockAcquired = false;
  protected pendingInLock: Promise<any>[] = [];

  protected storageKey: string;

  constructor(options: LockOptions) {
    super({ debug: options.debug });
    this.lock = options.lock || lockNoOp;
    this.storageKey = options.storageKey;
  }

  /**
   * Acquires a global lock based on the storage key.
   */
  async _acquireLock<R>(
    acquireTimeout: number,
    fn: () => Promise<R>
  ): Promise<R> {
    this._debug("#_acquireLock", "begin", acquireTimeout);

    try {
      if (this.lockAcquired) {
        const last = this.pendingInLock.length
          ? this.pendingInLock[this.pendingInLock.length - 1]
          : Promise.resolve();

        const result = (async () => {
          await last;
          return await fn();
        })();

        this.pendingInLock.push(
          (async () => {
            try {
              await result;
            } catch (e: any) {
              // we just care if it finished
            }
          })()
        );

        return result;
      }

      return await this.lock(
        `lock:${this.storageKey}`,
        acquireTimeout,
        async () => {
          this._debug(
            "#_acquireLock",
            "lock acquired for storage key",
            this.storageKey
          );

          try {
            this.lockAcquired = true;

            const result = fn();

            this.pendingInLock.push(
              (async () => {
                try {
                  await result;
                } catch (e: any) {
                  // we just care if it finished
                }
              })()
            );

            await result;

            // keep draining the queue until there's nothing to wait on
            while (this.pendingInLock.length) {
              const waitOn = [...this.pendingInLock];

              await Promise.all(waitOn);

              this.pendingInLock.splice(0, waitOn.length);
            }

            return await result;
          } finally {
            this._debug(
              "#_acquireLock",
              "lock released for storage key",
              this.storageKey
            );

            this.lockAcquired = false;
          }
        }
      );
    } finally {
      this._debug("#_acquireLock", "end");
    }
  }
}
