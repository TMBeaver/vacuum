const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

function chooseLane(display, taskbar, start) {
  const work = display.workArea;
  if (
    taskbar &&
    start &&
    taskbar.width > taskbar.height * 3 &&
    start.x - taskbar.x >= 150
  ) {
    const height = Math.max(24, Math.min(42, taskbar.height - 4));
    const end = Math.floor(start.x - 12);
    const width = Math.min(280, end - taskbar.x - 100);
    if (width >= 120)
      return {
        x: end - width,
        y: Math.round(taskbar.y + (taskbar.height - height) / 2),
        width,
        height,
        kind: "taskbar-left-of-start",
      };
  }
  return {
    x: work.x + 12,
    y: work.y + work.height - 44,
    width: 260,
    height: 40,
    kind: "above-taskbar-fallback",
  };
}
async function inspectTaskbar(signal) {
  const script = await fs.readFile(
    path.join(__dirname, "taskbar-probe.ps1"),
    "utf8",
  );
  return new Promise((resolve) =>
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script,
      ],
      { windowsHide: true, timeout: 8000, maxBuffer: 16000, signal },
      (error, stdout) => {
        try {
          resolve(error ? null : JSON.parse(stdout.trim()));
        } catch {
          resolve(null);
        }
      },
    ),
  );
}
module.exports = { chooseLane, inspectTaskbar };
