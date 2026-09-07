const ViewClientModal = (function () {
  let currentClient = null;
  let mapping = [];
  let statusList = [];
  let editing = false;
  let editingCallId = null; // id of the call entry currently shown as an inline edit form
  let onChanged = null; // called after a call is logged / data edited, so outer views refresh

  function fieldRow(col, value) {
    const row = document.createElement("div");
    row.className = "client-field-row";
    const label = document.createElement("span");
    label.className = "field-label";
    label.textContent = col.label;
    row.appendChild(label);

    if (editing) {
      const input = document.createElement("input");
      input.type = "text";
      input.value = value instanceof Date ? Utils.formatDate(value) : value == null ? "" : String(value);
      input.dataset.key = col.key;
      row.appendChild(input);
    } else {
      const val = document.createElement("span");
      if (col.role === "money") val.textContent = Utils.formatMoney(value);
      else if (col.role === "date") val.textContent = Utils.formatDate(value);
      else if (col.role === "phone") val.textContent = Utils.formatPhone(value);
      else if (col.role === "renewal_check") {
        const info = Utils.parseRenewalCheck(value);
        if (info.checked) {
          const badge = document.createElement("span");
          badge.className = "badge";
          badge.style.background = info.approved ? "var(--success)" : "var(--text-faint)";
          badge.textContent = info.display;
          val.appendChild(badge);
        }
      } else val.textContent = value == null ? "" : String(value);
      row.appendChild(val);
    }
    return row;
  }

  function renderFields() {
    const container = document.getElementById("client-modal-fields");
    container.innerHTML = "";
    Schema.visibleSorted(mapping).forEach((col) => {
      container.appendChild(fieldRow(col, currentClient.data[col.key]));
    });
    document.getElementById("client-modal-edit-toggle").textContent = editing ? "Сохранить" : "Изменить";
  }

  function buildCallEntry(call) {
    const status = Statuses.byId(statusList, call.statusId);
    const entry = document.createElement("div");
    entry.className = "call-entry";

    const head = document.createElement("div");
    head.className = "call-entry-head";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.style.background = status.color;
    badge.textContent = status.label;
    const meta = document.createElement("span");
    meta.className = "call-entry-meta";
    meta.textContent = Utils.formatDateTime(call.at) + (call.agent ? ` · ${call.agent}` : "");

    const actions = document.createElement("span");
    actions.className = "call-entry-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "call-entry-action";
    editBtn.textContent = "Изменить";
    editBtn.addEventListener("click", () => {
      editingCallId = call.id;
      renderCalls();
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "call-entry-action danger";
    delBtn.textContent = "Удалить";
    delBtn.addEventListener("click", async () => {
      if (!confirm("Удалить эту запись о звонке? Отменить будет нельзя.")) return;
      await ClientsStore.deleteCall(call.id);
      renderCalls();
      if (onChanged) onChanged();
    });
    actions.append(editBtn, delBtn);

    head.append(badge, meta, actions);
    entry.appendChild(head);

    if (call.comment) {
      const comment = document.createElement("div");
      comment.className = "call-entry-comment";
      comment.textContent = call.comment;
      entry.appendChild(comment);
    }
    if (call.nextCallAt) {
      const next = document.createElement("div");
      next.className = "call-entry-next";
      next.textContent = "Перезвонить: " + Utils.formatDate(call.nextCallAt);
      entry.appendChild(next);
    }
    return entry;
  }

  function buildCallEditForm(call) {
    const wrap = document.createElement("div");
    wrap.className = "call-entry call-entry-editing";

    const statusSelect = document.createElement("select");
    statusList.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label;
      if (s.id === call.statusId) opt.selected = true;
      statusSelect.appendChild(opt);
    });

    const commentInput = document.createElement("textarea");
    commentInput.rows = 2;
    commentInput.placeholder = "Комментарий...";
    commentInput.value = call.comment || "";

    const nextLabel = document.createElement("label");
    nextLabel.className = "call-form-next";
    nextLabel.append("Перезвонить: ");
    const nextInput = document.createElement("input");
    nextInput.type = "date";
    nextInput.value = call.nextCallAt || "";
    nextLabel.appendChild(nextInput);

    const actions = document.createElement("div");
    actions.className = "call-entry-edit-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn small primary";
    saveBtn.textContent = "Сохранить";
    saveBtn.addEventListener("click", async () => {
      await ClientsStore.updateCall(call.id, {
        statusId: statusSelect.value,
        comment: commentInput.value.trim(),
        nextCallAt: nextInput.value || null,
      });
      editingCallId = null;
      renderCalls();
      if (onChanged) onChanged();
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn small";
    cancelBtn.textContent = "Отмена";
    cancelBtn.addEventListener("click", () => {
      editingCallId = null;
      renderCalls();
    });
    actions.append(saveBtn, cancelBtn);

    wrap.append(statusSelect, commentInput, nextLabel, actions);
    return wrap;
  }

  function renderCalls() {
    const calls = ClientsStore.callsFor(currentClient.id);
    const listEl = document.getElementById("client-modal-calls");
    listEl.innerHTML = "";
    if (!calls.length) {
      const note = document.createElement("div");
      note.className = "no-calls-note";
      note.textContent = "Звонков пока не было.";
      listEl.appendChild(note);
      return;
    }
    calls.forEach((call) => {
      listEl.appendChild(editingCallId === call.id ? buildCallEditForm(call) : buildCallEntry(call));
    });
  }

  function renderStatusOptions() {
    const select = document.getElementById("client-modal-call-status");
    select.innerHTML = "";
    statusList.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label;
      select.appendChild(opt);
    });
  }

  async function saveEdits() {
    const container = document.getElementById("client-modal-fields");
    const data = {};
    container.querySelectorAll("input[data-key]").forEach((input) => {
      data[input.dataset.key] = input.value;
    });
    await ClientsStore.updateClientData(currentClient.id, data);
    const refreshed = ClientsStore.clients().find((c) => c.id === currentClient.id);
    if (refreshed) currentClient = refreshed;
    if (onChanged) onChanged();
  }

  let wired = false;
  function wireOnce() {
    if (wired) return;
    wired = true;

    document.getElementById("client-modal-close").addEventListener("click", close);
    document.getElementById("client-modal").addEventListener("click", (e) => {
      if (e.target.id === "client-modal") close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("client-modal").hidden) close();
    });

    document.getElementById("client-modal-edit-toggle").addEventListener("click", async () => {
      if (editing) {
        await saveEdits();
        editing = false;
      } else {
        editing = true;
      }
      renderFields();
    });

    document.getElementById("client-modal-delete").addEventListener("click", async () => {
      if (!currentClient) return;
      const nameCol = Schema.nameColumn(mapping);
      const name = nameCol ? currentClient.data[nameCol.key] : "";
      if (!confirm(`Удалить клиента «${name || "без имени"}» и всю его историю звонков?`)) return;
      const changed = onChanged;
      await ClientsStore.removeClient(currentClient.id);
      close();
      if (changed) changed();
    });

    document.getElementById("client-modal-call-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const statusId = document.getElementById("client-modal-call-status").value;
      const comment = document.getElementById("client-modal-call-comment").value.trim();
      const nextCallAt = document.getElementById("client-modal-call-next").value || null;
      const agent = await DB.getConfig("agentName", "");
      await ClientsStore.logCall(currentClient.id, { statusId, comment, nextCallAt, agent });
      document.getElementById("client-modal-call-comment").value = "";
      document.getElementById("client-modal-call-next").value = "";
      renderCalls();
      if (onChanged) onChanged();
    });
  }

  function close() {
    document.getElementById("client-modal").hidden = true;
    currentClient = null;
    editing = false;
    editingCallId = null;
  }

  async function open(clientId, opts) {
    onChanged = (opts && opts.onChanged) || null;
    mapping = await Schema.load();
    statusList = await Statuses.list();
    currentClient = ClientsStore.clients().find((c) => c.id === clientId);
    if (!currentClient) return;
    editing = false;
    editingCallId = null;

    wireOnce();
    const nameCol = Schema.nameColumn(mapping);
    document.getElementById("client-modal-title").textContent = nameCol ? String(currentClient.data[nameCol.key] || "Клиент") : "Клиент";
    renderFields();
    renderStatusOptions();
    renderCalls();
    document.getElementById("client-modal").hidden = false;
  }

  return { open, close };
})();
