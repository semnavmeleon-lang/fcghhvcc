const ViewClients = (function () {
  const PAGE_SIZE = 50;
  let mapping = [];
  let statusList = [];
  let sortCol = null; // { role, key } or "__status__" / "__next__"
  let sortDir = 1;
  let searchTerm = "";
  let activeStatusFilters = new Set(); // empty = show all
  let expiringOn = false;
  let expiringDays = 30;
  let dueCallbackOn = false;
  let page = 0;
  let onOpenClient = null;

  function rowSearchText(client) {
    return Schema.visibleSorted(mapping)
      .map((c) => {
        const v = client.data[c.key];
        if (v == null) return "";
        // Phone fields are matched by digits too, so a search doesn't care
        // whether the stored value is "+7 (962) 022-26-00" or "89620222600".
        return c.role === "phone" ? String(v).toLowerCase() + " " + Utils.phoneDigits(v) : String(v).toLowerCase();
      })
      .join(" ");
  }

  function computeRow(client) {
    const lastCall = ClientsStore.lastCallFor(client.id);
    const status = lastCall ? Statuses.byId(statusList, lastCall.statusId) : Statuses.NOT_CALLED;
    const nextCallAt = lastCall && lastCall.nextCallAt ? lastCall.nextCallAt : null;
    return { client, lastCall, status, nextCallAt, callCount: ClientsStore.callsFor(client.id).length };
  }

  function passesFilters(row) {
    if (activeStatusFilters.size && !activeStatusFilters.has(row.status.id)) return false;
    if (searchTerm) {
      const text = rowSearchText(row.client);
      const digitsTerm = searchTerm.replace(/\D/g, "");
      const matches = text.includes(searchTerm) || (digitsTerm.length >= 3 && text.includes(digitsTerm));
      if (!matches) return false;
    }
    if (expiringOn) {
      const endCol = Schema.policyEndColumn(mapping);
      if (!endCol) return false;
      const days = Utils.daysUntil(row.client.data[endCol.key]);
      if (days == null || days > expiringDays) return false;
    }
    if (dueCallbackOn) {
      if (!row.nextCallAt) return false;
      const days = Utils.daysUntil(row.nextCallAt);
      if (days == null || days > 0) return false;
    }
    return true;
  }

  function sortValue(row, col) {
    if (col === "__status__") return row.status.label;
    if (col === "__next__") return row.nextCallAt || "";
    const raw = row.client.data[col.key];
    if (col.role === "money") return parseFloat(String(raw).replace(/[^\d.,-]/g, "").replace(",", ".")) || 0;
    if (col.role === "date") {
      const d = Utils.toDate(raw);
      return d ? d.getTime() : 0;
    }
    if (col.role === "phone") return Utils.phoneDigits(raw);
    if (col.role === "renewal_check") {
      const info = Utils.parseRenewalCheck(raw);
      return info.approved ? info.price : -1;
    }
    return (raw == null ? "" : String(raw)).toLowerCase();
  }

  function renderStatusFilters() {
    const wrap = document.getElementById("clients-status-filters");
    wrap.innerHTML = "";
    const allStatuses = [Statuses.NOT_CALLED, ...statusList];
    allStatuses.forEach((s) => {
      const chip = document.createElement("span");
      chip.className = "status-chip" + (activeStatusFilters.has(s.id) ? " active" : "");
      chip.textContent = s.label;
      chip.style.setProperty("--chip-color", s.color);
      chip.style.setProperty("--chip-color-bg", s.color + "22");
      chip.style.setProperty("--chip-color-text", s.color);
      chip.addEventListener("click", () => {
        if (activeStatusFilters.has(s.id)) activeStatusFilters.delete(s.id);
        else activeStatusFilters.add(s.id);
        page = 0;
        renderStatusFilters();
        renderTable();
      });
      wrap.appendChild(chip);
    });
  }

  function renderHead() {
    const cols = Schema.visibleSorted(mapping);
    const thead = document.getElementById("clients-thead");
    thead.innerHTML = "";
    const tr = document.createElement("tr");
    cols.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col.label;
      if (col.role === "money") th.classList.add("col-money");
      th.addEventListener("click", () => applySort(col));
      tr.appendChild(th);
    });
    const thStatus = document.createElement("th");
    thStatus.textContent = "Статус";
    thStatus.addEventListener("click", () => applySort("__status__"));
    const thNext = document.createElement("th");
    thNext.textContent = "След. звонок";
    thNext.addEventListener("click", () => applySort("__next__"));
    tr.append(thStatus, thNext);
    thead.appendChild(tr);
  }

  function applySort(col) {
    if (sortCol === col) sortDir = -sortDir;
    else {
      sortCol = col;
      sortDir = 1;
    }
    renderTable();
  }

  function renderTable() {
    const cols = Schema.visibleSorted(mapping);
    let rows = ClientsStore.clients().map(computeRow).filter(passesFilters);

    if (sortCol) {
      rows.sort((a, b) => {
        const av = sortValue(a, sortCol);
        const bv = sortValue(b, sortCol);
        if (av < bv) return -1 * sortDir;
        if (av > bv) return 1 * sortDir;
        return 0;
      });
    }

    const total = rows.length;
    const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
    if (page > maxPage) page = maxPage;
    const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    const endCol = Schema.policyEndColumn(mapping);

    const tbody = document.getElementById("clients-tbody");
    tbody.innerHTML = "";
    if (pageRows.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = cols.length + 2;
      td.style.textAlign = "center";
      td.style.color = "var(--text-faint)";
      td.style.padding = "24px";
      td.textContent = total === 0 && rows.length === total ? "Ничего не найдено по текущим фильтрам." : "Нет данных.";
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    pageRows.forEach((row) => {
      const tr = document.createElement("tr");
      cols.forEach((col) => {
        const td = document.createElement("td");
        const raw = row.client.data[col.key];
        if (col.role === "money") {
          td.textContent = Utils.formatMoney(raw);
          td.classList.add("col-money");
        } else if (col.role === "date") {
          td.textContent = Utils.formatDate(raw);
          if (endCol && col.key === endCol.key) {
            const days = Utils.daysUntil(raw);
            if (days != null && days <= expiringDays) td.classList.add("expiring-soon");
          }
        } else if (col.role === "phone") {
          td.textContent = Utils.formatPhone(raw);
        } else if (col.role === "renewal_check") {
          const info = Utils.parseRenewalCheck(raw);
          if (info.checked) {
            const badge = document.createElement("span");
            badge.className = "badge";
            badge.style.background = info.approved ? "var(--success)" : "var(--text-faint)";
            badge.textContent = info.display;
            td.appendChild(badge);
          }
        } else {
          td.textContent = raw == null ? "" : String(raw);
        }
        tr.appendChild(td);
      });

      const tdStatus = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.style.background = row.status.color;
      badge.textContent = row.status.label;
      tdStatus.appendChild(badge);
      tr.appendChild(tdStatus);

      const tdNext = document.createElement("td");
      tdNext.textContent = row.nextCallAt ? Utils.formatDate(row.nextCallAt) : "—";
      tr.appendChild(tdNext);

      tr.addEventListener("click", () => onOpenClient(row.client.id));
      tbody.appendChild(tr);
    });

    const pagination = document.getElementById("clients-pagination");
    pagination.innerHTML = "";
    if (total > 0) {
      const info = document.createElement("span");
      info.textContent = `Показано ${page * PAGE_SIZE + 1}–${Math.min(total, (page + 1) * PAGE_SIZE)} из ${total}`;
      const prevBtn = document.createElement("button");
      prevBtn.className = "btn small";
      prevBtn.textContent = "← Назад";
      prevBtn.disabled = page === 0;
      prevBtn.addEventListener("click", () => {
        page--;
        renderTable();
      });
      const nextBtn = document.createElement("button");
      nextBtn.className = "btn small";
      nextBtn.textContent = "Вперёд →";
      nextBtn.disabled = page >= maxPage;
      nextBtn.addEventListener("click", () => {
        page++;
        renderTable();
      });
      pagination.append(prevBtn, info, nextBtn);
    }
  }

  let wired = false;
  function wireControls() {
    if (wired) return;
    wired = true;
    const search = document.getElementById("clients-search");
    search.addEventListener(
      "input",
      Utils.debounce(() => {
        searchTerm = search.value.trim().toLowerCase();
        page = 0;
        renderTable();
      }, 200)
    );
    document.getElementById("clients-expiring-check").addEventListener("change", (e) => {
      expiringOn = e.target.checked;
      page = 0;
      renderTable();
    });
    document.getElementById("clients-expiring-days").addEventListener(
      "input",
      Utils.debounce((e) => {
        expiringDays = parseInt(e.target.value, 10) || 0;
        if (expiringOn) renderTable();
      }, 200)
    );
    document.getElementById("clients-due-callback-check").addEventListener("change", (e) => {
      dueCallbackOn = e.target.checked;
      page = 0;
      renderTable();
    });
  }

  /** Called from outside (e.g. a reminder notification click) to jump
   * straight to the list of clients whose callback is due or overdue. */
  function showDueCallbacks() {
    dueCallbackOn = true;
    const check = document.getElementById("clients-due-callback-check");
    if (check) check.checked = true;
    page = 0;
    renderTable();
  }

  async function show(opts) {
    onOpenClient = opts.onOpenClient;
    mapping = await Schema.load();
    statusList = await Statuses.list();
    wireControls();

    const endCol = Schema.policyEndColumn(mapping);
    document.querySelector(".expiring-filter").hidden = !endCol;

    // Drop stale sort/filter state referencing columns the user may have
    // just hidden/removed in Settings, so the table never renders a filter
    // that's silently doing nothing.
    if (sortCol && sortCol !== "__status__" && sortCol !== "__next__" && !mapping.some((m) => m.key === sortCol.key)) sortCol = null;

    renderStatusFilters();
    renderHead();
    renderTable();
  }

  return { show, showDueCallbacks };
})();
