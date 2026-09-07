const ViewStats = (function () {
  function tile(value, label, color, opts) {
    const div = document.createElement("div");
    div.className = "stat-tile" + (opts && opts.highlight ? " stat-tile-highlight" : "");
    const valueEl = document.createElement("div");
    valueEl.className = "stat-value";
    valueEl.textContent = value;
    const labelEl = document.createElement("div");
    labelEl.className = "stat-label";
    if (color) {
      const dot = document.createElement("span");
      dot.className = "stat-dot";
      dot.style.background = color;
      labelEl.appendChild(dot);
    }
    labelEl.appendChild(document.createTextNode(label));
    div.append(valueEl, labelEl);
    return div;
  }

  function isSameDay(ts, ref) {
    const d = new Date(ts);
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
  }

  async function show() {
    const mapping = await Schema.load();
    const statusList = await Statuses.list();
    const clients = ClientsStore.clients();
    const grid = document.getElementById("stats-grid");
    grid.innerHTML = "";

    grid.appendChild(tile(clients.length, "Всего клиентов"));

    const counts = new Map();
    counts.set(Statuses.NOT_CALLED.id, 0);
    statusList.forEach((s) => counts.set(s.id, 0));
    clients.forEach((c) => {
      const lastCall = ClientsStore.lastCallFor(c.id);
      const id = lastCall ? lastCall.statusId : Statuses.NOT_CALLED.id;
      counts.set(id, (counts.get(id) || 0) + 1);
    });

    // Conversion = share of already-called clients whose latest outcome is
    // "Продлил" (matched by the seed status id, so renaming it in Settings
    // still works — only deleting it entirely hides this tile).
    const calledCount = clients.length - (counts.get(Statuses.NOT_CALLED.id) || 0);
    const renewedStatus = statusList.find((s) => s.id === "renewed");
    if (renewedStatus) {
      const renewedCount = counts.get(renewedStatus.id) || 0;
      const pct = calledCount > 0 ? Math.round((renewedCount / calledCount) * 1000) / 10 : null;
      grid.appendChild(
        tile(pct == null ? "—" : `${pct}%`, `Конверсия («${renewedStatus.label}» из обзвоненных)`, renewedStatus.color, { highlight: true })
      );
    }

    // Second conversion: how many clients the system's own advance check
    // even let through for renewal, independent of whether they've been
    // called yet — that check runs long before the calling campaign starts.
    const renewalCol = Schema.renewalCheckColumn(mapping);
    if (renewalCol) {
      let checked = 0;
      let approved = 0;
      clients.forEach((c) => {
        const info = Utils.parseRenewalCheck(c.data[renewalCol.key]);
        if (info.checked) {
          checked++;
          if (info.approved) approved++;
        }
      });
      const pct2 = checked > 0 ? Math.round((approved / checked) * 1000) / 10 : null;
      grid.appendChild(
        tile(pct2 == null ? "—" : `${pct2}%`, "Конверсия (одобрено для пролонгации)", "#0d9488", { highlight: true })
      );
    }

    [Statuses.NOT_CALLED, ...statusList].forEach((s) => {
      grid.appendChild(tile(counts.get(s.id) || 0, s.label, s.color));
    });

    const endCol = Schema.policyEndColumn(mapping);
    if (endCol) {
      const in7 = clients.filter((c) => {
        const d = Utils.daysUntil(c.data[endCol.key]);
        return d != null && d <= 7;
      }).length;
      const in30 = clients.filter((c) => {
        const d = Utils.daysUntil(c.data[endCol.key]);
        return d != null && d <= 30;
      }).length;
      grid.appendChild(tile(in7, "Полис истекает ≤ 7 дней", "#c22032"));
      grid.appendChild(tile(in30, "Полис истекает ≤ 30 дней", "#9a6a00"));
    }

    const allCalls = await DB.getAllCalls();
    const today = new Date();
    const callsToday = allCalls.filter((c) => isSameDay(c.at, today)).length;
    grid.appendChild(tile(callsToday, "Звонков сделано сегодня"));
  }

  return { show };
})();
