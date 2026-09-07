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

  function csvToHeadersRows(text) {
    const table = parseCsvTable(text, detectDelimiter(text));
    if (!table.length) return { headers: [], rows: [] };
    const headers = table[0].map((h, i) => (h.trim() === "" ? `Столбец ${i + 1}` : h.trim()));
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

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const bytes = new Uint8Array(reader.result);
          let headers;
          let rows;
          if (isBinarySpreadsheet(bytes)) {
            const wb = XLSX.read(bytes, { type: "array" });
            const sheetName = wb.SheetNames[0];
            if (!sheetName) throw new Error("В файле не найдено ни одного листа");
            const sheet = wb.Sheets[sheetName];
            const headerRow = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false })[0] || [];
            headers = headerRow.map((h, i) => (h === undefined || h === "" ? `Столбец ${i + 1}` : String(h)));
            rows = XLSX.utils.sheet_to_json(sheet, { defval: "", blankrows: false });
          } else {
            ({ headers, rows } = csvToHeadersRows(decodeCsvText(bytes)));
          }
          const hash = await hashBytes(bytes);
          resolve({ headers, rows, fileName: file.name, fileSize: file.size, hash });
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

  return { readFile, exportClients, exportCalls };
})();
