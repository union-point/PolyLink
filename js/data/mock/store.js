import { config } from '../../config.js';
import { DataError } from '../errors.js';
import { createSeed } from './seed.js';

let database;
function open() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(config.mockDatabase, config.mockSchemaVersion);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(new DataError('STORAGE', 'Չհաջողվեց բացել ցուցադրական պահոցը։')); };
    request.onblocked = () => reject(new DataError('STORAGE', 'Փակեք մյուս ցուցադրական էջերը և կրկին փորձեք։'));
  });
  return database;
}

// The complete dataset is read and written in one transaction. Concurrent page writes
// serialize through IndexedDB rather than overwriting a stale in-memory snapshot.
export async function transaction(action, { write = false, reset = false } = {}) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    const store = tx.objectStore('state');
    let result;
    let failure;
    const request = store.get('dataset');
    request.onsuccess = () => {
      try {
        const state = reset || !request.result ? createSeed() : request.result;
        result = action(state);
        if (result instanceof Promise) throw new Error('Mock transaction actions must be synchronous');
        if (write || reset || !request.result) store.put(state, 'dataset');
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(failure || new DataError('STORAGE', 'Չհաջողվեց պահպանել տվյալները։ Ստուգեք դիտարկիչի պահոցը։', {}, true));
  });
}

export function nextId(state, prefix) {
  state.sequence += 1;
  return `${prefix}-${state.sequence}`;
}
