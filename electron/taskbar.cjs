const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

function chooseLane(display, taskbar, start) {
  const work = display.workArea;
  if (
    taskbar &&
    start &&
    (!display.bounds ||
      (taskbar.x >= display.bounds.x &&
        taskbar.y >= display.bounds.y &&
        taskbar.x + taskbar.width <= display.bounds.x + display.bounds.width &&
        taskbar.y + taskbar.height <=
          display.bounds.y + display.bounds.height)) &&
    start.x >= taskbar.x &&
    start.y >= taskbar.y &&
    start.x + start.width <= taskbar.x + taskbar.width &&
    start.y + start.height <= taskbar.y + taskbar.height &&
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
function fitWindow(bounds, work) {
  const width = Math.min(bounds.width, Math.max(1, work.width - 24));
  const height = Math.min(bounds.height, Math.max(1, work.height - 24));
  const left = work.x + Math.min(12, Math.max(0, work.width - width));
  const top = work.y + Math.min(12, Math.max(0, work.height - height));
  return {
    x: Math.round(
      Math.max(
        left,
        Math.min(
          bounds.x,
          work.x + work.width - width - Math.min(12, work.width - width),
        ),
      ),
    ),
    y: Math.round(
      Math.max(
        top,
        Math.min(
          bounds.y,
          work.y + work.height - height - Math.min(12, work.height - height),
        ),
      ),
    ),
    width: Math.round(width),
    height: Math.round(height),
  };
}
module.exports = { chooseLane, inspectTaskbar, fitWindow };
