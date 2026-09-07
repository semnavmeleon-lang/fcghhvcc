const Utils = (function () {
  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  /** Accepts a JS Date, an Excel serial date number, or a string in
   * dd.mm.yyyy / dd/mm/yyyy / yyyy-mm-dd / anything Date.parse understands. */
  function toDate(value) {
    if (value instanceof Date) return isNaN(value) ? null : value;
    if (typeof value === "number") {
      if (value > 15000 && value < 80000) {
        // Excel serial date (days since 1899-12-30), covers ~1941-2119.
        return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
      }
      const d = new Date(value);
      return isNaN(d) ? null : d;
    }
    if (typeof value === "string") {
      const s = value.trim();
      if (!s) return null;
      let m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
      if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
      m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
      const d = new Date(s);
      return isNaN(d) ? null : d;
    }
    return null;
  }

  function formatDate(value) {
    const d = toDate(value);
    if (!d) return value == null || value === "" ? "" : String(value);
    return d.toLocaleDateString("ru-RU");
  }

  function formatDateTime(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d)) return "";
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function formatMoney(value) {
    if (value == null || value === "") return "";
    const n = typeof value === "number" ? value : parseFloat(String(value).replace(/[^\d.,-]/g, "").replace(",", "."));
    if (isNaN(n)) return String(value);
    return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽";
  }

  /** Whole days from today (midnight-to-midnight) until `value`. Negative = past. */
  function daysUntil(value) {
    const d = toDate(value);
    if (!d) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(d);
    target.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  }

  /** Normalizes one phone-ish string to +7 (XXX) XXX-XX-XX when it's a
   * recognizable 10/11-digit Russian number (any of 89620222600,
   * 79620222600, 9620222600, +7 962 022-26-00, ...). Anything else is left
   * as a cleaned-up digit string rather than guessed at. */
  function formatOnePhone(raw) {
    const trimmed = String(raw).trim();
    if (!trimmed) return "";
    let d = trimmed.replace(/\D/g, "");
    if (d.length === 11 && (d[0] === "8" || d[0] === "7")) d = "7" + d.slice(1);
    else if (d.length === 10) d = "7" + d;
    if (d.length === 11 && d[0] === "7") {
      return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
    }
    return d.length >= 7 ? "+" + d : trimmed;
  }

  /** A raw imported phone field may hold several numbers separated by a
   * comma/semicolon/slash/newline ("79620222600, 79630222600") — format
   * each independently and rejoin. */
  function formatPhone(raw) {
    if (raw == null || raw === "") return "";
    const parts = String(raw)
      .split(/[,;/\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.map(formatOnePhone).join(", ");
  }

  /** Digits only, for format-agnostic phone matching in search. */
  function phoneDigits(raw) {
    return raw == null ? "" : String(raw).replace(/\D/g, "");
  }

  /** Reads the "did the system's own advance eligibility check let this
   * client through for renewal" column: either a pre-checked renewal price
   * (a number) or a note that renewal isn't possible (any non-numeric
   * text). That check runs well ahead of the call, so it only tells you
   * whether it's worth calling at all — the real price still needs
   * re-confirming on the call itself. */
  function parseRenewalCheck(raw) {
    if (raw == null || raw === "") return { checked: false, approved: false, display: "" };
    const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^\d.,-]/g, "").replace(",", "."));
    if (!isNaN(n) && n > 0) {
      return { checked: true, approved: true, price: n, display: formatMoney(n) };
    }
    return { checked: true, approved: false, price: null, display: String(raw).trim() || "Нет возможности" };
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function setStatus(el, message, type) {
    el.textContent = message || "";
    el.className = "status" + (type ? " " + type : "");
  }

  return {
    uid,
    toDate,
    formatDate,
    formatDateTime,
    formatMoney,
    formatPhone,
    phoneDigits,
    parseRenewalCheck,
    daysUntil,
    debounce,
    escapeHtml,
    downloadBlob,
    setStatus,
  };
})();
