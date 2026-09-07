// The list of call outcomes (Продлил / Отказался / ...) is user-editable —
// see Settings — these are just the seed defaults for a fresh database.
const Statuses = (function () {
  const DEFAULTS = [
    { id: "renewed", label: "Продлил", color: "#16803c" },
    { id: "refused", label: "Отказался", color: "#c22032" },
    { id: "callback", label: "Перезвонить позже", color: "#2a6fdb" },
    { id: "thinking", label: "Думает", color: "#9a6a00" },
    { id: "noanswer", label: "Не дозвонился", color: "#656c7a" },
    { id: "wrongnum", label: "Неверный номер", color: "#8a4b2e" },
  ];

  // Not a real, storable status — it's what a client shows before any call
  // has ever been logged for them.
  const NOT_CALLED = { id: "__none__", label: "Не звонили", color: "#98a0ae" };

  let cache = null;

  async function list() {
    if (cache) return cache;
    let saved = await DB.getConfig("statuses", null);
    if (!saved || !saved.length) {
      saved = DEFAULTS.map((s) => ({ ...s }));
      await DB.setConfig("statuses", saved);
    }
    cache = saved;
    return cache;
  }

  async function save(newList) {
    cache = newList;
    await DB.setConfig("statuses", newList);
  }

  function byId(statusList, id) {
    return statusList.find((s) => s.id === id) || NOT_CALLED;
  }

  return { list, save, byId, NOT_CALLED };
})();
