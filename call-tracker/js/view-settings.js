const ViewSettings = (function () {
  let onNeedsFullRefresh = null;

  function renderDataInfo(mapping) {
    const clients = ClientsStore.clients();
    const lastUpdate = clients.reduce((max, c) => Math.max(max, c.updatedAt || 0), 0);
    const matchCol = Schema.matchKeyColumn(mapping);
    const parts = [`Клиентов в базе: ${clients.length}`];
    if (lastUpdate) parts.push(`последнее обновление: ${Utils.formatDateTime(lastUpdate)}`);
    parts.push(matchCol ? `ключ обновления: «${matchCol.label}»` : "ключ обновления не задан — повторный импорт создаст дубликаты");
    document.getElementById("settings-data-info").textContent = parts.join(" · ");
  }

  async function renderStatuses() {
    const statusList = await Statuses.list();
    const calls = await DB.getAllCalls();
    const usageCount = new Map();
    calls.forEach((c) => usageCount.set(c.statusId, (usageCount.get(c.statusId) || 0) + 1));

    const listEl = document.getElementById("settings-statuses-list");
    listEl.innerHTML = "";
    statusList.forEach((s) => {
      const row = document.createElement("div");
      row.className = "status-row";

      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = s.color;
      colorInput.addEventListener("input", async () => {
        s.color = colorInput.value;
        await Statuses.save(statusList);
        onNeedsFullRefresh();
      });

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.value = s.label;
      labelInput.addEventListener(
        "change",
        Utils.debounce(async () => {
          s.label = labelInput.value.trim() || s.label;
          await Statuses.save(statusList);
          onNeedsFullRefresh();
        }, 200)
      );

      const usage = usageCount.get(s.id) || 0;
      const usageNote = document.createElement("span");
      usageNote.style.fontSize = "11.5px";
      usageNote.style.color = "var(--text-faint)";
      usageNote.style.minWidth = "90px";
      usageNote.textContent = usage ? `звонков: ${usage}` : "не используется";

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn small danger";
      deleteBtn.textContent = "Удалить";
      deleteBtn.disabled = usage > 0;
      deleteBtn.title = usage > 0 ? "Нельзя удалить — статус уже используется в истории звонков" : "Удалить статус";
      deleteBtn.addEventListener("click", async () => {
        if (!confirm(`Удалить статус «${s.label}»?`)) return;
        const idx = statusList.indexOf(s);
        if (idx !== -1) statusList.splice(idx, 1);
        await Statuses.save(statusList);
        await renderStatuses();
        onNeedsFullRefresh();
      });

      row.append(colorInput, labelInput, usageNote, deleteBtn);
      listEl.appendChild(row);
    });
  }

  function wireAddStatus() {
    document.getElementById("settings-status-add-btn").onclick = async () => {
      const labelInput = document.getElementById("settings-status-new-label");
      const colorInput = document.getElementById("settings-status-new-color");
      const label = labelInput.value.trim();
      if (!label) return;
      const statusList = await Statuses.list();
      statusList.push({ id: "s" + Utils.uid(), label, color: colorInput.value });
      await Statuses.save(statusList);
      labelInput.value = "";
      await renderStatuses();
      onNeedsFullRefresh();
    };
  }

  function buildStatusSelect(statusList, selectedId) {
    const select = document.createElement("select");
    const skipOpt = document.createElement("option");
    skipOpt.value = "";
    skipOpt.textContent = "— пропустить (не создавать запись) —";
    select.appendChild(skipOpt);
    statusList.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label;
      if (s.id === selectedId) opt.selected = true;
      select.appendChild(opt);
    });
    return select;
  }

  async function renderColorLegend() {
    const statusList = await Statuses.list();
    const familyLegend = await RenewalColors.loadFamilyLegend();
    const hexLegend = await RenewalColors.loadHexLegend();

    const familyListEl = document.getElementById("settings-color-family-list");
    familyListEl.innerHTML = "";
    familyLegend.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "color-legend-row";
      const swatch = document.createElement("span");
      swatch.className = "color-swatch";
      swatch.style.background = RenewalColors.FAMILY_SWATCH[entry.family] || "#ccc";
      const label = document.createElement("span");
      label.className = "color-legend-label";
      label.textContent = entry.label;
      const select = buildStatusSelect(statusList, entry.statusId);
      select.addEventListener("change", async () => {
        entry.statusId = select.value || null;
        await RenewalColors.saveFamilyLegend(familyLegend);
      });
      const meaning = document.createElement("span");
      meaning.className = "color-legend-meaning";
      meaning.textContent = entry.meaning || "";
      row.append(swatch, label, select, meaning);
      familyListEl.appendChild(row);
    });

    const hexTitle = document.getElementById("settings-color-hex-title");
    const hexListEl = document.getElementById("settings-color-hex-list");
    hexListEl.innerHTML = "";
    hexTitle.hidden = hexLegend.length === 0;
    hexLegend.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "color-legend-row";
      const swatch = document.createElement("span");
      swatch.className = "color-swatch";
      swatch.style.background = "#" + entry.hex;
      const label = document.createElement("span");
      label.className = "color-legend-label";
      label.textContent = "#" + entry.hex;
      const select = buildStatusSelect(statusList, entry.statusId);
      select.addEventListener("change", async () => {
        await RenewalColors.saveHexLegendChoices([{ hex: entry.hex, statusId: select.value }]);
      });
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn small danger";
      deleteBtn.textContent = "Забыть";
      deleteBtn.title = "Забыть это правило — при следующем импорте цвет снова попадёт в список нераспознанных";
      deleteBtn.addEventListener("click", async () => {
        await RenewalColors.deleteHexLegendEntry(entry.hex);
        await renderColorLegend();
      });
      row.append(swatch, label, select, deleteBtn);
      hexListEl.appendChild(row);
    });
  }

  async function renderTemplates() {
    const templates = await Schema.listTemplates();
    const listEl = document.getElementById("settings-templates-list");
    listEl.innerHTML = "";
    if (!templates.length) {
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = "Пока нет сохранённых шаблонов — сохраните текущую настройку столбцов на экране импорта.";
      listEl.appendChild(note);
      return;
    }
    templates.forEach((t) => {
      const row = document.createElement("div");
      row.className = "template-row";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = t.name;
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `${t.mapping.length} столб. · ${Utils.formatDate(t.savedAt)}`;
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn small danger";
      deleteBtn.textContent = "Удалить";
      deleteBtn.addEventListener("click", async () => {
        if (!confirm(`Удалить шаблон «${t.name}»?`)) return;
        await Schema.deleteTemplate(t.id);
        await renderTemplates();
      });
      row.append(name, meta, deleteBtn);
      listEl.appendChild(row);
    });
  }

  async function renderHistory() {
    const history = await ImportHistory.list();
    const listEl = document.getElementById("settings-history-list");
    listEl.innerHTML = "";
    if (!history.length) {
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = "Файлы ещё не импортировались.";
      listEl.appendChild(note);
      return;
    }
    history.slice(0, 15).forEach((h) => {
      const row = document.createElement("div");
      row.className = "history-row";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = h.fileName || "без имени";
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `${Utils.formatDateTime(h.at)} · строк: ${h.rowCount} · новых: ${h.created}, обновлено: ${h.updated}`;
      row.append(name, meta);
      listEl.appendChild(row);
    });
  }

  async function wireReminders() {
    const enabledCheck = document.getElementById("notif-enabled");
    const optionsRow = document.getElementById("notif-options");
    const intervalInput = document.getElementById("notif-interval");
    const leadDaysInput = document.getElementById("notif-lead-days");
    const checkNowBtn = document.getElementById("notif-check-now-btn");
    const statusEl = document.getElementById("notif-status");

    if (!Reminders.supported()) {
      enabledCheck.disabled = true;
      Utils.setStatus(statusEl, "Этот браузер не поддерживает системные уведомления.", "error");
      return;
    }

    const settings = await Reminders.loadSettings();
    enabledCheck.checked = settings.enabled;
    intervalInput.value = settings.intervalMinutes;
    leadDaysInput.value = settings.leadDays;
    optionsRow.hidden = !settings.enabled;

    function permissionNote() {
      const p = Reminders.permission();
      if (p === "denied") return "Уведомления заблокированы в настройках браузера для этого сайта — разрешите их вручную, чтобы напоминания приходили.";
      return "";
    }
    Utils.setStatus(statusEl, permissionNote(), "warn");

    // .onchange/.onclick (not addEventListener) throughout — these are
    // static inputs re-wired every time Settings is opened, so listeners
    // added with addEventListener would stack up on repeat visits.
    enabledCheck.onchange = async () => {
      if (enabledCheck.checked) {
        const perm = Reminders.permission() === "granted" ? "granted" : await Reminders.requestPermission();
        if (perm !== "granted") {
          enabledCheck.checked = false;
          Utils.setStatus(statusEl, "Без разрешения браузера уведомления показывать нельзя.", "error");
          return;
        }
      }
      optionsRow.hidden = !enabledCheck.checked;
      await Reminders.saveSettings({ enabled: enabledCheck.checked });
      Utils.setStatus(statusEl, enabledCheck.checked ? "Напоминания включены." : "Напоминания выключены.", "success");
    };

    intervalInput.onchange = async () => {
      const minutes = Math.max(1, parseInt(intervalInput.value, 10) || 15);
      intervalInput.value = minutes;
      await Reminders.saveSettings({ intervalMinutes: minutes });
    };

    leadDaysInput.onchange = async () => {
      const days = Math.max(0, parseInt(leadDaysInput.value, 10) || 0);
      leadDaysInput.value = days;
      await Reminders.saveSettings({ leadDays: days });
    };

    checkNowBtn.onclick = async () => {
      await Reminders.checkNow();
      const due = Reminders.dueClients().length;
      Utils.setStatus(statusEl, due ? `Просроченных перезвонов: ${due} — уведомление отправлено.` : "Просроченных перезвонов нет.", "info");
    };
  }

  async function wireAgentName() {
    const input = document.getElementById("settings-agent-name");
    input.value = (await DB.getConfig("agentName", "")) || "";
    // .onchange (not addEventListener) — this static input gets re-wired
    // every time Settings is opened, so an added listener would stack.
    input.onchange = () => DB.setConfig("agentName", input.value.trim());
  }

  function wireExport(mapping) {
    document.getElementById("export-clients-btn").onclick = async () => {
      const statusList = await Statuses.list();
      const cols = Schema.visibleSorted(mapping);
      const rows = ClientsStore.clients().map((client) => {
        const lastCall = ClientsStore.lastCallFor(client.id);
        const status = lastCall ? Statuses.byId(statusList, lastCall.statusId) : Statuses.NOT_CALLED;
        const out = {};
        cols.forEach((c) => {
          const raw = client.data[c.key];
          if (c.role === "phone") out[c.label] = Utils.formatPhone(raw);
          else if (c.role === "renewal_check") out[c.label] = Utils.parseRenewalCheck(raw).display;
          else out[c.label] = raw;
        });
        out["Статус"] = status.label;
        out["Следующий звонок"] = lastCall && lastCall.nextCallAt ? Utils.formatDate(lastCall.nextCallAt) : "";
        out["Звонков сделано"] = ClientsStore.callsFor(client.id).length;
        return out;
      });
      ImportExport.exportClients(mapping, rows, `клиенты_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    document.getElementById("export-calls-btn").onclick = async () => {
      const statusList = await Statuses.list();
      const nameCol = Schema.nameColumn(mapping);
      const calls = await DB.getAllCalls();
      const clientsById = new Map(ClientsStore.clients().map((c) => [c.id, c]));
      const rows = calls
        .sort((a, b) => b.at - a.at)
        .map((call) => {
          const client = clientsById.get(call.clientId);
          const status = Statuses.byId(statusList, call.statusId);
          return {
            Дата: Utils.formatDateTime(call.at),
            Клиент: client && nameCol ? client.data[nameCol.key] : "",
            Статус: status.label,
            Комментарий: call.comment || "",
            "Следующий звонок": call.nextCallAt ? Utils.formatDate(call.nextCallAt) : "",
            "Кто звонил": call.agent || "",
          };
        });
      ImportExport.exportCalls(rows, `звонки_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };
  }

  function wireDangerZone() {
    document.getElementById("settings-clear-btn").onclick = async () => {
      if (!confirm("Удалить всех клиентов, историю звонков и настройки без возможности восстановления?")) return;
      await DB.clearAll();
      location.reload();
    };
  }

  function wireDataActions(mapping, onReimport, onRemap) {
    document.getElementById("settings-reimport-btn").onclick = onReimport;
    document.getElementById("settings-remap-btn").onclick = () => onRemap(mapping);
  }

  async function show({ onRefreshAll, onReimport, onRemap }) {
    onNeedsFullRefresh = onRefreshAll;
    const mapping = await Schema.load();
    renderDataInfo(mapping);
    await renderStatuses();
    await renderColorLegend();
    await renderTemplates();
    await renderHistory();
    wireAddStatus();
    await wireReminders();
    await wireAgentName();
    wireExport(mapping);
    wireDangerZone();
    wireDataActions(mapping, onReimport, onRemap);
  }

  return { show };
})();
