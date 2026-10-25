function createTrayTemplate({
  state,
  settings,
  running,
  start,
  stop,
  open,
  change,
  quit,
}) {
  const idle = state.phase === "docked";
  const returning = state.phase === "returning";
  const panel = (name) => () => open(name);
  const toggle = (key) => (item) => change({ [key]: item.checked });
  return [
    {
      label: (state.message || "Ready to clean.")
        .replace(/[\r\n]+/g, " ")
        .slice(0, 100),
      enabled: false,
    },
    { type: "separator" },
    {
      id: "clean",
      label: returning
        ? "Returning to dock…"
        : running
          ? "Return to dock"
          : "Start cleaning",
      enabled: !state.startupError && (idle || (running && !returning)),
      click: () => (running ? stop() : start()),
    },
    {
      id: "bin",
      label: `Review / empty dust bin · ${state.bin.count} ${state.bin.count === 1 ? "file" : "files"}`,
      enabled: idle,
      click: panel("bin"),
    },
    {
      id: "old",
      label: "Review old Downloads…",
      enabled: idle && !state.startupError,
      click: panel("old"),
    },
    {
      id: "performance",
      label: "Apps and ports…",
      enabled: idle,
      click: panel("performance"),
    },
    { type: "separator" },
    {
      id: "wet",
      label: "Wet cleaning",
      type: "checkbox",
      checked: settings.wet,
      enabled: idle,
      click: toggle("wet"),
    },
    {
      id: "auto",
      label: `Daily autoclean · ${settings.hour}`,
      type: "checkbox",
      checked: settings.auto,
      click: toggle("auto"),
    },
    {
      id: "companion",
      label: "Show taskbar robot",
      type: "checkbox",
      checked: settings.companion,
      click: toggle("companion"),
    },
    {
      id: "startup",
      label: "Start with Windows",
      type: "checkbox",
      checked: settings.startup,
      enabled: state.startupRegistration?.available !== false,
      click: toggle("startup"),
    },
    {
      label: "Robot colour",
      submenu: [
        {
          id: "dark",
          label: "Graphite",
          type: "radio",
          checked: settings.theme === "dark",
          click: () => change({ theme: "dark" }),
        },
        {
          id: "light",
          label: "Porcelain",
          type: "radio",
          checked: settings.theme === "light",
          click: () => change({ theme: "light" }),
        },
      ],
    },
    { type: "separator" },
    { id: "station", label: "Open station", click: panel(null) },
    { id: "settings", label: "Settings…", click: panel("settings") },
    { id: "quit", label: "Quit Vacuum", click: quit },
  ];
}
module.exports = { createTrayTemplate };
