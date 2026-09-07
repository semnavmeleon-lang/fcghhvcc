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
   * call history untouched); everything else becomes a new client.
   * `clientIds[i]` is the id the row at `rows[i]` ended up under (new or
   * merged) — callers that need to attach something per source row (e.g.
   * RenewalColors turning a coloured cell into a call record) zip against
   * this rather than re-deriving the match themselves. */
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
    const clientIds = [];
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
        clientIds.push(existingClient.id);
        updated++;
      } else {
        const client = { id: Utils.uid(), data, matchKey: matchKey || null, createdAt: now, updatedAt: now };
        toPut.push(client);
        clientIds.push(client.id);
        if (matchKey) byMatch.set(matchKey, client);
        created++;
      }
    }
    await DB.putClients(toPut);
    await loadAll();
    return { created, updated, total: rows.length, clientIds };
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

  async function logCall(clientId, { statusId, comment, nextCallAt, agent, source, sourceKey }) {
    const call = {
      id: Utils.uid(),
      clientId,
      at: Date.now(),
      statusId,
      comment: comment || "",
      nextCallAt: nextCallAt || null,
      agent: agent || "",
    };
    // Only set on calls auto-generated from a coloured source column (see
    // RenewalColors) — lets the UI mark them as such and lets a re-import
    // of the same file recognize "already turned this cell into a call".
    if (source) call.source = source;
    if (sourceKey) call.sourceKey = sourceKey;
    await DB.addCall(call);
    // Reload rather than just invalidate(): callers (e.g. the client-card
    // modal) re-render their own view of this client/its calls immediately
    // after awaiting this, before anything else gets a chance to reload —
    // an invalidated-but-not-yet-refetched cache would render as empty.
    await loadAll();
    return call;
  }

  /** True if `clientId` already has a call tagged with this exact
   * sourceKey — makes re-importing the same colour-coded file idempotent
   * instead of piling up duplicate call records on every re-run. */
  function hasCallWithSource(clientId, sourceKey) {
    return callsFor(clientId).some((c) => c.sourceKey === sourceKey);
  }

  /** Bulk counterpart to logCall for writing many records at once (e.g. one
   * per coloured cell in an imported column) — one transaction and one
   * cache reload instead of one of each per record. */
  async function logCallsBulk(entries) {
    const now = Date.now();
    const calls = entries.map((e) => {
      const call = {
        id: Utils.uid(),
        clientId: e.clientId,
        at: now,
        statusId: e.statusId,
        comment: e.comment || "",
        nextCallAt: e.nextCallAt || null,
        agent: e.agent || "",
      };
      if (e.source) call.source = e.source;
      if (e.sourceKey) call.sourceKey = e.sourceKey;
      return call;
    });
    await DB.addCalls(calls);
    await loadAll();
    return calls;
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

  return {
    loadAll,
    clients,
    callsFor,
    lastCallFor,
    importRows,
    updateClientData,
    logCall,
    logCallsBulk,
    hasCallWithSource,
    updateCall,
    deleteCall,
    removeClient,
  };
})();
