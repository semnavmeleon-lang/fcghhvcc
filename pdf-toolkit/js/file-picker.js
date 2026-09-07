const FilePicker = (function () {
  function emptyMessage(kind) {
    if (kind === "pdf") return "В пуле нет PDF-файлов — добавьте их через панель «Файлы» вверху.";
    if (kind === "image") return "В пуле нет изображений — добавьте их через панель «Файлы» вверху.";
    return "В пуле нет подходящих файлов.";
  }

  /**
   * Wires a tool's file selection to the shared Pool without drawing its own
   * copy of the file list — that list lives in exactly one place, the top
   * "Файлы" bar (see PoolUI). This just tracks which pool entries (filtered
   * by kind) are selected, shows a one-line status in `container`, and — via
   * activate() — tells PoolUI to route chip clicks here.
   * opts: { accept: 'pdf'|'image', multi: boolean, onChange(selectedEntries) }
   */
  function mount(container, opts) {
    const kind = opts.accept || "pdf";
    const multi = !!opts.multi;
    let selected = new Set();
    let knownIds = new Set();
    let firstRender = true;
    let unsubscribe = null;

    function currentItems() {
      return Pool.list(kind);
    }

    function emitChange() {
      const items = currentItems();
      const result = items.filter((e) => selected.has(e.id));
      if (opts.onChange) opts.onChange(result);
    }

    function reconcileSelection(items) {
      const ids = items.map((e) => e.id);
      const idSet = new Set(ids);
      const newIds = ids.filter((id) => !knownIds.has(id));

      // Drop selections for files removed from the pool.
      selected.forEach((id) => {
        if (!idSet.has(id)) selected.delete(id);
      });

      // Multi-select pickers are purely opt-in — never auto-checked, not even
      // on first mount, so a batch tool never silently pulls in unrelated
      // pool files the user added for something else.
      if (multi) {
        // no auto-selection
      } else if (firstRender) {
        if (ids.length) selected = new Set([ids[ids.length - 1]]);
      } else if (opts.autoSwitch !== false) {
        if (newIds.length) {
          selected = new Set([newIds[newIds.length - 1]]);
        } else if (selected.size === 0 && ids.length) {
          selected = new Set([ids[ids.length - 1]]);
        }
      }

      firstRender = false;
      knownIds = idSet;
    }

    function statusText(items) {
      if (items.length === 0) return emptyMessage(kind);
      const chosen = items.filter((e) => selected.has(e.id));
      if (chosen.length === 0) return "Ничего не выбрано — отметьте файл(ы) в панели «Файлы» вверху.";
      if (!multi) {
        const e = chosen[0];
        return `Выбран: ${e.name} · ${Utils.formatBytes(e.size)}${e.pageCount != null ? ` · ${e.pageCount} стр.` : ""}`;
      }
      return `Выбрано файлов (${chosen.length}): ${chosen.map((e) => e.name).join(", ")}`;
    }

    function render() {
      const items = currentItems();
      reconcileSelection(items);
      container.textContent = statusText(items);
      container.className = "picker-status" + (items.length === 0 ? " picker-status-empty" : "");
      emitChange();
      // Someone's selection state may have just changed (auto-select on
      // pool change, reconciliation after removal, etc.) — reflect it in
      // the bar immediately rather than waiting for the next Pool event.
      PoolUI.refresh();
    }

    function toggle(id) {
      if (multi) {
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
      } else {
        selected = new Set([id]);
      }
      render();
    }

    unsubscribe = Pool.subscribe(render);

    return {
      getSelected: () => currentItems().filter((e) => selected.has(e.id)),
      selectOnly: (ids) => {
        selected = new Set(ids);
        render();
      },
      /** Makes this picker's selection the one the top "Файлы" bar drives. */
      activate: () => {
        PoolUI.setSelector({
          kind,
          multi,
          isSelected: (id) => selected.has(id),
          toggle,
        });
      },
      destroy: () => {
        if (unsubscribe) unsubscribe();
      },
    };
  }

  return { mount };
})();
