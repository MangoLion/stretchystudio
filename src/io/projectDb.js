const DB_NAME = 'stretchystudio-db';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

/**
 * Open the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * List all projects in the database.
 * @returns {Promise<Array>} Sorted by updatedAt desc.
 */
export async function listProjects() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const projects = request.result;
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(projects);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save a project to the database.
 * @param {string|null} id — Existing ID to overwrite, or null to create.
 * @param {string} name — Project name.
 * @param {Blob} blob — .stretch ZIP blob.
 * @param {string} thumbnail — Data URL of the preview image.
 * @returns {Promise<string>} The ID of the saved project.
 */
export async function saveToDb(id, name, blob, thumbnail) {
  const db = await openDb();
  const currentId = id || Math.random().toString(36).slice(2, 9);
  const updatedAt = Date.now();

  const record = {
    id: currentId,
    name,
    blob,
    thumbnail,
    updatedAt,
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onsuccess = () => resolve(currentId);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Load a project from the database.
 * @param {string} id
 * @returns {Promise<Object>}
 */
export async function loadFromDb(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a project from the database.
 * @param {string} id
 */
export async function deleteProject(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update the name of an existing project.
 * @param {string} id
 * @param {string} newName
 */
export async function updateProjectName(id, newName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const record = getRequest.result;
      if (!record) return reject(new Error('Project not found'));
      record.name = newName;
      record.updatedAt = Date.now();
      const putRequest = store.put(record);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Create a copy of an existing project.
 * @param {string} id
 */
export async function duplicateProject(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const record = getRequest.result;
      if (!record) return reject(new Error('Project not found'));
      const newRecord = {
        ...record,
        id: Math.random().toString(36).slice(2, 9),
        name: `${record.name} (Copy)`,
        updatedAt: Date.now(),
      };
      const putRequest = store.put(newRecord);
      putRequest.onsuccess = () => resolve(newRecord.id);
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}
