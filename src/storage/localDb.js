/*
 * IndexedDB 本地存储（PRD 7.5 / 7.9.4）。
 *
 * 三个对象仓库：
 *   files  —— 远端文件缓存 { key, sha, etag, content, fetchedAt }
 *   drafts —— 未提交草稿   { projectId, content, savedAt }
 *   meta   —— 小型键值     { key, value }
 */

const DB_NAME = 'pm-tools'
const DB_VERSION = 1
const STORE_FILES = 'files'
const STORE_DRAFTS = 'drafts'
const STORE_META = 'meta'

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
        db.createObjectStore(STORE_DRAFTS, { keyPath: 'projectId' })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function getOne(storeName, key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key)
        request.onsuccess = () => resolve(request.result ?? null)
        request.onerror = () => reject(request.error)
      }),
  )
}

function getAll(storeName) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
        request.onsuccess = () => resolve(request.result ?? [])
        request.onerror = () => reject(request.error)
      }),
  )
}

function putOne(storeName, value) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value)
        request.onsuccess = () => resolve(true)
        request.onerror = () => reject(request.error)
      }),
  )
}

function deleteOne(storeName, key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key)
        request.onsuccess = () => resolve(true)
        request.onerror = () => reject(request.error)
      }),
  )
}

/* ---------------- 文件缓存 ---------------- */

export const fileCache = {
  get: (key) => getOne(STORE_FILES, key),
  getAll: () => getAll(STORE_FILES),
  put: (record) => putOne(STORE_FILES, record),
  remove: (key) => deleteOne(STORE_FILES, key),
  clear: () => openDb().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction(STORE_FILES, 'readwrite').objectStore(STORE_FILES).clear()
    request.onsuccess = () => resolve(true)
    request.onerror = () => reject(request.error)
  })),
}

/* ---------------- 草稿（FR-17） ---------------- */

export const drafts = {
  get: (projectId) => getOne(STORE_DRAFTS, projectId),
  getAll: () => getAll(STORE_DRAFTS),
  put: (draft) => putOne(STORE_DRAFTS, draft),
  remove: (projectId) => deleteOne(STORE_DRAFTS, projectId),
  clear: () => openDb().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction(STORE_DRAFTS, 'readwrite').objectStore(STORE_DRAFTS).clear()
    request.onsuccess = () => resolve(true)
    request.onerror = () => reject(request.error)
  })),
}

/* ---------------- 小型键值 ---------------- */

export const meta = {
  get: (key) => getOne(STORE_META, key).then((row) => row?.value ?? null),
  put: (key, value) => putOne(STORE_META, { key, value }),
  remove: (key) => deleteOne(STORE_META, key),
}

export const META_KEYS = {
  lastSyncAt: 'lastSyncAt',
}
