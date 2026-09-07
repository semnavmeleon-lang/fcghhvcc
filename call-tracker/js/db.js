// Everything lives in IndexedDB, in this browser, on this machine only —
// nothing here ever talks to a server. Three stores: `clients` (one row per
// imported client, raw column data plus a matchKey used to merge re-imports
// without losing call history), `calls` (append-only call history, one
// record per attempt), and `config` (column mapping, status list, settings —
// single-row-per-key, like a tiny KV store).
const DB = (function () {
  const DB_NAME = "call-tracker-db";
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("clients")) {
          const store = db.createObjectStore("clients", { keyPath: "id" });
          store.createIndex("matchKey", "matchKey", { unique: false });
        }
        if (!db.objectStoreNames.contains("calls")) {
          const store = db.createObjectStore("calls", { keyPath: "id" });
          store.createIndex("clientId", "clientId", { unique: false });
        }
        if (!db.objectStoreNames.contains("config")) {
          db.createObjectStore("config", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeNames, mode) {
    const db = await open();
    return db.transaction(storeNames, mode);
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(t) {
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async function getConfig(key, fallback) {
    const t = await tx("config", "readonly");
    const result = await reqToPromise(t.objectStore("config").get(key));
    return result ? result.value : fallback;
  }

  async function setConfig(key, value) {
    const t = await tx("config", "readwrite");
    t.objectStore("config").put({ key, value });
    return txDone(t);
  }

  async function getAllClients() {
    const t = await tx("clients", "readonly");
    return reqToPromise(t.objectStore("clients").getAll());
  }

  async function putClients(clients) {
    const t = await tx("clients", "readwrite");
    const store = t.objectStore("clients");
    clients.forEach((c) => store.put(c));
    return txDone(t);
  }

  async function deleteClient(id) {
    const t = await tx(["clients", "calls"], "readwrite");
    t.objectStore("clients").delete(id);
    const cursorReq = t.objectStore("calls").index("clientId").openCursor(IDBKeyRange.only(id));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    return txDone(t);
  }

  async function getAllCalls() {
    const t = await tx("calls", "readonly");
    return reqToPromise(t.objectStore("calls").getAll());
  }

  async function addCall(call) {
    const t = await tx("calls", "readwrite");
    t.objectStore("calls").put(call);
    return txDone(t);
  }

  async function deleteCall(id) {
    const t = await tx("calls", "readwrite");
    t.objectStore("calls").delete(id);
    return txDone(t);
  }

  async function clearAll() {
    const t = await tx(["clients", "calls", "config"], "readwrite");
    t.objectStore("clients").clear();
    t.objectStore("calls").clear();
    t.objectStore("config").clear();
    return txDone(t);
  }

  return {
    getConfig,
    setConfig,
    getAllClients,
    putClients,
    deleteClient,
    getAllCalls,
    addCall,
    deleteCall,
    clearAll,
  };
})();
