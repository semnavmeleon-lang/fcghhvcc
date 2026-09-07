(function () {
  const screens = {
    onboarding: document.getElementById("screen-onboarding"),
    mapping: document.getElementById("screen-mapping"),
    app: document.getElementById("screen-app"),
  };
  const views = {
    clients: document.getElementById("view-clients"),
    stats: document.getElementById("view-stats"),
    settings: document.getElementById("view-settings"),
  };
  const navItems = Array.from(document.querySelectorAll(".nav-item"));
  let activeView = "clients";

  function showScreen(name) {
    Object.keys(screens).forEach((k) => (screens[k].hidden = k !== name));
  }

  function hasAnyData() {
    return ClientsStore.clients().length > 0;
  }

  async function showView(name) {
    activeView = name;
    Object.keys(views).forEach((k) => (views[k].hidden = k !== name));
    navItems.forEach((btn) => btn.classList.toggle("active", btn.dataset.view === name));
    if (name === "clients") await ViewClients.show({ onOpenClient: openClient });
    else if (name === "stats") await ViewStats.show();
    else if (name === "settings")
      await ViewSettings.show({ onRefreshAll: refreshAllAndRerender, onReimport: startReimport, onRemap: startRemap });
  }

  async function refreshAllAndRerender() {
    await ClientsStore.loadAll();
    await showView(activeView);
    // Logging/editing/deleting a call can resolve or create a due reminder —
    // don't make the user wait for the next timer tick to see that reflected.
    Reminders.checkNow();
  }

  function openClient(id) {
    ViewClientModal.open(id, { onChanged: refreshAllAndRerender });
  }

  async function focusDueCallbacks() {
    showScreen("app");
    await showView("clients");
    ViewClients.showDueCallbacks();
  }

  navItems.forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.view)));

  async function startImportWizard(parsed) {
    const existingMapping = await Schema.load();
    const duplicateInfo = parsed.hash ? await ImportHistory.findByHash(parsed.hash) : null;
    showScreen("mapping");
    ViewMapping.show({
      headers: parsed.headers,
      rows: parsed.rows,
      existingMapping,
      duplicateInfo,
      onDone: async (result) => {
        if (result) {
          await ImportHistory.record({
            fileName: parsed.fileName,
            fileSize: parsed.fileSize,
            hash: parsed.hash,
            rowCount: parsed.rows.length,
            created: result.created,
            updated: result.updated,
          });
        }
        await ClientsStore.loadAll();
        showScreen("app");
        await showView("clients");
      },
      onCancel: hasAnyData()
        ? () => {
            showScreen("app");
            showView(activeView);
          }
        : undefined,
    });
  }

  function startReimport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv";
    input.addEventListener("change", async () => {
      if (!input.files || !input.files[0]) return;
      try {
        const parsed = await ImportExport.readFile(input.files[0]);
        if (!parsed.rows.length) throw new Error("В файле не найдено ни одной строки данных");
        startImportWizard(parsed);
      } catch (err) {
        console.error(err);
        alert("Ошибка чтения файла: " + err.message);
      }
    });
    input.click();
  }

  function startRemap(mapping) {
    showScreen("mapping");
    ViewMapping.show({
      headers: mapping.map((m) => m.key),
      rows: null,
      existingMapping: mapping,
      onDone: () => {
        showScreen("app");
        showView(activeView);
      },
      onCancel: () => {
        showScreen("app");
        showView(activeView);
      },
    });
  }

  async function boot() {
    try {
      await ClientsStore.loadAll();
      await Reminders.init({ onNotificationClick: focusDueCallbacks });
      if (hasAnyData()) {
        showScreen("app");
        await showView("clients");
      } else {
        showScreen("onboarding");
        ViewOnboarding.init(startImportWizard);
      }
    } catch (err) {
      console.error(err);
      document.body.innerHTML =
        '<div style="padding:40px;font-family:sans-serif;color:#c22032">Не удалось открыть локальную базу данных браузера: ' +
        Utils.escapeHtml(err.message) +
        "</div>";
    }
  }

  boot();
})();
