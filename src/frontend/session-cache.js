const DB_NAME = 'remote-connect-session-cache';
const DB_VERSION = 1;
const SESSION_CACHE_SCHEMA_VERSION = 'v3';
const SUMMARY_STORE = 'session_summaries';
const DETAIL_STORE = 'session_item_details';
export const DEFAULT_SESSION_CACHE_MAX_BYTES = 200 * 1024 * 1024;

export function buildSessionCacheScope(origin = '', clientId = '') {
  return `${origin || ''}::${clientId || ''}::${SESSION_CACHE_SCHEMA_VERSION}`;
}

export function estimateCacheRecordSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function planSessionCachePrune(records, maxBytes = DEFAULT_SESSION_CACHE_MAX_BYTES) {
  const normalizedMaxBytes = Math.max(0, Number(maxBytes) || 0);
  const sortedRecords = [...(records || [])].sort(
    (left, right) => Number(left?.lastAccessAt || 0) - Number(right?.lastAccessAt || 0)
      || Number(left?.updatedAt || 0) - Number(right?.updatedAt || 0),
  );
  let totalBytes = sortedRecords.reduce((sum, record) => sum + Number(record?.sizeBytes || 0), 0);
  if (totalBytes <= normalizedMaxBytes) {
    return {
      totalBytes,
      remove: [],
    };
  }

  const remove = [];
  for (const record of sortedRecords) {
    if (totalBytes <= normalizedMaxBytes) {
      break;
    }
    totalBytes -= Number(record?.sizeBytes || 0);
    remove.push(record);
  }

  return {
    totalBytes: Math.max(0, totalBytes),
    remove,
  };
}

export async function loadSessionSummaryCache(scope, sessionId) {
  const record = await getRecord(SUMMARY_STORE, buildSummaryKey(scope, sessionId));
  if (!record) {
    return null;
  }
  touchRecord(SUMMARY_STORE, record).catch(() => {});
  return record.payload || null;
}

export async function saveSessionSummaryCache(scope, sessionId, payload, options = {}) {
  if (!scope || !sessionId || !payload) {
    return null;
  }
  const timestamp = Date.now();
  const record = {
    key: buildSummaryKey(scope, sessionId),
    scope,
    sessionId,
    payload,
    updatedAt: timestamp,
    lastAccessAt: timestamp,
    sizeBytes: estimateCacheRecordSize(payload),
  };
  await putRecord(SUMMARY_STORE, record);
  await pruneSessionCache(options.maxBytes);
  return payload;
}

export async function loadConversationItemDetailCache(scope, sessionId, itemId) {
  const record = await getRecord(DETAIL_STORE, buildDetailKey(scope, sessionId, itemId));
  if (!record) {
    return null;
  }
  touchRecord(DETAIL_STORE, record).catch(() => {});
  return record.payload || null;
}

export async function saveConversationItemDetailCache(scope, sessionId, itemId, payload, options = {}) {
  if (!scope || !sessionId || !itemId || !payload) {
    return null;
  }
  const timestamp = Date.now();
  const record = {
    key: buildDetailKey(scope, sessionId, itemId),
    scope,
    sessionId,
    itemId,
    payload,
    updatedAt: timestamp,
    lastAccessAt: timestamp,
    sizeBytes: estimateCacheRecordSize(payload),
  };
  await putRecord(DETAIL_STORE, record);
  await pruneSessionCache(options.maxBytes);
  return payload;
}

export async function renameSessionCacheEntries(scope, previousSessionId, nextSessionId, options = {}) {
  if (!scope || !previousSessionId || !nextSessionId || previousSessionId === nextSessionId) {
    return;
  }
  const { db, recordsByStore } = await getAllStoreRecords([SUMMARY_STORE, DETAIL_STORE]);
  if (!db) {
    return;
  }
  const transaction = db.transaction([SUMMARY_STORE, DETAIL_STORE], 'readwrite');
  const summaryStore = transaction.objectStore(SUMMARY_STORE);
  const detailStore = transaction.objectStore(DETAIL_STORE);
  const summaryRecords = recordsByStore.get(SUMMARY_STORE) || [];
  const detailRecords = recordsByStore.get(DETAIL_STORE) || [];

  for (const record of summaryRecords.filter(matchesSession(scope, previousSessionId))) {
    summaryStore.delete(record.key);
    summaryStore.put({
      ...record,
      key: buildSummaryKey(scope, nextSessionId),
      sessionId: nextSessionId,
      updatedAt: Date.now(),
      lastAccessAt: Date.now(),
    });
  }

  for (const record of detailRecords.filter(matchesSession(scope, previousSessionId))) {
    detailStore.delete(record.key);
    detailStore.put({
      ...record,
      key: buildDetailKey(scope, nextSessionId, record.itemId),
      sessionId: nextSessionId,
      updatedAt: Date.now(),
      lastAccessAt: Date.now(),
    });
  }

  await transactionAsPromise(transaction);
  await pruneSessionCache(options.maxBytes);
}

