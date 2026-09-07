// Turns a hand-colour-coded "Результаты пролонгации" column (the informal
// tracking a lot of agents keep directly in Excel — cell filled red/orange/
// green/etc. plus a short note) into real call-history records in this
// app, so that manual tracking doesn't have to be redone by hand.
//
// Two-level legend, both user-editable in Settings:
//   - "family" legend: the seven colour families the agent described
//     (red/orange/maroon/green/blue/purple/yellow) mapped to a call status.
//   - "hex" legend: exact-colour overrides for cells whose fill doesn't
//     confidently classify into one of those families — collected as
//     "unresolved" during import and resolved once by the user, then
//     remembered for every future import.
// A statusId of null/"" in either legend means "skip — don't log a call"
// (used for yellow = "haven't called yet", where fabricating a call record
// would misrepresent the client's real state).
const RenewalColors = (function () {
  const FAMILY_SEED = [
    { family: "red", label: "Красный (и оттенки)", meaning: "Отказ от пролонгации / полис не пропущен системой", statusId: "refused" },
    { family: "orange", label: "Оранжевый", meaning: "Звонил, не ответил (причина — в комментарии)", statusId: "noanswer" },
    { family: "maroon", label: "Тёмно-бордовый", meaning: "Номер не существует", statusId: "wrongnum" },
    { family: "green", label: "Зелёный", meaning: "Продлился", statusId: "renewed" },
    { family: "blue", label: "Синий", meaning: "Выслал расчёты, думает", statusId: "thinking" },
    { family: "purple", label: "Фиолетовый", meaning: "Отработал АКЦ", statusId: "acc_done" },
    { family: "yellow", label: "Жёлтый", meaning: "Ещё не звонил — запись о звонке не создаётся", statusId: null },
  ];

  // Excel's "Standard Colors" swatch row (the 10 fixed colours under the
  // fill-colour picker, same in every version/locale) — these are what most
  // hand-colour-coded trackers actually use, so match them exactly instead
  // of leaving it to the hue-band guess below. That guess alone put the
  // standard Orange (FFC000, hue 45.2°) one degree over the yellow
  // threshold, and the standard Dark Red (C00000, lightness 37.6%) just
  // above the maroon-lightness cutoff — both real swatches, both
  // misclassified.
  const STANDARD_EXCEL_COLORS = {
    C00000: "maroon", // Dark Red
    FF0000: "red", // Red
    FFC000: "orange", // Orange
    FFFF00: "yellow", // Yellow
    "92D050": "green", // Light Green
    "00B050": "green", // Green
    "00B0F0": "blue", // Light Blue
    "0070C0": "blue", // Blue
    "002060": "blue", // Dark Blue
    "7030A0": "purple", // Purple
  };

  function hexToHsl(hex) {
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    const d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  }

  /** Classifies a 6-hex fill colour into one of the seven named families,
   * or null when it's too ambiguous (greyscale, near-white/black, or in a
   * hue band — cyan, magenta — none of the seven names cover) to guess
   * confidently; those go through the hex-legend review instead. */
  function classifyColorFamily(hex) {
    if (!hex || !/^[0-9A-Fa-f]{6}$/.test(hex)) return null;
    const upper = hex.toUpperCase();
    if (upper in STANDARD_EXCEL_COLORS) return STANDARD_EXCEL_COLORS[upper];
    const { h, s, l } = hexToHsl(hex);
    if (s < 12 || l > 93 || l < 10) return null;
    if (l < 32 && (h < 20 || h >= 345)) return "maroon";
    if (h < 16 || h >= 345) return "red";
    if (h < 45) return "orange";
    if (h < 70) return "yellow";
    if (h < 165) return "green";
    if (h < 195) return null; // cyan/teal band
    if (h < 255) return "blue";
    if (h < 320) return "purple";
    return null; // magenta/pink band bordering red
  }

  async function ensureAccDoneStatus() {
    const list = await Statuses.list();
    if (!list.some((s) => s.id === "acc_done")) {
      list.push({ id: "acc_done", label: "Отработал АКЦ", color: "#7c3aed" });
      await Statuses.save(list);
    }
  }

  async function loadFamilyLegend() {
    let legend = await DB.getConfig("colorFamilyLegend", null);
    if (!legend || !legend.length) {
      await ensureAccDoneStatus();
      legend = FAMILY_SEED.map((f) => ({ ...f }));
      await DB.setConfig("colorFamilyLegend", legend);
    }
    return legend;
  }

  async function saveFamilyLegend(legend) {
    await DB.setConfig("colorFamilyLegend", legend);
  }

  async function loadHexLegend() {
    return DB.getConfig("colorHexLegend", []);
  }

  /** `meaning` is optional per choice — omitting it (as the import-time
   * review panel does) keeps whatever free-text meaning was already saved
   * for that exact hex, so a quick "just pick a status" during import never
   * clobbers a meaning written earlier in Settings. */
  async function saveHexLegendChoices(choices) {
    const legend = await loadHexLegend();
    choices.forEach(({ hex, statusId, meaning }) => {
      const idx = legend.findIndex((e) => e.hex === hex);
      const prev = idx !== -1 ? legend[idx] : null;
      const entry = { hex, statusId: statusId || null, meaning: meaning !== undefined ? meaning : prev ? prev.meaning || "" : "" };
      if (idx !== -1) legend[idx] = entry;
      else legend.push(entry);
    });
    await DB.setConfig("colorHexLegend", legend);
    return legend;
  }

  async function deleteHexLegendEntry(hex) {
    const legend = await loadHexLegend();
    await DB.setConfig(
      "colorHexLegend",
      legend.filter((e) => e.hex !== hex)
    );
  }

  /** kind: "none" (no fill — not a signal, ignored silently), "status"
   * (create a call with this statusId), "skip" (recognized, deliberately
   * no call), or "unresolved" (needs a manual legend entry). */
  function resolveStatusForHex(hex, familyLegend, hexLegend) {
    if (!hex) return { kind: "none" };
    const hexEntry = hexLegend.find((e) => e.hex === hex);
    if (hexEntry) return { kind: hexEntry.statusId ? "status" : "skip", statusId: hexEntry.statusId };
    const family = classifyColorFamily(hex);
    if (family) {
      const famEntry = familyLegend.find((f) => f.family === family);
      if (famEntry) return { kind: famEntry.statusId ? "status" : "skip", statusId: famEntry.statusId, family };
    }
    return { kind: "unresolved", family };
  }

  /** Dry run over the parsed-but-not-yet-imported rows: every distinct
   * fill colour that isn't covered by the family or hex legend, with an
   * occurrence count and one sample note, for the mapping screen's review
   * panel to show before the import is allowed to finish. */
  async function findUnresolved(mapping, rows, sheetMeta) {
    const col = Schema.renewalResultColumn(mapping);
    if (!col || !sheetMeta || !sheetMeta.sheet) return [];
    const colLetter = sheetMeta.headerColLetters[col.key];
    const familyLegend = await loadFamilyLegend();
    const hexLegend = await loadHexLegend();
    const byHex = new Map();
    rows.forEach((row, i) => {
      const info = ImportExport.getCellInfo(sheetMeta.sheet, colLetter, sheetMeta.rowRefs[i]);
      if (!info.hex) return;
      const resolution = resolveStatusForHex(info.hex, familyLegend, hexLegend);
      if (resolution.kind !== "unresolved") return;
      if (!byHex.has(info.hex)) byHex.set(info.hex, { hex: info.hex, count: 0, sample: info.comment || info.text || "" });
      byHex.get(info.hex).count++;
    });
    return Array.from(byHex.values());
  }

  /** Applies the (by now fully resolvable) renewal-results column to the
   * just-imported rows: for every coloured cell that maps to a status,
   * logs a call dated today with that status and the cell's extracted
   * note. clientIds[i] must line up with rows[i] (as returned by
   * ClientsStore.importRows). Safe to re-run on the same file — calls
   * already created from a given cell are recognized by sourceKey and
   * skipped, not duplicated. */
  async function applyToImportedClients(mapping, rows, sheetMeta, clientIds, fileHash) {
    const summary = { logged: 0, skipped: 0, byStatus: [] };
    const col = Schema.renewalResultColumn(mapping);
    if (!col || !sheetMeta || !sheetMeta.sheet) return summary;
    const colLetter = sheetMeta.headerColLetters[col.key];
    const familyLegend = await loadFamilyLegend();
    const hexLegend = await loadHexLegend();
    const statusList = await Statuses.list();
    const entries = [];
    const countByStatus = new Map();
    for (let i = 0; i < rows.length; i++) {
      const rowRef = sheetMeta.rowRefs[i];
      const info = ImportExport.getCellInfo(sheetMeta.sheet, colLetter, rowRef);
      if (!info.hex) continue;
      const resolution = resolveStatusForHex(info.hex, familyLegend, hexLegend);
      if (resolution.kind !== "status") {
        summary.skipped++;
        continue;
      }
      const clientId = clientIds[i];
      if (!clientId) continue;
      const sourceKey = `color:${fileHash || "nohash"}:${rowRef}:${info.hex}`;
      if (ClientsStore.hasCallWithSource(clientId, sourceKey)) continue;
      const parts = [];
      if (info.comment) parts.push(info.comment);
      if (info.text && info.text !== info.comment) parts.push(info.text);
      entries.push({ clientId, statusId: resolution.statusId, comment: parts.join(" | "), source: "color_import", sourceKey });
      const label = Statuses.byId(statusList, resolution.statusId).label;
      countByStatus.set(label, (countByStatus.get(label) || 0) + 1);
    }
    if (entries.length) await ClientsStore.logCallsBulk(entries);
    summary.logged = entries.length;
    summary.byStatus = Array.from(countByStatus.entries()).map(([label, count]) => ({ label, count }));
    return summary;
  }

  // Representative swatch per family, just for the Settings legend UI —
  // the actual imported cells can be any shade within that hue band.
  const FAMILY_SWATCH = {
    red: "#e2626f",
    orange: "#f0a955",
    maroon: "#7b241c",
    green: "#6fcf8f",
    blue: "#7fa8d9",
    purple: "#b98ee0",
    yellow: "#ede07a",
  };

  // Same 10 swatches as STANDARD_EXCEL_COLORS, offered as fixed choices when
  // manually adding a colour rule in Settings — a free RGB picker there
  // would make it easy to save a shade that just doesn't match any real
  // cell in the workbook (matching an exact-colour rule needs the literal
  // fill hex, not a similar-looking one).
  const DEFAULT_PALETTE = [
    { hex: "C00000", name: "Тёмно-красный" },
    { hex: "FF0000", name: "Красный" },
    { hex: "FFC000", name: "Оранжевый" },
    { hex: "FFFF00", name: "Жёлтый" },
    { hex: "92D050", name: "Светло-зелёный" },
    { hex: "00B050", name: "Зелёный" },
    { hex: "00B0F0", name: "Голубой" },
    { hex: "0070C0", name: "Синий" },
    { hex: "002060", name: "Тёмно-синий" },
    { hex: "7030A0", name: "Фиолетовый" },
  ];

  return {
    FAMILY_SEED,
    FAMILY_SWATCH,
    DEFAULT_PALETTE,
    classifyColorFamily,
    loadFamilyLegend,
    saveFamilyLegend,
    loadHexLegend,
    saveHexLegendChoices,
    deleteHexLegendEntry,
    findUnresolved,
    applyToImportedClients,
  };
})();
