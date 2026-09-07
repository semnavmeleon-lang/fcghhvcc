const ViewMapping = (function () {
  let rowsState = [];
  let allRoles = [];
  let importRows = null; // null => "remap existing data" mode, no new rows
  let templates = [];
  let sheetMeta = null; // { sheet, rowRefs, headerColLetters } — only set for a real xlsx/xls import
  let fileHash = null;

  function buildInitialMapping(headers, existingMapping) {
    const byKey = new Map((existingMapping || []).map((m) => [m.key, m]));
    return headers.map((header, i) => {
      const prev = byKey.get(header);
      if (prev) return { ...prev, order: i };
      return {
        key: header,
        label: header,
        role: Schema.guessRole(header),
        visible: true,
        order: i,
        isMatchKey: false,
        isPolicyEndDate: false,
      };
    });
  }

  function applyTemplate(template) {
    if (!template) return;
    const byKey = new Map(template.mapping.map((m) => [m.key, m]));
    rowsState.forEach((col) => {
      const t = byKey.get(col.key);
      if (!t) return;
      col.label = t.label;
      col.role = t.role;
      col.visible = t.visible;
      col.isMatchKey = t.isMatchKey;
      col.isPolicyEndDate = t.isPolicyEndDate;
    });
    renderColumns();
    refreshSelectOptions();
    renderColorHint();
  }

  function refreshSelectOptions() {
    const keySelect = document.getElementById("mapping-keycol");
    const endSelect = document.getElementById("mapping-enddate");
    const prevKey = keySelect.value;
    const prevEnd = endSelect.value;
    keySelect.innerHTML = '<option value="">— не выбрано —</option>';
    endSelect.innerHTML = '<option value="">— не выбрано —</option>';
    rowsState
      .filter((c) => c.visible !== false)
      .forEach((c) => {
        const o1 = document.createElement("option");
        o1.value = c.key;
        o1.textContent = c.label;
        keySelect.appendChild(o1);
        const o2 = document.createElement("option");
        o2.value = c.key;
        o2.textContent = c.label;
        endSelect.appendChild(o2);
      });
    const matchCol = rowsState.find((c) => c.isMatchKey && c.visible !== false);
    keySelect.value = matchCol ? matchCol.key : prevKey;
    const endCol = rowsState.find((c) => c.isPolicyEndDate && c.visible !== false);
    endSelect.value = endCol ? endCol.key : prevEnd;
  }

  function renderTemplateSelect() {
    const select = document.getElementById("mapping-template-select");
    select.innerHTML = '<option value="">— не применять —</option>';
    templates.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.name} (${t.mapping.length} столб.)`;
      select.appendChild(opt);
    });
  }

  function renderRoleStrip(stripEl, col) {
    stripEl.innerHTML = "";
    allRoles.forEach((role) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "role-pill" + (col.role === role.id ? " active" : "");
      pill.textContent = role.label;
      pill.style.setProperty("--pill-color", role.color);
      pill.addEventListener("click", () => {
        col.role = role.id;
        stripEl.querySelectorAll(".role-pill").forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        renderColorHint();
      });
      stripEl.appendChild(pill);
    });

    const addPill = document.createElement("button");
    addPill.type = "button";
    addPill.className = "role-pill add-role-pill";
    addPill.textContent = "+ Своя роль";
    addPill.addEventListener("click", async () => {
      const name = prompt("Название новой роли, например «VIN» или «Ответственный агент»:");
      if (!name || !name.trim()) return;
      const role = await Schema.addCustomRole(name.trim());
      allRoles = await Schema.getAllRoles();
      col.role = role.id;
      renderColumns(); // the new role must appear in every row's strip, not just this one
    });
    stripEl.appendChild(addPill);
  }

  function renderColumns() {
    const list = document.getElementById("mapping-columns-list");
    list.innerHTML = "";
    rowsState.forEach((col) => {
      const card = document.createElement("div");
      card.className = "mapping-col-card" + (col.visible === false ? " disabled-card" : "");

      const top = document.createElement("div");
      top.className = "mapping-col-top";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = col.visible !== false;
      check.addEventListener("change", () => {
        col.visible = check.checked;
        card.classList.toggle("disabled-card", !check.checked);
        refreshSelectOptions();
      });

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.value = col.label;
      labelInput.addEventListener("input", () => {
        col.label = labelInput.value;
        refreshSelectOptions();
      });

      const keyNote = document.createElement("span");
      keyNote.className = "mapping-col-key";
      keyNote.textContent = `исходный столбец: «${col.key}»`;
      keyNote.title = col.key;

      top.append(check, labelInput, keyNote);

      const strip = document.createElement("div");
      strip.className = "role-strip";
      renderRoleStrip(strip, col);

      card.append(top, strip);
      list.appendChild(card);
    });
    refreshSelectOptions();
  }

  /** Shown when the renewal-results column contains fill colours the family
   * legend can't classify. Blocks completing the import until each one is
   * assigned a meaning (or "skip") — the choice is remembered in the hex
   * legend, so it never has to be made again for that exact colour. */
  async function renderColorReview(unresolved, onContinue) {
    const el = document.getElementById("mapping-color-review");
    const statusList = await Statuses.list();
    el.innerHTML = "";
    el.hidden = false;

    const title = document.createElement("div");
    title.className = "color-review-title";
    title.textContent = `Столбец «Результаты пролонгации»: ${unresolved.length} цвет(ов) не распознаны автоматически — укажите, что каждый значит.`;
    el.appendChild(title);

    const rowsEl = [];
    unresolved.forEach((u) => {
      const row = document.createElement("div");
      row.className = "color-review-row";

      const swatch = document.createElement("span");
      swatch.className = "color-swatch";
      swatch.style.background = "#" + u.hex;

      const info = document.createElement("span");
      info.className = "color-review-info";
      info.textContent = `#${u.hex} · встречается: ${u.count}` + (u.sample ? ` · например: «${u.sample}»` : "");

      const select = document.createElement("select");
      const skipOpt = document.createElement("option");
      skipOpt.value = "";
      skipOpt.textContent = "— пропустить (не создавать запись) —";
      select.appendChild(skipOpt);
      statusList.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.label;
        select.appendChild(opt);
      });

      row.append(swatch, info, select);
      el.appendChild(row);
      rowsEl.push({ hex: u.hex, select });
    });

    const continueBtn = document.createElement("button");
    continueBtn.type = "button";
    continueBtn.className = "btn primary";
    continueBtn.textContent = "Сохранить значения цветов и продолжить импорт";
    continueBtn.addEventListener("click", async () => {
      const choices = rowsEl.map((r) => ({ hex: r.hex, statusId: r.select.value }));
      await RenewalColors.saveHexLegendChoices(choices);
      el.hidden = true;
      el.innerHTML = "";
      onContinue();
    });
    el.appendChild(continueBtn);
  }

  /** Catches the exact mistake that silently breaks the colour import: the
   * results column not being marked with the "renewal_result" role (auto-
   * guessing only fires for headers that literally say "результаты
   * пролонгации" — a differently-named column, e.g. "Итог звонка", is left
   * on whatever role it guessed and the colours are never read). Scans a
   * sample of cells per column for a fill colour and, if a clearly-coloured
   * column exists but nothing is marked renewal_result yet, offers a
   * one-click fix. */
  function renderColorHint() {
    const hintEl = document.getElementById("mapping-color-hint");
    if (!importRows || !sheetMeta) {
      hintEl.hidden = true;
      return;
    }
    const alreadyMarked = rowsState.some((c) => c.role === "renewal_result" && c.visible !== false);
    if (alreadyMarked) {
      hintEl.hidden = true;
      return;
    }
    const sampleSize = Math.min(importRows.length, 300);
    const candidates = rowsState.filter((col) => {
      const colLetter = sheetMeta.headerColLetters[col.key];
      if (!colLetter || !sampleSize) return false;
      let colored = 0;
      for (let i = 0; i < sampleSize; i++) {
        if (ImportExport.getCellInfo(sheetMeta.sheet, colLetter, sheetMeta.rowRefs[i]).hex) colored++;
      }
      return colored / sampleSize >= 0.2;
    });
    if (!candidates.length) {
      hintEl.hidden = true;
      return;
    }
    hintEl.hidden = false;
    hintEl.innerHTML = "";
    const text = document.createElement("span");
    text.textContent =
      (candidates.length === 1 ? `В столбце «${candidates[0].label}» много закрашенных ячеек` : "В нескольких столбцах много закрашенных ячеек") +
      " — если это результаты пролонгации (цвет + комментарий по клиенту), отметьте роль, чтобы при импорте по ним автоматически создалась история звонков:";
    hintEl.appendChild(text);
    candidates.forEach((col) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn small";
      btn.textContent = `Отметить «${col.label}»`;
      btn.addEventListener("click", () => {
        col.role = "renewal_result";
        renderColumns();
        renderColorHint();
      });
      hintEl.appendChild(btn);
    });
  }

  function renderDuplicateWarning(duplicateInfo) {
    const el = document.getElementById("mapping-duplicate-warning");
    if (!duplicateInfo) {
      Utils.setStatus(el, "", "");
      return;
    }
    el.textContent = `Похоже, этот файл уже импортировался ${Utils.formatDateTime(duplicateInfo.at)} (тогда: новых — ${duplicateInfo.created}, обновлено — ${duplicateInfo.updated}). Можно импортировать повторно — записи с тем же ключом просто обновятся.`;
    el.className = "status warn";
  }

  /** opts: { headers, rows (null for "edit mapping only", no re-import),
   * existingMapping, duplicateInfo, sheetMeta, fileHash, onDone(result),
   * onCancel() (omit to hide Cancel) } */
  async function show({ headers, rows, existingMapping, duplicateInfo, sheetMeta: meta, fileHash: hash, onDone, onCancel }) {
    importRows = rows || null;
    sheetMeta = meta && meta.sheet ? meta : null;
    fileHash = hash || null;
    allRoles = await Schema.getAllRoles();
    templates = await Schema.listTemplates();
    const colorReviewEl = document.getElementById("mapping-color-review");
    colorReviewEl.hidden = true;
    colorReviewEl.innerHTML = "";
    document.getElementById("mapping-color-hint").hidden = true;

    const suggested = importRows ? Schema.findBestTemplate(templates, headers) : null;
    rowsState = buildInitialMapping(headers, existingMapping);
    if (suggested) applyTemplate(suggested);

    renderTemplateSelect();
    document.getElementById("mapping-template-select").value = suggested ? suggested.id : "";
    renderColumns();
    renderColorHint();
    renderDuplicateWarning(duplicateInfo);

    const importBtn = document.getElementById("mapping-import-btn");
    const cancelBtn = document.getElementById("mapping-cancel-btn");
    const saveTemplateBtn = document.getElementById("mapping-save-template-btn");
    const templateSelect = document.getElementById("mapping-template-select");
    const statusEl = document.getElementById("mapping-status");
    Utils.setStatus(statusEl, "", "");
    importBtn.textContent = importRows ? "Импортировать" : "Сохранить";
    cancelBtn.hidden = !onCancel;

    const keySelect = document.getElementById("mapping-keycol");
    const endSelect = document.getElementById("mapping-enddate");
    keySelect.onchange = () => rowsState.forEach((c) => (c.isMatchKey = c.key === keySelect.value));
    endSelect.onchange = () => rowsState.forEach((c) => (c.isPolicyEndDate = c.key === endSelect.value));
    cancelBtn.onclick = () => {
      if (onCancel) onCancel();
    };

    templateSelect.onchange = () => {
      const t = templates.find((x) => x.id === templateSelect.value);
      if (t) applyTemplate(t);
    };

    saveTemplateBtn.onclick = async () => {
      const name = prompt("Название шаблона:", "");
      if (!name || !name.trim()) return;
      await Schema.saveTemplate(name.trim(), rowsState);
      templates = await Schema.listTemplates();
      renderTemplateSelect();
      const saved = templates.find((t) => t.name === name.trim());
      if (saved) templateSelect.value = saved.id;
      Utils.setStatus(statusEl, `Шаблон «${name.trim()}» сохранён.`, "success");
    };

    async function doImport() {
      importBtn.disabled = true;
      try {
        let result = null;
        if (importRows) {
          const resultCol = Schema.renewalResultColumn(rowsState);
          if (resultCol && sheetMeta) {
            const unresolved = await RenewalColors.findUnresolved(rowsState, importRows, sheetMeta);
            if (unresolved.length) {
              importBtn.disabled = false;
              Utils.setStatus(statusEl, "", "");
              await renderColorReview(unresolved, doImport);
              return;
            }
          }
          Utils.setStatus(statusEl, "Импортирую...", "info");
          result = await ClientsStore.importRows(rowsState, importRows);
          await Schema.save(rowsState);
          let message = `Готово: новых клиентов — ${result.created}, обновлено — ${result.updated}.`;
          if (resultCol && sheetMeta) {
            const colorSummary = await RenewalColors.applyToImportedClients(rowsState, importRows, sheetMeta, result.clientIds, fileHash);
            if (colorSummary.logged) {
              const parts = colorSummary.byStatus.map((s) => `${s.label} — ${s.count}`).join(", ");
              message += ` Из столбца «${resultCol.label}» создано записей о звонках: ${colorSummary.logged} (${parts}).`;
            }
          }
          Utils.setStatus(statusEl, message, "success");
        } else {
          await Schema.save(rowsState);
        }
        if (onDone) onDone(result);
      } catch (err) {
        console.error(err);
        Utils.setStatus(statusEl, "Ошибка: " + err.message, "error");
      } finally {
        importBtn.disabled = false;
      }
    }
    importBtn.onclick = doImport;
  }

  return { show };
})();
