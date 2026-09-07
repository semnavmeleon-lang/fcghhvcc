// Caches clients + their call history in memory, reloaded via loadAll()
// after every mutation (never a bare invalidate() — a render right after
// logging a call must see it immediately, not an empty cache waiting on a
// reload nobody triggered yet). Also owns the import-merge logic:
// re-importing a file matches rows to existing clients by the configured
// "key" column so call history survives a daily/weekly re-export from the
// corporate system instead of being wiped and recreated as duplicates.
const ClientsStore = (function () {
  let clientsCache = null;
  let callsByClient = null;

  function normalizeKey(v) {
    if (v == null) return "";
    return String(v).trim().toLowerCase();
  }

  async function loadAll() {
    const [clients, calls] = await Promise.all([DB.getAllClients(), DB.getAllCalls()]);
    callsByClient = new Map();
    calls.forEach((c) => {
      if (!callsByClient.has(c.clientId)) callsByClient.set(c.clientId, []);
      callsByClient.get(c.clientId).push(c);
    });
    callsByClient.forEach((arr) => arr.sort((a, b) => b.at - a.at));
    clientsCache = clients;
    return clientsCache;
  }

  function clients() {
    return clientsCache || [];
  }

  function callsFor(clientId) {
    return (callsByClient && callsByClient.get(clientId)) || [];
  }

  function lastCallFor(clientId) {
    const calls = callsFor(clientId);
    return calls.length ? calls[0] : null;
  }

  /** Imports parsed rows under the given mapping. Rows whose match-key value
   * equals an existing client's are merged into that client (data replaced,
   * call history untouched); everything else becomes a new client. */
  async function importRows(mapping, rows) {
    const matchCol = Schema.matchKeyColumn(mapping);
    const now = Date.now();
    const existing = await DB.getAllClients();
    const byMatch = new Map();
    if (matchCol) {
      existing.forEach((c) => {
        if (c.matchKey) byMatch.set(c.matchKey, c);
      });
    }
    const toPut = [];
    let created = 0;
    let updated = 0;
    for (const row of rows) {
      const data = {};
      mapping.forEach((col) => {
        data[col.key] = row[col.key];
      });
      const matchKey = matchCol ? normalizeKey(row[matchCol.key]) : "";
      const existingClient = matchKey ? byMatch.get(matchKey) : null;
      if (existingClient) {
        existingClient.data = data;
        existingClient.matchKey = matchKey;
        existingClient.updatedAt = now;
        toPut.push(existingClient);
        updated++;
      } else {
        const client = { id: Utils.uid(), data, matchKey: matchKey || null, createdAt: now, updatedAt: now };
        toPut.push(client);
        if (matchKey) byMatch.set(matchKey, client);
        created++;
      }
    }
    await DB.putClients(toPut);
    await loadAll();
    return { created, updated, total: rows.length };
  }

  async function updateClientData(clientId, data) {
    const all = clientsCache || (await DB.getAllClients());
    const client = all.find((c) => c.id === clientId);
    if (!client) return;
    client.data = { ...client.data, ...data };
    client.updatedAt = Date.now();
    await DB.putClients([client]);
    await loadAll();
  }

  async function logCall(clientId, { statusId, comment, nextCallAt, agent }) {
    const call = {
      id: Utils.uid(),
      clientId,
      at: Date.now(),
      statusId,
      comment: comment || "",
      nextCallAt: nextCallAt || null,
      agent: agent || "",
    };
    await DB.addCall(call);
    // Reload rather than just invalidate(): callers (e.g. the client-card
    // modal) re-render their own view of this client/its calls immediately
    // after awaiting this, before anything else gets a chance to reload —
    // an invalidated-but-not-yet-refetched cache would render as empty.
    await loadAll();
    return call;
  }

  async function removeClient(clientId) {
    await DB.deleteClient(clientId);
    await loadAll();
  }

  /** Corrects a past call record in place (wrong status picked, typo in the
   * comment, etc.) — same id, so it overwrites rather than adding a new one. */
  async function updateCall(callId, updates) {
    const calls = await DB.getAllCalls();
    const call = calls.find((c) => c.id === callId);
    if (!call) return;
    Object.assign(call, updates);
    await DB.addCall(call);
    await loadAll();
  }

  async function deleteCall(callId) {
    await DB.deleteCall(callId);
    await loadAll();
  }

  return { loadAll, clients, callsFor, lastCallFor, importRows, updateClientData, logCall, updateCall, deleteCall, removeClient };
})();
