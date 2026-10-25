const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  shell,
  screen,
  powerMonitor,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { createCleaner } = require("./cleaner.cjs");
const { isDue } = require("./schedule.cjs");
const { classifyScanResult } = require("./defender.cjs");
const { chooseLane, inspectTaskbar } = require("./taskbar.cjs");
const { sampleStorage, describeStorageChange } = require("./storage.cjs");
const { compactFiles } = require("./compression.cjs");
let quitAfterOperation = false;
let taskbarGeometry = null;

let main,
  companion,
  tray,
  cleaner,
  controller,
  timer,
  dockTimer,
  quitting = false;
let settings = {
  theme: "dark",
  wet: false,
  auto: false,
  hour: "10:00",
  companion: true,
  startup: false,
};
let state = {
  phase: "docked",
  message: "Ready for a fresh start.",
  bin: { files: [], count: 0, bytes: 0 },
  lastRun: null,
  wetResult: null,
  coverage: null,
};
const testMode =
  process.argv.includes("--smoke-test") || process.argv.includes("--test-mode");
const fixtureRoot =
  testMode && process.env.VACUUM_TEST_ROOT
    ? path.resolve(process.env.VACUUM_TEST_ROOT)
    : null;
const userData = testMode
  ? path.join(fixtureRoot || os.tmpdir(), "vacuum-test-profile")
  : app.getPath("userData");
if (testMode) app.setPath("userData", userData);
const configPath = path.join(userData, "settings.json");
const historyPath = path.join(userData, "history.json");
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
const file = (name) => path.join(__dirname, "..", "dist", name);
const send = () => {
  for (const w of [main, companion])
    if (w && !w.isDestroyed())
      w.webContents.send("vacuum:state", { ...state, settings });
  updateTray();
};
let configWrite = Promise.resolve();
function saveSettings() {
  const snapshot = JSON.stringify(settings);
  const next = configWrite.then(async () => {
    await fs.mkdir(userData, { recursive: true });
    const pending = `${configPath}.tmp`;
    await fs.writeFile(pending, snapshot, { mode: 0o600 });
    await fs.rename(pending, configPath);
  });
  configWrite = next.catch(() => {});
  return next;
}
async function saveHistory() {
  await fs.writeFile(
    historyPath,
    JSON.stringify({
      lastRun: state.lastRun,
      wetResult: state.wetResult,
      lastEmpty: state.lastEmpty,
      lastCompaction: state.lastCompaction,
    }),
  );
}
function showMain() {
  main?.show();
  main?.focus();
}
function icon() {
  const size = 32,
    pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 16, y - 16),
        i = (y * size + x) * 4;
      const rim = d > 11;
      pixels[i] = rim ? 160 : 225;
      pixels[i + 1] = rim ? 171 : 230;
      pixels[i + 2] = rim ? 160 : 221;
      pixels[i + 3] = d < 14 ? 255 : 0;
      if (Math.hypot(x - 16, y - 11) < 4) {
        pixels[i] = 65;
        pixels[i + 1] = 76;
        pixels[i + 2] = 63;
      }
    }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}