export async function removeSessionCacheEntries(scope, sessionIds) {
  const normalizedSessionIds = [...new Set((sessionIds || []).map((value) => `${value || ''}`.trim()).filter(Boolean))];
  if (!scope || !normalizedSessionIds.length) {
    return;
  }
  const { db, recordsByStore } = await getAllStoreRecords([SUMMARY_STORE, DETAIL_STORE]);
  if (!db) {
    return;
  }
  const sessionIdSet = new Set(normalizedSessionIds);
  const transaction = db.transaction([SUMMARY_STORE, DETAIL_STORE], 'readwrite');
  const summaryStore = transaction.objectStore(SUMMARY_STORE);
  const detailStore = transaction.objectStore(DETAIL_STORE);
  const summaryRecords = recordsByStore.get(SUMMARY_STORE) || [];
  const detailRecords = recordsByStore.get(DETAIL_STORE) || [];

  for (const record of summaryRecords) {
    if (`${record?.scope || ''}` === scope && sessionIdSet.has(`${record?.sessionId || ''}`)) {
      summaryStore.delete(record.key);
    }
  }

  for (const record of detailRecords) {
    if (`${record?.scope || ''}` === scope && sessionIdSet.has(`${record?.sessionId || ''}`)) {
      detailStore.delete(record.key);
    }
  }

  await transactionAsPromise(transaction);
}

async function touchRecord(storeName, record) {
  await putRecord(storeName, {
    ...record,
    lastAccessAt: Date.now(),
  });
}

async function getRecord(storeName, key) {
  const db = await openDb();
  if (!db) {
    return null;
  }
  const transaction = db.transaction(storeName, 'readonly');
  const record = await requestAsPromise(transaction.objectStore(storeName).get(key));
  await transactionAsPromise(transaction);
  return record || null;
}

async function putRecord(storeName, record) {
  const db = await openDb();
  if (!db) {
    return null;
  }
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(record);
  await transactionAsPromise(transaction);
  return record;
}

async function pruneSessionCache(maxBytes = DEFAULT_SESSION_CACHE_MAX_BYTES) {
  const { db, recordsByStore } = await getAllStoreRecords([SUMMARY_STORE, DETAIL_STORE]);
  if (!db) {
    return;
  }
  const transaction = db.transaction([SUMMARY_STORE, DETAIL_STORE], 'readwrite');
  const summaryStore = transaction.objectStore(SUMMARY_STORE);
  const detailStore = transaction.objectStore(DETAIL_STORE);
  const summaryRecords = recordsByStore.get(SUMMARY_STORE) || [];
  const detailRecords = recordsByStore.get(DETAIL_STORE) || [];
  const prunePlan = planSessionCachePrune([...summaryRecords, ...detailRecords], maxBytes);
  for (const record of prunePlan.remove) {
    if (`${record?.itemId || ''}`) {
      detailStore.delete(record.key);
      continue;
    }
    summaryStore.delete(record.key);
  }
  await transactionAsPromise(transaction);
}

let openDbPromise = null;

async function openDb() {
  if (typeof indexedDB === 'undefined') {
    return null;
  }
  if (openDbPromise) {
    return openDbPromise;
  }
  openDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SUMMARY_STORE)) {
        db.createObjectStore(SUMMARY_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(DETAIL_STORE)) {
        db.createObjectStore(DETAIL_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return openDbPromise;
}

function buildSummaryKey(scope, sessionId) {
  return `${scope}::summary::${sessionId}`;
}

function buildDetailKey(scope, sessionId, itemId) {
  return `${scope}::detail::${sessionId}::${itemId}`;
}

function matchesSession(scope, sessionId) {
  return (record) => `${record?.scope || ''}` === scope && `${record?.sessionId || ''}` === sessionId;
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionAsPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function getAllStoreRecords(storeNames) {
  const db = await openDb();
  if (!db) {
    return {
      db: null,
      recordsByStore: new Map(),
    };
  }
  const transaction = db.transaction(storeNames, 'readonly');
  const requests = storeNames.map((storeName) => requestAsPromise(transaction.objectStore(storeName).getAll()));
  const values = await Promise.all(requests);
  await transactionAsPromise(transaction);
  return {
    db,
    recordsByStore: new Map(storeNames.map((storeName, index) => [storeName, values[index] || []])),
  };
}
