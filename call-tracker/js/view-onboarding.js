const ViewOnboarding = (function () {
  let wired = false;

  function init(onFileParsed) {
    const dropzone = document.getElementById("onboarding-dropzone");
    const input = document.getElementById("onboarding-file-input");
    const statusEl = document.getElementById("onboarding-status");

    async function handleFile(file) {
      Utils.setStatus(statusEl, "Читаю файл...", "info");
      try {
        const parsed = await ImportExport.readFile(file);
        if (!parsed.rows.length) throw new Error("В файле не найдено ни одной строки данных");
        Utils.setStatus(statusEl, "", "");
        onFileParsed(parsed);
      } catch (err) {
        console.error(err);
        Utils.setStatus(statusEl, "Ошибка чтения файла: " + err.message, "error");
      }
    }

    if (wired) return;
    wired = true;

    dropzone.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      if (input.files && input.files[0]) handleFile(input.files[0]);
      input.value = "";
    });
    ["dragenter", "dragover"].forEach((evt) =>
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
      })
    );
    ["dragleave", "dragend", "drop"].forEach((evt) =>
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
      })
    );
    dropzone.addEventListener("drop", (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
  }

  return { init };
})();
