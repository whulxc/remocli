export class LockManager {
  constructor(lockTtlMs = 15 * 60 * 1000) {
    this.lockTtlMs = lockTtlMs;
    this.locks = new Map();
  }

  cleanup() {
    const now = Date.now();
    for (const [sessionId, lock] of this.locks.entries()) {
      if (lock.expiresAt <= now) {
        this.locks.delete(sessionId);
      }
    }
  }

  get(sessionId) {
    this.cleanup();
    return this.locks.get(sessionId) || null;
  }

  acquire(sessionId, owner) {
    this.cleanup();
    const current = this.locks.get(sessionId);
    if (current && current.owner !== owner) {
      return {
        ok: false,
        current,
      };
    }

    const lock = {
      owner,
      expiresAt: Date.now() + this.lockTtlMs,
    };

    this.locks.set(sessionId, lock);
    return {
      ok: true,
      lock,
    };
  }

  forceAcquire(sessionId, owner) {
    this.cleanup();
    const previous = this.locks.get(sessionId) || null;
    const lock = {
      owner,
      expiresAt: Date.now() + this.lockTtlMs,
    };

    this.locks.set(sessionId, lock);
    return {
      ok: true,
      lock,
      replaced: previous,
    };
  }

  release(sessionId, owner) {
    const current = this.locks.get(sessionId);
    if (!current) {
      return true;
    }

    if (current.owner !== owner) {
      return false;
    }

    this.locks.delete(sessionId);
    return true;
  }
}
