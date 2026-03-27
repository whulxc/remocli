import path from 'node:path';
import { ensureDir, readJsonIfExists, writeJson } from '../shared/config.js';

const DEFAULT_STATE = {
  order: [],
  hidden: [],
  unreadCompleted: [],
};

export class SessionPreferences {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    ensureDir(path.dirname(this.filePath));
    this.state = this.#load();
  }

  snapshot() {
    return {
      order: [...this.state.order],
      hidden: [...this.state.hidden],
      unreadCompleted: [...this.state.unreadCompleted],
    };
  }

  isHidden(sessionId) {
    return this.state.hidden.includes(sessionId);
  }

  hide(sessionIds) {
    const nextHidden = new Set(this.state.hidden);
    for (const sessionId of normalizeSessionIds(sessionIds)) {
      nextHidden.add(sessionId);
    }
    this.state.hidden = [...nextHidden];
    this.#save();
    return this.snapshot();
  }

  unhide(sessionIds) {
    const toRemove = new Set(normalizeSessionIds(sessionIds));
    this.state.hidden = this.state.hidden.filter((sessionId) => !toRemove.has(sessionId));
    this.#save();
    return this.snapshot();
  }

  setOrder(sessionIds, knownSessionIds = []) {
    const explicitOrder = normalizeSessionIds(sessionIds);
    const known = normalizeSessionIds(knownSessionIds);
    const merged = [];
    const seen = new Set();

    for (const sessionId of explicitOrder) {
      if (seen.has(sessionId)) {
        continue;
      }
      seen.add(sessionId);
      merged.push(sessionId);
    }

    for (const sessionId of this.state.order) {
      if (seen.has(sessionId)) {
        continue;
      }
      seen.add(sessionId);
      merged.push(sessionId);
    }

    for (const sessionId of known) {
      if (seen.has(sessionId)) {
        continue;
      }
      seen.add(sessionId);
      merged.push(sessionId);
    }

    this.state.order = merged;
    this.#save();
    return this.snapshot();
  }

  renameSessionId(previousId, nextId) {
    const from = `${previousId || ''}`.trim();
    const to = `${nextId || ''}`.trim();
    if (!from || !to || from === to) {
      return this.snapshot();
    }

    this.state.order = normalizeSessionIds(this.state.order.map((sessionId) => (sessionId === from ? to : sessionId)));
    this.state.hidden = normalizeSessionIds(this.state.hidden.map((sessionId) => (sessionId === from ? to : sessionId)));
    this.state.unreadCompleted = normalizeSessionIds(this.state.unreadCompleted.map((sessionId) => (sessionId === from ? to : sessionId)));
    this.#save();
    return this.snapshot();
  }

  markCompletedUnread(sessionIds) {
    const nextUnread = new Set(this.state.unreadCompleted);
    for (const sessionId of normalizeSessionIds(sessionIds)) {
      nextUnread.add(sessionId);
    }
    this.state.unreadCompleted = [...nextUnread];
    this.#save();
    return this.snapshot();
  }

  clearCompletedUnread(sessionIds) {
    const toRemove = new Set(normalizeSessionIds(sessionIds));
    if (!toRemove.size) {
      return this.snapshot();
    }
    this.state.unreadCompleted = this.state.unreadCompleted.filter((sessionId) => !toRemove.has(sessionId));
    this.#save();
    return this.snapshot();
  }

  apply(sessions, options = {}) {
    const includeHidden = Boolean(options.includeHidden);
    const hiddenSet = new Set(this.state.hidden);
    const unreadSet = new Set(this.state.unreadCompleted);
    const ordered = [...sessions]
      .map((session) => ({
        ...session,
        hidden: hiddenSet.has(session.id),
        unreadCompleted: unreadSet.has(session.id),
      }))
      .filter((session) => includeHidden || !session.hidden);

    const indexById = new Map(this.state.order.map((sessionId, index) => [sessionId, index]));
    ordered.sort((left, right) => {
      const leftIndex = indexById.has(left.id) ? indexById.get(left.id) : Number.MAX_SAFE_INTEGER;
      const rightIndex = indexById.has(right.id) ? indexById.get(right.id) : Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      const activityDelta = Number(right.activityAt || 0) - Number(left.activityAt || 0);
      if (activityDelta !== 0) {
        return activityDelta;
      }

      return `${left.name || ''}`.localeCompare(`${right.name || ''}`);
    });

    return ordered;
  }

  #load() {
    const raw = readJsonIfExists(this.filePath, DEFAULT_STATE);
    return {
      order: normalizeSessionIds(raw?.order),
      hidden: normalizeSessionIds(raw?.hidden),
      unreadCompleted: normalizeSessionIds(raw?.unreadCompleted),
    };
  }

  #save() {
    writeJson(this.filePath, this.state);
  }
}

function normalizeSessionIds(sessionIds) {
  return [...new Set([...(Array.isArray(sessionIds) ? sessionIds : [])].map((value) => `${value || ''}`.trim()).filter(Boolean))];
}
