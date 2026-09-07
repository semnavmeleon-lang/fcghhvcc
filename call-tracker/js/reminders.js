// Nags the user with real Windows notifications (via the browser's
// Notification API — Chrome/Edge route these into the Windows Action
// Center) about overdue "Перезвонить" callbacks. This only works while
// this tab is open somewhere (can be minimized/in the background) — there's
// no server here to push notifications once the browser itself is closed.
const Reminders = (function () {
  const DEFAULTS = { enabled: false, intervalMinutes: 15, leadDays: 0 };

  let settings = { ...DEFAULTS };
  let timerId = null;
  let activeNotification = null;
  let onNotificationClick = null;

  function supported() {
    return typeof Notification !== "undefined";
  }

  function permission() {
    return supported() ? Notification.permission : "unsupported";
  }

  async function loadSettings() {
    settings = await DB.getConfig("notifSettings", DEFAULTS);
    return settings;
  }

  async function saveSettings(next) {
    settings = { ...settings, ...next };
    await DB.setConfig("notifSettings", settings);
    restart();
    return settings;
  }

  async function requestPermission() {
    if (!supported()) return "unsupported";
    return Notification.requestPermission();
  }

  function dueClients() {
    return ClientsStore.clients().filter((c) => {
      const lastCall = ClientsStore.lastCallFor(c.id);
      if (!lastCall || !lastCall.nextCallAt) return false;
      const days = Utils.daysUntil(lastCall.nextCallAt);
      return days != null && days <= settings.leadDays;
    });
  }

  /** Returns what actually happened, so the caller (Settings' "Проверить
   * сейчас" button) can tell the user the truth instead of a status message
   * that only checked "are there due clients" and called that "sent" even
   * when reminders were off or permission was never granted — which made
   * "nothing shows up" impossible to diagnose. */
  async function checkNow() {
    if (!settings.enabled) return "disabled";
    if (permission() !== "granted") return "no-permission";
    await ClientsStore.loadAll();
    const due = dueClients();

    if (due.length === 0) {
      if (activeNotification) {
        activeNotification.close();
        activeNotification = null;
      }
      return "no-due";
    }

    const mapping = await Schema.load();
    const nameCol = mapping ? Schema.nameColumn(mapping) : null;
    const names = due.slice(0, 3).map((c) => (nameCol ? c.data[nameCol.key] : "клиент"));
    let body = (due.length === 1 ? "Нужно перезвонить: " : `Нужно перезвонить (${due.length}): `) + names.join(", ");
    if (due.length > 3) body += ` и ещё ${due.length - 3}`;

    try {
      // Same tag + renotify: each re-check re-alerts (sound/flash) instead of
      // silently piling up a new toast per interval — annoying on purpose,
      // but capped at one visible notification at a time.
      activeNotification = new Notification("Учёт звонков — пора перезвонить", {
        body,
        tag: "call-tracker-due",
        renotify: true,
        requireInteraction: true,
      });
      activeNotification.onclick = () => {
        window.focus();
        if (onNotificationClick) onNotificationClick();
        if (activeNotification) activeNotification.close();
      };
      // If this fires, the browser accepted the call but the OS/its own
      // notification pipe rejected it silently (e.g. system notifications
      // disabled for the browser, Focus Assist) — the only such failure
      // this API surfaces to the page at all.
      activeNotification.onerror = () => console.error("Notification errored after being created — likely blocked at the OS/browser level, not by this app.");
      return "shown";
    } catch (err) {
      console.error(err);
      return "error";
    }
  }

  function restart() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    if (settings.enabled && permission() === "granted") {
      checkNow();
      timerId = setInterval(checkNow, Math.max(1, settings.intervalMinutes) * 60000);
    }
  }

  async function init(opts) {
    onNotificationClick = (opts && opts.onNotificationClick) || null;
    await loadSettings();
    restart();
  }

  return { init, loadSettings, saveSettings, requestPermission, permission, supported, checkNow, dueClients };
})();
