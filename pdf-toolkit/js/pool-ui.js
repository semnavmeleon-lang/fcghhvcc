// Single place where the shared file pool is rendered. Tools never draw
// their own copy of this list — they register a "selector" describing
// which kind of file they need and how selection should behave, and this
// bar highlights/dims chips and reports clicks back to that selector.
// See FilePicker.mount()'s activate(), which is the only caller of setSelector.
const PoolUI = (function () {
  let activeSelector = null; // { kind, multi, isSelected(id), toggle(id) } | null
  let latestEntries = [];
  let listEl = null;
  let countEl = null;

  function formatEntry(entry) {
    const parts = [Utils.formatBytes(entry.size)];
    if (entry.kind === "pdf") parts.push(entry.pageCount != null ? `${entry.pageCount} стр.` : "читаю…");
    return parts.join(" · ");
  }

  function render() {
    if (!listEl) return;
    countEl.textContent = latestEntries.length ? `(${latestEntries.length})` : "";
    listEl.innerHTML = "";

    if (latestEntries.length === 0) {
      const empty = document.createElement("span");
      empty.className = "pool-bar-empty";
      empty.textContent = "Пока пусто — добавьте PDF или изображения, они станут доступны во всех инструментах.";
      listEl.appendChild(empty);
      return;
    }

    latestEntries.forEach((entry) => {
      const selectable = !!activeSelector && entry.kind === activeSelector.kind;
      const selected = selectable && activeSelector.isSelected(entry.id);

      const chip = document.createElement("span");
      chip.className =
        "pool-chip" +
        (selectable ? " pool-chip-selectable" : "") +
        (selected ? " pool-chip-selected" : "") +
        (activeSelector && !selectable ? " pool-chip-inactive" : "");

      const badge = document.createElement("span");
      badge.className = "pool-chip-badge " + entry.kind;
      badge.textContent = entry.kind === "pdf" ? "PDF" : entry.kind === "image" ? "IMG" : "FILE";

      const name = document.createElement("span");
      name.className = "pool-chip-name";
      name.textContent = entry.name;
      name.title = entry.name;

      const meta = document.createElement("span");
      meta.className = "pool-chip-meta";
      meta.textContent = formatEntry(entry);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "pool-chip-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "Убрать из пула";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        Pool.remove(entry.id);
      });

      chip.append(badge, name, meta, removeBtn);

      if (selectable) {
        chip.title = selected ? "Нажмите, чтобы убрать из выбора" : "Нажмите, чтобы выбрать для текущего инструмента";
        chip.addEventListener("click", (e) => {
          if (e.target.closest(".pool-chip-remove")) return;
          activeSelector.toggle(entry.id);
        });
      }

      listEl.appendChild(chip);

      if (entry.kind === "pdf" && entry.pageCount == null) {
        Pool.getPdfDoc(entry.id).catch(() => {});
      }
    });
  }

  function init() {
    const bar = document.querySelector(".pool-bar");
    listEl = document.getElementById("pool-bar-list");
    countEl = document.getElementById("pool-count");
    const input = document.getElementById("pool-file-input");
    if (!listEl || !input) return;

    input.addEventListener("change", () => {
      if (input.files && input.files.length) Pool.addFiles(input.files);
      input.value = "";
    });

    // Whole bar accepts drag & drop (but not click, so chip buttons stay clickable).
    ["dragenter", "dragover"].forEach((evt) =>
      bar.addEventListener(evt, (e) => {
        e.preventDefault();
        bar.classList.add("dragover");
      })
    );
    ["dragleave", "dragend", "drop"].forEach((evt) =>
      bar.addEventListener(evt, (e) => {
        e.preventDefault();
        bar.classList.remove("dragover");
      })
    );
    bar.addEventListener("drop", (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) Pool.addFiles(files);
    });

    Pool.subscribe((entries) => {
      latestEntries = entries;
      render();
    });
  }

  /** Tools call this (via FilePicker controller's activate()) when their
   * panel becomes the active one, so chip clicks route to their selection. */
  function setSelector(selector) {
    activeSelector = selector;
    render();
  }

  /** Re-render with the current selector's latest state (e.g. after an
   * auto-selection or a programmatic selectOnly()). */
  function refresh() {
    render();
  }

  init();

  return { setSelector, refresh };
})();