function updateTray() {
  if (!tray) return;
  tray.setToolTip(
    `Vacuum · ${state.phase === "docked" ? "At the station" : state.message}`,
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open station", click: showMain },
      {
        label: controller ? "Return to dock" : "Start cleaning",
        click: () => (controller ? controller.abort() : startClean()),
      },
      { label: `Dust bin · ${state.bin.count} files`, click: showMain },
      { type: "separator" },
      {
        label: "Daily autoclean",
        type: "checkbox",
        checked: settings.auto,
        click: async (item) => {
          settings.auto = item.checked;
          await saveSettings();
          send();
        },
      },
      {
        label: "Quit Vacuum",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}
function showCompanion() {
  if (!settings.companion) return;
  const display = screen.getPrimaryDisplay();
  const taskbar = taskbarGeometry?.taskbar
    ? screen.screenToDipRect(null, taskbarGeometry.taskbar)
    : null;
  const start = taskbarGeometry?.start
    ? screen.screenToDipRect(null, taskbarGeometry.start)
    : null;
  const placement = chooseLane(display, taskbar, start);
  state.companionPlacement = placement;
  if (!companion) {
    companion = new BrowserWindow({
      width: placement.width,
      height: placement.height,
      x: placement.x,
      y: placement.y,
      transparent: true,
      frame: false,
      thickFrame: false,
      hasShadow: false,
      roundedCorners: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    companion.setAlwaysOnTop(true, "screen-saver");
    companion.setIgnoreMouseEvents(true, { forward: true });
    companion.loadFile(file("index.html"), { hash: "companion" });
    companion.webContents.on("did-finish-load", () => {
      if (controller) {
        companion.showInactive();
        fitCompanion(placement);
      }
      send();
    });
    companion.on("closed", () => {
      companion = null;
    });
    secure(companion);
  } else {
    companion.showInactive();
    fitCompanion(placement);
  }
}
function fitCompanion(placement) {
  let width = placement.width,
    height = placement.height;
  // Windows may add fractional-DPI nonclient pixels to a newly shown popup.
  // Measure the real native rectangle and shrink until it fits the intended lane.
  for (let attempt = 0; attempt < 4; attempt++) {
    companion.setBounds({ x: placement.x, y: placement.y, width, height });
    const actual = companion.getBounds();
    const extraWidth = Math.max(0, actual.width - placement.width),
      extraHeight = Math.max(0, actual.height - placement.height);
    if (!extraWidth && !extraHeight) {
      state.companionPlacement = { ...placement, ...actual };
      return;
    }
    width = Math.max(1, width - extraWidth);
    height = Math.max(1, height - extraHeight);
  }
  state.companionPlacement = { ...placement, ...companion.getBounds() };
}
function secure(w) {
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  w.webContents.session.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
}
function execResult(executable, args, signal) {
  return new Promise((resolve) => {
    let output = "",
      settled = false;
    const child = spawn(executable, args, { windowsHide: true, signal });
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    child.stdout.on("data", (d) => {
      output = (output + d.toString()).slice(-12000);
    });
    child.stderr.on("data", (d) => {
      output = (output + d.toString()).slice(-12000);
    });
    child.on("error", (e) => finish({ code: null, output: e.message }));
    child.on("close", (code) => finish({ code, output }));
  });
}
async function wetScan(signal) {
  let exe = path.join(
    process.env.ProgramFiles || "C:\\Program Files",
    "Windows Defender",
    "MpCmdRun.exe",
  );
  const platform = path.join(
    process.env.ProgramData || "C:\\ProgramData",
    "Microsoft",
    "Windows Defender",
    "Platform",
  );
  try {
    const versions = (await fs.readdir(platform)).sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    );
    for (const v of versions) {
      const p = path.join(platform, v, "MpCmdRun.exe");
      try {
        await fs.access(p);
        exe = p;
        break;
      } catch {}
    }
  } catch {}
  try {
    await fs.access(exe);
  } catch {
    return {
      status: "unavailable",
      message:
        "Microsoft Defender is unavailable. Open Windows Security to check your antivirus provider.",
    };
  }
  const targets = fixtureRoot
    ? [path.join(fixtureRoot, "temp"), path.join(fixtureRoot, "downloads")]
    : [os.tmpdir(), app.getPath("downloads")];
  for (const target of targets) {
    if (signal.aborted)
      return {
        status: "cancelled",
        message: "Wet scan stopped. Protection was not verified.",
      };
    state.message = `Wet cleaning · scanning ${target === targets[0] ? "temporary files" : "Downloads"}`;
    send();
    const result = await execResult(
      exe,
      ["-Scan", "-ScanType", "3", "-File", target, "-DisableRemediation"],
      signal,
    );
    if (signal.aborted)
      return {
        status: "cancelled",
        message: "Wet scan stopped. Protection was not verified.",
      };
    const verdict = classifyScanResult(result);
    if (verdict.status !== "clear") return verdict;
  }
  return {
    status: "clear",
    message:
      "Defender completed scans of temporary files and Downloads without a reported threat. Other folders were not scanned.",
    time: new Date().toISOString(),
  };
}
async function startClean() {
  if (controller || state.phase !== "docked" || state.startupError) return;
  clearTimeout(dockTimer);
  controller = new AbortController();
  const active = controller;
  state.phase = "departing";
  state.message = "Leaving the dock. Preparing a real file scan.";
  state.progress = { visited: 0, found: 0, bytes: 0 };
  state.coverage = null;
  state.roundError = null;
  send();
  try {
    if (settings.companion) {
      taskbarGeometry = await inspectTaskbar(active.signal);
      if (!active.signal.aborted) showCompanion();
    }
    await new Promise((resolve) => {
      if (active.signal.aborted) return resolve();
      const stopped = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        active.signal.removeEventListener("abort", stopped);
        resolve();
      }, 1100);
      active.signal.addEventListener("abort", stopped, { once: true });
    });
    state.phase = "cleaning";
    state.message = "Looking for forgotten temporary files.";
    send();
    const result = await cleaner.scan({ signal: active.signal });
    state.bin = await cleaner.getBin();
    state.coverage = result.coverage;
    state.progress = {
      visited: result.coverage.visited,
      found: result.found ?? result.added,
      bytes: result.bytes,
    };
    if (settings.wet && !active.signal.aborted) {
      state.phase = "wet";
      state.wetResult = null;
      send();
      state.wetResult = await wetScan(active.signal);
    }
    state.lastRun = new Date().toISOString();
    await saveHistory();
    state.message = active.signal.aborted
      ? "Back at the dock. Collected files are still in the bin."
      : `Back at the dock. ${state.bin.count ? "Your bin is ready to review." : "Nothing disposable found this time."}`;
  } catch (e) {
    state.roundError = `Cleaning stopped: ${e.message}`;
    state.message = state.roundError;
  } finally {
    const roundCancelled = active.signal.aborted;
    state.phase = "returning";
    state.message =
      "Returning to the station. Your collected files are waiting in the bin.";
    send();
    await new Promise((resolve) => setTimeout(resolve, 1800));
    controller = null;
    state.phase = "docked";
    state.message =
      state.roundError ||
      (roundCancelled || state.coverage?.cancelled
        ? "Round stopped. Back at the dock."
        : state.bin.count
          ? `${state.bin.count} ${state.bin.count === 1 ? "file" : "files"} collected. Open the dust bin to recycle ${state.bin.count === 1 ? "it" : "them"}.`
          : "Back at the dock. No eligible leftovers found.");
    send();
    if (companion) {
      companion.webContents.send("vacuum:dock");
      dockTimer = setTimeout(() => companion?.hide(), 350);
    }
  }
}
async function scheduleTick() {
  if (controller || state.phase !== "docked") return;
  if (
    isDue({
      enabled: settings.auto,
      hour: settings.hour,
      lastRun: state.lastRun,
    })
  )
    await startClean();
}
app.whenReady().then(async () => {
  try {
    const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
    if (["dark", "light"].includes(saved.theme)) settings.theme = saved.theme;
    for (const key of ["wet", "auto", "companion", "startup"])
      if (typeof saved[key] === "boolean") settings[key] = saved[key];
    if (
      typeof saved.hour === "string" &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(saved.hour)
    )
      settings.hour = saved.hour;
  } catch {}
  try {
    state = { ...state, ...JSON.parse(await fs.readFile(historyPath, "utf8")) };
  } catch {}
  cleaner = createCleaner({
    userData,
    tempRoot: fixtureRoot ? path.join(fixtureRoot, "temp") : os.tmpdir(),
    localAppData: fixtureRoot
      ? path.join(fixtureRoot, "local")
      : process.env.LOCALAPPDATA,
    downloadsRoot: fixtureRoot
      ? path.join(fixtureRoot, "downloads")
      : app.getPath("downloads"),
    trashItem: (p) => shell.trashItem(p),
    compactFiles,
    onProgress: (p) => {
      state.progress = p;
      state.message = `Sweeping ${p.category === "crash-dumps" ? "crash dumps" : "temporary files"} · ${p.visited.toLocaleString()} checked · ${p.found.toLocaleString()} found`;
      for (const window of [main, companion])
        if (window && !window.isDestroyed())
          window.webContents.send("vacuum:progress", {
            progress: p,
            message: state.message,
          });
    },
  });
  try {
    state.bin = await cleaner.getBin();
  } catch (e) {
    state.message = e.message;
    state.startupError = e.message;
  }
  state.storage = await sampleStorage(fixtureRoot || os.tmpdir());
  const workArea = screen.getPrimaryDisplay().workArea;
  main = new BrowserWindow({
    width: Math.min(1140, workArea.width - 24),
    height: Math.min(820, workArea.height - 24),
    minWidth: Math.min(900, workArea.width - 24),
    minHeight: Math.min(680, workArea.height - 24),
    frame: false,
    backgroundColor: settings.theme === "dark" ? "#202320" : "#efeee9",
    show: false,
    icon: icon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  secure(main);
  main.loadFile(file("index.html"));
  main.once("ready-to-show", () => {
    if (!process.argv.includes("--background")) main.show();
  });
  main.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      main.hide();
    }
  });
  tray = new Tray(icon());
  tray.on("double-click", showMain);
  tray.on("click", showMain);
  updateTray();
  ipcMain.handle("vacuum:get", () => ({ ...state, settings }));
  ipcMain.handle("vacuum:start", () => {
    startClean();
    return true;
  });
  ipcMain.handle("vacuum:stop", () => {
    controller?.abort();
    return true;
  });
  ipcMain.handle("vacuum:settings", async (_e, patch) => {
    if (
      typeof patch.theme === "string" &&
      ["dark", "light"].includes(patch.theme)
    )
      settings.theme = patch.theme;
    for (const key of ["wet", "auto", "companion", "startup"])
      if (typeof patch[key] === "boolean") settings[key] = patch[key];
    if (
      typeof patch.hour === "string" &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.hour)
    )
      settings.hour = patch.hour;
    if (Object.hasOwn(patch, "startup") && !testMode)
      app.setLoginItemSettings({
        openAtLogin: settings.startup,
        path: process.execPath,
        args: app.isPackaged
          ? ["--background"]
          : [app.getAppPath(), "--background"],
      });
    await saveSettings();
    if (Object.hasOwn(patch, "companion")) {
      if (!settings.companion) companion?.hide();
      else if (controller) showCompanion();
    }
    send();
    return settings;
  });
  const ids = (value) => {
    if (
      !Array.isArray(value) ||
      value.length > 50000 ||
      value.some((i) => typeof i !== "string")
    )
      throw new Error("Invalid file selection");
    return value;
  };
  ipcMain.handle("vacuum:empty", async (_e, selection) => {
    if (controller || state.phase !== "docked")
      throw new Error("Return to dock before emptying.");
    state.phase = "emptying";
    const emptyStarted = Date.now();
    send();
    try {
      const storageBefore = await sampleStorage(fixtureRoot || os.tmpdir());
      const result = await cleaner.emptyBin(ids(selection));
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, 900 - (Date.now() - emptyStarted))),
      );
      state.bin = await cleaner.getBin();
      state.storage = await sampleStorage(fixtureRoot || os.tmpdir());
      state.lastEmpty = {
        trashed: result.trashed,
        bytes: result.bytes,
        time: new Date().toISOString(),
        storage: describeStorageChange(
          storageBefore,
          state.storage,
          result.bytes,
        ),
      };
      await saveHistory();
      state.message = `${result.trashed} ${result.trashed === 1 ? "file" : "files"} sent to Recycle Bin.${result.skipped.length ? " Changed or inaccessible files were skipped." : ""}`;
      return result;
    } finally {
      state.phase = "docked";
      send();
    }
  });
  ipcMain.handle("vacuum:release", async (_e, selection) => {
    if (controller || state.phase !== "docked")
      throw new Error("Return to dock first.");
    await cleaner.release(ids(selection));
    state.bin = await cleaner.getBin();
    send();
    return state.bin;
  });
  ipcMain.handle("vacuum:compact", async (_e, selection, compress = true) => {
    if (controller || state.phase !== "docked")
      throw Error("Return to the dock before a reversible space-saving pass.");
    if (typeof compress !== "boolean")
      throw Error("Invalid compression action.");
    state.phase = "compacting";
    state.message = compress
      ? "Packing selected leftovers without removing their contents."
      : "Restoring original file allocation.";
    send();
    try {
      const before = await sampleStorage(fixtureRoot || os.tmpdir());
      const result = await cleaner.compactBin(ids(selection), compress);
      state.bin = await cleaner.getBin();
      state.storage = await sampleStorage(fixtureRoot || os.tmpdir());
      state.lastCompaction = {
        ...result,
        bin: undefined,
        compress,
        time: new Date().toISOString(),
        storage: { before, after: state.storage },
      };
      await saveHistory();
      state.message = !result.verifiedFiles
        ? "No files changed. Review any reported errors."
        : compress
          ? `${result.bytesSaved.toLocaleString()} bytes of file allocation saved; ${result.verifiedFiles} ${result.verifiedFiles === 1 ? "file" : "files"} verified.`
          : `Compression undone for ${result.changed} files. ${result.verifiedFiles} ${result.verifiedFiles === 1 ? "file" : "files"} verified.`;
      return result;
    } finally {
      state.phase = "docked";
      send();
      if (quitAfterOperation) app.quit();
    }
  });
  ipcMain.handle("vacuum:old", () => cleaner.reviewOldFiles());
  ipcMain.handle("vacuum:collect", async (_e, selection) => {
    if (controller || state.phase !== "docked")
      throw new Error("Return to dock first.");
    const result = await cleaner.collectOldFiles(ids(selection));
    state.bin = await cleaner.getBin();
    send();
    return result;
  });
  ipcMain.handle("vacuum:security", () =>
    shell.openExternal("windowsdefender://threat"),
  );
  ipcMain.handle("vacuum:storage", async () => {
    state.storage = await sampleStorage(fixtureRoot || os.tmpdir());
    send();
    return state.storage;
  });
  ipcMain.handle(
    "vacuum:recycle-bin",
    () =>
      new Promise((resolve, reject) => {
        const child = spawn("explorer.exe", ["shell:RecycleBinFolder"], {
          windowsHide: true,
        });
        child.once("spawn", () => resolve(true));
        child.once("error", reject);
      }),
  );
  ipcMain.handle("vacuum:window", (_e, action) => {
    if (action === "minimize") main.minimize();
    if (action === "close") main.hide();
    if (action === "show") showMain();
  });
  timer = setInterval(scheduleTick, 30000);
  powerMonitor.on("resume", scheduleTick);
  scheduleTick();
  if (process.argv.includes("--smoke-test")) {
    setTimeout(async () => {
      await fs.mkdir(path.join(app.getAppPath(), "test-results"), {
        recursive: true,
      });
      await main.webContents
        .capturePage()
        .then((i) =>
          fs.writeFile(
            path.join(app.getAppPath(), "test-results", "desktop.png"),
            i.toPNG(),
          ),
        );
      quitting = true;
      app.quit();
    }, 6500);
  }
});
app.on("second-instance", showMain);
app.on("before-quit", (event) => {
  if (state.phase === "compacting") {
    event.preventDefault();
    quitAfterOperation = true;
    state.message = "Finishing the reversible file pass before quitting.";
    send();
    return;
  }
  quitting = true;
  controller?.abort();
  cleaner?.close();
  clearInterval(timer);
});
app.on("window-all-closed", () => {});
