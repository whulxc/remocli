export class StableSessionCache {
  constructor() {
    this.entries = new Map();
  }

  getPreview(sessionName) {
    return this.#entry(sessionName)?.preview || null;
  }

  setPreview(sessionName, payload) {
    if (!sessionName || !payload) {
      return null;
    }
    const entry = this.#ensureEntry(sessionName);
    entry.preview = clonePayload(payload);
    return entry.preview;
  }

  getDetail(sessionName, lineCount) {
    const normalizedLineCount = normalizeLineCount(lineCount);
    if (!normalizedLineCount) {
      return null;
    }
    return this.#entry(sessionName)?.detail.get(normalizedLineCount) || null;
  }

  setDetail(sessionName, lineCount, payload) {
    const normalizedLineCount = normalizeLineCount(lineCount);
    if (!sessionName || !normalizedLineCount || !payload) {
      return null;
    }
    const entry = this.#ensureEntry(sessionName);
    const nextPayload = clonePayload(payload);
    entry.detail.set(normalizedLineCount, nextPayload);
    return nextPayload;
  }

  renameSession(previousName, nextName) {
    const previousKey = `${previousName || ''}`.trim();
    const nextKey = `${nextName || ''}`.trim();
    if (!previousKey || !nextKey || previousKey === nextKey) {
      return;
    }
    const entry = this.entries.get(previousKey);
    if (!entry) {
      return;
    }
    this.entries.set(nextKey, entry);
    this.entries.delete(previousKey);
  }

  removeSession(sessionName) {
    this.entries.delete(`${sessionName || ''}`.trim());
  }

  #entry(sessionName) {
    return this.entries.get(`${sessionName || ''}`.trim()) || null;
  }

  #ensureEntry(sessionName) {
    const key = `${sessionName || ''}`.trim();
    const existing = this.entries.get(key);
    if (existing) {
      return existing;
    }
    const created = {
      preview: null,
      detail: new Map(),
    };
    this.entries.set(key, created);
    return created;
  }
}

function normalizeLineCount(value) {
  const parsed = Number.parseInt(`${value ?? ''}`, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
}

function clonePayload(payload) {
  return structuredClone(payload);
}
