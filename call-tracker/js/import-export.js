// Binary spreadsheet formats (.xlsx/.xls) are self-describing, so SheetJS
// handles them directly from raw bytes. CSV gets its own hand-rolled parser
// below instead of SheetJS's — SheetJS's CSV reader auto-detects "date-like"
// cells and converts them to serial numbers using its own (US-centric)
// guess at the format, silently swapping day/month for any DD.MM.YYYY date
// where the day is <= 12 (~40% of all dates) — turning off `cellDates`
// doesn't help, because the misparse happens before that flag is even
// consulted. Reading CSV as plain strings and parsing dates ourselves in
// Utils.toDate (which already knows DD.MM.YYYY unambiguously) sidesteps it.
const ImportExport = (function () {
  function isBinarySpreadsheet(bytes) {
    if (bytes.length < 4) return false;
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b; // .xlsx/.xlsm/.ods (zip)
    const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0; // legacy .xls
    return zip || ole;
  }

  // Plain CSV has no built-in encoding tag, and Excel's "CSV (Windows)"
  // export on a Russian locale writes Windows-1251 without a BOM — decode
  // with a BOM/UTF-8/cp1251 fallback chain instead of guessing blind.
  function decodeCsvText(bytes) {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (utf8.includes("�")) return new TextDecoder("windows-1251").decode(bytes);
    return utf8;
  }

  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || "";
    const commas = (firstLine.match(/,/g) || []).length;
    const semicolons = (firstLine.match(/;/g) || []).length;
    return semicolons > commas ? ";" : ",";
  }

  /** RFC-4180-ish CSV parser: handles quoted fields, escaped `""`, and
   * embedded delimiters/newlines inside quotes. Everything comes out as a
   * plain trimmed string — no type-guessing. */
  function parseCsvTable(text, delimiter) {
    const table = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
        continue;
      }
      if (c === '"') {
        inQuotes = true;
      } else if (c === delimiter) {
        row.push(field);
        field = "";
      } else if (c === "\r") {
        // skip — \n (below) closes the row
      } else if (c === "\n") {
        row.push(field);
        table.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
    if (field !== "" || row.length) {
      row.push(field);
      table.push(row);
    }
    return table.filter((r) => r.some((cell) => cell.trim() !== ""));
  }

  /** Real corporate exports routinely repeat a column name (e.g. two
   * "Комментарий" columns — one per call attempt). Since every header is
   * used as the row-object key and the mapping's column key, a repeat would
   * otherwise silently clobber the earlier column's data on every row and
   * make the two impossible to map separately — so make each one unique. */
  function dedupeHeaders(headers) {
    const seen = new Map();
    return headers.map((h) => {
      const count = (seen.get(h) || 0) + 1;
      seen.set(h, count);
      return count === 1 ? h : `${h} (${count})`;
    });
  }

  function csvToHeadersRows(text) {
    const table = parseCsvTable(text, detectDelimiter(text));
    if (!table.length) return { headers: [], rows: [] };
    const headers = dedupeHeaders(table[0].map((h, i) => (h.trim() === "" ? `Столбец ${i + 1}` : h.trim())));
    const rows = table.slice(1).map((r) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = r[i] === undefined ? "" : r[i].trim();
      });
      return obj;
    });
    return { headers, rows };
  }

  async function hashBytes(bytes) {
    try {
      if (window.crypto && crypto.subtle && crypto.subtle.digest) {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return "sha256:" + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch (e) {
      // fall through to the cheap fallback below (e.g. non-secure context)
    }
    // Not cryptographic, just good enough to notice "this looks like the
    // same file again" when SubtleCrypto isn't available.
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
    return "fnv:" + (h >>> 0).toString(16) + ":" + bytes.length;
  }

  /** Walks a worksheet by hand instead of XLSX.utils.sheet_to_json, so a
   * parsed row can be traced back to its original sheet row number
   * (`rowRefs[i]`) — sheet_to_json's own blank-row skipping makes that
   * correlation impossible to recover afterwards. That row number is what
   * lets the renewal-results colour/comment lookup (RenewalColors) find the
   * exact source cell for a given imported row later on. */
  function walkSheet(sheet) {
    const ref = sheet["!ref"];
    if (!ref) return { headers: [], rows: [], rowRefs: [], headerColLetters: {} };
    const range = XLSX.utils.decode_range(ref);
    const headers = [];
    const headerColLetters = {};
    const rawHeaders = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
      rawHeaders.push(cell && cell.v !== undefined && cell.v !== "" ? String(cell.v) : `Столбец ${c - range.s.c + 1}`);
    }
    const dedupedHeaders = dedupeHeaders(rawHeaders);
    dedupedHeaders.forEach((h, i) => {
      headers.push(h);
      headerColLetters[h] = XLSX.utils.encode_col(range.s.c + i);
    });
    const rows = [];
    const rowRefs = [];
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const rowObj = {};
      let hasValue = false;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        const v = cell && cell.v !== undefined ? cell.v : "";
        // A colour-only cell (filled in but never typed into — an agent
        // marking a result by colour alone, no note yet) still counts as
        // "this row has something in it", or the whole row — and the
        // colour that's the entire point of RenewalColors — gets dropped
        // here as "blank" before renewal-results processing ever sees it.
        if (v !== "" || cellFillHex(cell)) hasValue = true;
        rowObj[headers[c - range.s.c]] = v;
      }
      if (!hasValue) continue; // mirrors the old sheet_to_json({ blankrows: false }) behavior
      rows.push(rowObj);
      // Sheet cell keys ("E7") are 1-based, but `r` here is the 0-based row
      // index decode_range/encode_cell use — off by one would silently
      // point every colour/comment lookup at the row above, and drop the
      // sheet's very last row from ever being looked up at all.
      rowRefs.push(r + 1);
    }
    return { headers, rows, rowRefs, headerColLetters };
  }

  function cellFillHex(cell) {
    const fill = cell && cell.s && (cell.s.fgColor || cell.s.bgColor);
    return fill && fill.rgb && /^[0-9A-Fa-f]{6,8}$/.test(fill.rgb) ? fill.rgb.slice(-6).toUpperCase() : null;
  }

  /** Fill color (6-hex, no '#') and any note/comment text for one cell,
   * read from a worksheet parsed with `cellStyles: true`. Used to turn a
   * hand-colour-coded "Результаты пролонгации" column back into structured
   * call outcomes — see RenewalColors. */
  function getCellInfo(sheet, colLetter, rowRef) {
    if (!sheet || !colLetter || !rowRef) return { hex: null, comment: "", text: "" };
    const cell = sheet[colLetter + rowRef];
    if (!cell) return { hex: null, comment: "", text: "" };
    const hex = cellFillHex(cell);
    const comment = cell.c && cell.c.length ? cell.c.map((c) => (c.t || "").trim()).filter(Boolean).join(" / ") : "";
    const text = cell.v == null ? "" : String(cell.v).trim();
    return { hex, comment, text };
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const bytes = new Uint8Array(reader.result);
          let headers;
          let rows;
          let sheet = null;
          let rowRefs = null;
          let headerColLetters = null;
          if (isBinarySpreadsheet(bytes)) {
            const wb = XLSX.read(bytes, { type: "array", cellStyles: true });
            const sheetName = wb.SheetNames[0];
            if (!sheetName) throw new Error("В файле не найдено ни одного листа");
            sheet = wb.Sheets[sheetName];
            ({ headers, rows, rowRefs, headerColLetters } = walkSheet(sheet));
          } else {
            ({ headers, rows } = csvToHeadersRows(decodeCsvText(bytes)));
          }
          const hash = await hashBytes(bytes);
          resolve({ headers, rows, fileName: file.name, fileSize: file.size, hash, sheet, rowRefs, headerColLetters });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function exportClients(mapping, rows, filename) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Клиенты");
    XLSX.writeFile(wb, filename);
  }

  function exportCalls(rows, filename) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Звонки");
    XLSX.writeFile(wb, filename);
  }

  return { readFile, getCellInfo, exportClients, exportCalls };
})();
