// Remembers which files have already been imported (by content hash, not
// just name) so re-uploading the same export can be flagged instead of
// silently merged again, and so Settings can show a short audit trail.
const ImportHistory = (function () {
  const MAX_ENTRIES = 50;

  async function list() {
    return DB.getConfig("importHistory", []);
  }

  async function findByHash(hash) {
    const history = await list();
    return history.find((h) => h.hash === hash) || null;
  }

  async function record(entry) {
    const history = await list();
    history.unshift({ id: Utils.uid(), at: Date.now(), ...entry });
    if (history.length > MAX_ENTRIES) history.length = MAX_ENTRIES;
    await DB.setConfig("importHistory", history);
  }

  return { list, findByHash, record };
})();
