type Release = () => void;

export class Mutex {
  private locked = false;
  private queue: Array<() => void> = [];

  acquire(): Promise<Release> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this.locked = false;
            const next = this.queue.shift();
            if (next) next();
          });
        }
      };

      if (!this.locked) {
        tryAcquire();
      } else {
        this.queue.push(tryAcquire);
      }
    });
  }

  /** Non-blocking acquire — returns Release if lock is free, null otherwise. */
  tryAcquire(): Release | null {
    if (this.locked) return null;
    this.locked = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.locked = false;
      const next = this.queue.shift();
      if (next) next();
    };
  }

  get isLocked(): boolean {
    return this.locked;
  }
}

const locks = new Map<string, Mutex>();
const MAX_MUTEX_KEYS = 1000;

export function getMutex(key: string): Mutex {
  let mutex = locks.get(key);
  if (mutex) {
    // Move to end for LRU ordering (Map preserves insertion order)
    locks.delete(key);
    locks.set(key, mutex);
    return mutex;
  }
  // Evict oldest unlocked mutexes if map grows too large
  if (locks.size >= MAX_MUTEX_KEYS) {
    for (const [k, m] of locks) {
      if (!m.isLocked) {
        locks.delete(k);
        if (locks.size < MAX_MUTEX_KEYS / 2) break;
      }
    }
  }
  mutex = new Mutex();
  locks.set(key, mutex);
  return mutex;
}
