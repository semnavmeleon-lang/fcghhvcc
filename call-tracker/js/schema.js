// The "modularity": raw imported columns get mapped to a small set of
// roles that the rest of the app understands. Only "money" and "date" carry
// real formatting behavior, "name" picks the client's display title, and
// "hidden" excludes a column — everything else (including any custom role
// the user adds) renders as plain text, so custom roles are free-form
// organizational tags with zero risk of breaking rendering.
const Schema = (function () {
  const BUILTIN_ROLES = [
    { id: "name", label: "Имя / ФИО", color: "#2a6fdb" },
    { id: "phone", label: "Телефон", color: "#16803c" },
    { id: "date", label: "Дата", color: "#9a6a00" },
    { id: "money", label: "Сумма", color: "#7a3fb0" },
    { id: "category", label: "Категория", color: "#0f8a8a" },
    { id: "renewal_check", label: "Пролонгация (предпроверка)", color: "#0d9488" },
    { id: "text", label: "Текст", color: "#656c7a" },
    { id: "hidden", label: "Скрыть", color: "#98a0ae" },
  ];

  const CUSTOM_PALETTE = ["#c2410c", "#be185d", "#4d7c0f", "#0369a1", "#7c3aed", "#b45309", "#0f766e"];

  async function getAllRoles() {
    const custom = await DB.getConfig("customRoles", []);
    return BUILTIN_ROLES.concat(custom);
  }

  async function addCustomRole(label) {
    const custom = await DB.getConfig("customRoles", []);
    const id = "custom_" + Utils.uid();
    const color = CUSTOM_PALETTE[custom.length % CUSTOM_PALETTE.length];
    const role = { id, label, color };
    custom.push(role);
    await DB.setConfig("customRoles", custom);
    return role;
  }

  function guessRole(header) {
    const h = String(header).toLowerCase();
    if (/телефон|тел\.|моб\.|phone|tel/.test(h)) return "phone";
    if (/фио|имя|клиент|страхователь|владелец|name/.test(h)) return "name";
    if (/дата|срок|период|date/.test(h)) return "date";
    if (/сумма|премия|стоимост|цена|price|₽|руб/.test(h)) return "money";
    if (/пролонгац/i.test(h)) return "renewal_check";
    if (/вид|тип|продукт|полис|категор|osago|kasko|каско|осаго/i.test(h)) return "category";
    return "text";
  }

  async function load() {
    return DB.getConfig("columnMapping", null);
  }

  async function save(mapping) {
    return DB.setConfig("columnMapping", mapping);
  }

  function visibleSorted(mapping) {
    return mapping.filter((m) => m.role !== "hidden" && m.visible !== false).sort((a, b) => a.order - b.order);
  }

  function nameColumn(mapping) {
    return mapping.find((m) => m.role === "name" && m.visible !== false) || mapping[0];
  }

  function policyEndColumn(mapping) {
    return mapping.find((m) => m.isPolicyEndDate);
  }

  function matchKeyColumn(mapping) {
    return mapping.find((m) => m.isMatchKey);
  }

  function renewalCheckColumn(mapping) {
    return mapping.find((m) => m.role === "renewal_check" && m.visible !== false);
  }

  // --- Mapping templates: named, reusable column setups for a given file
  // layout, so a recurring export from the corporate system doesn't need
  // its columns re-configured by hand every time. ---

  async function listTemplates() {
    return DB.getConfig("mappingTemplates", []);
  }

  async function saveTemplate(name, mapping) {
    const templates = await listTemplates();
    const snapshot = mapping.map((m) => ({ ...m }));
    const idx = templates.findIndex((t) => t.name === name);
    const entry = { id: idx !== -1 ? templates[idx].id : Utils.uid(), name, mapping: snapshot, savedAt: Date.now() };
    if (idx !== -1) templates[idx] = entry;
    else templates.push(entry);
    await DB.setConfig("mappingTemplates", templates);
    return entry;
  }

  async function deleteTemplate(id) {
    const templates = await listTemplates();
    await DB.setConfig(
      "mappingTemplates",
      templates.filter((t) => t.id !== id)
    );
  }

  /** Best-matching template for a freshly parsed header set. Requires at
   * least half the template's own columns to be present, so an unrelated
   * file never silently borrows a foreign template. */
  function findBestTemplate(templates, headers) {
    const headerSet = new Set(headers);
    let best = null;
    let bestScore = 0;
    templates.forEach((t) => {
      const overlap = t.mapping.filter((m) => headerSet.has(m.key)).length;
      if (overlap === 0 || overlap < t.mapping.length / 2) return;
      if (overlap > bestScore) {
        bestScore = overlap;
        best = t;
      }
    });
    return best;
  }

  return {
    getAllRoles,
    addCustomRole,
    guessRole,
    load,
    save,
    visibleSorted,
    nameColumn,
    policyEndColumn,
    matchKeyColumn,
    renewalCheckColumn,
    listTemplates,
    saveTemplate,
    deleteTemplate,
    findBestTemplate,
  };
})();
