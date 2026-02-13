const memoryStore = (() => {
  const key = '__SOWHATAI_SAFE_STORAGE_V1__';
  if (!globalThis[key]) {
    globalThis[key] = new Map();
  }
  return globalThis[key];
})();

function getLocalStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getSessionStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getStorageItem(key) {
  const storageKey = String(key || '');
  if (!storageKey) return null;

  const local = getLocalStorage();
  if (local) {
    try {
      return local.getItem(storageKey);
    } catch {}
  }

  const session = getSessionStorage();
  if (session) {
    try {
      return session.getItem(storageKey);
    } catch {}
  }

  return memoryStore.has(storageKey) ? memoryStore.get(storageKey) : null;
}

function setStorageItem(key, value) {
  const storageKey = String(key || '');
  if (!storageKey) return false;
  const storageValue = String(value ?? '');

  const local = getLocalStorage();
  if (local) {
    try {
      local.setItem(storageKey, storageValue);
      return true;
    } catch {}
  }

  const session = getSessionStorage();
  if (session) {
    try {
      session.setItem(storageKey, storageValue);
      return true;
    } catch {}
  }

  memoryStore.set(storageKey, storageValue);
  return false;
}

export { getStorageItem, setStorageItem };
