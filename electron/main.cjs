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
const { chooseLane, inspectTaskbar, fitWindow } = require("./taskbar.cjs");
const { sampleStorage, describeStorageChange } = require("./storage.cjs");
const { compactFiles } = require("./compression.cjs");
const { createBrowserGuard } = require("./browser-cache.cjs");
const { createPerformance } = require("./performance.cjs");
const { createStartup, STARTUP_NAME } = require("./startup.cjs");
const { createTrayTemplate } = require("./tray-menu.cjs");
const { trayPopupBounds } = require("./tray-popup.cjs");
let performanceReview;
let startupService;
if (process.platform === "win32") app.setAppUserModelId(STARTUP_NAME);
let quitAfterOperation = false;
let taskbarGeometry = null;
let layoutTimer, layoutProbe;

let main,
  trayPopup,
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
  message: "Ready to clean.",
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
  for (const w of [main, companion, trayPopup])
    if (w && !w.isDestroyed())
      w.webContents.send("vacuum:state", { ...state, settings });
  updateTray();
};
async function refreshStartup() {
  if (testMode || !startupService) return;
  try {
    const status = await startupService.read();
    settings.startup = status.enabled;
    state.startupRegistration = {
      available: true,
      registered: status.registered,
      enabled: status.enabled,
    };
  } catch {
    state.startupRegistration = { available: false };
  }
}
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
  if (main?.isMinimized()) main.restore();
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
let panelRequestId = 0;
function openFromTray(panel) {
  trayPopup?.hide();
  state.panelRequest = { id: ++panelRequestId, panel };
  showMain();
  send();
}
let trayBlurAt = 0;
let trayExpanded = false;
let trayAnchor;
function resizeTrayRobot() {
  if (!trayPopup || trayPopup.isDestroyed()) return;
  const anchor = trayAnchor || tray.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: Math.round(anchor.x),
    y: Math.round(anchor.y),
  });
  trayPopup.setBounds(trayPopupBounds(anchor, display.workArea, trayExpanded));
}
function toggleTrayRobot(bounds) {
  if (trayPopup?.isVisible() || Date.now() - trayBlurAt < 180) {
    trayPopup?.hide();
    return;
  }
  const show = () => {
    trayAnchor = bounds?.width ? bounds : tray.getBounds();
    resizeTrayRobot();
    trayPopup.show();
    trayPopup.focus();
    send();
  };
  if (!trayPopup) {
    trayPopup = new BrowserWindow({
      width: 440,
      height: 500,
      show: false,
      frame: false,
      resizable: false,
      thickFrame: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: settings.theme === "dark" ? "#202320" : "#efeee9",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    secure(trayPopup);
    trayPopup.loadFile(file("index.html"), { hash: "tray" });
    trayPopup.once("ready-to-show", show);
    trayPopup.on("blur", () => {
      trayBlurAt = Date.now();
      trayPopup?.hide();
    });
    trayPopup.on("close", (event) => {
      if (!quitting) {
        event.preventDefault();
        trayPopup.hide();
      }
    });
    trayPopup.on("closed", () => {
      trayPopup = null;
    });
  } else show();
}
function changeFromTray(patch) {
  return applySettings(patch).catch((error) => {
    state.message = `Settings could not be saved: ${error.message}`;
    openFromTray("settings");
  });
}
function updateTray() {
  if (!tray) return;
  tray.setToolTip(
    `Vacuum · ${state.phase === "docked" ? "At the station" : state.message}`,
  );
  tray.setContextMenu(
    Menu.buildFromTemplate(
      createTrayTemplate({
        state,
        settings,
        running: !!controller,
        start: startClean,
        stop: () => controller?.abort(),
        open: openFromTray,
        change: changeFromTray,
        quit: () => {
          quitting = true;
          app.quit();
        },
      }),
    ),
  );
}
let settingsUpdate = Promise.resolve();
function applySettings(patch) {
  const next = settingsUpdate.then(async () => {
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      throw Error("Choose valid settings.");
    const previous = { ...settings };
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
    try {
      if (typeof patch.startup === "boolean" && !testMode) {
        await startupService.set(patch.startup);
        await refreshStartup();
      }
      await saveSettings();
    } catch (error) {
      settings = previous;
      await refreshStartup();
      send();
      throw error;
    }
    if (Object.hasOwn(patch, "companion")) {
      if (!settings.companion) companion?.hide();
      else if (controller) await placeCompanion(controller.signal);
    }
    if (Object.hasOwn(patch, "theme"))
      trayPopup?.setBackgroundColor(
        settings.theme === "dark" ? "#202320" : "#efeee9",
      );
    send();
    return settings;
  });
  settingsUpdate = next.catch(() => {});
  return next;
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
        fitCompanion(state.companionPlacement || placement);
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
async function placeCompanion(signal) {
  layoutProbe?.abort();
  const probe = new AbortController();
  layoutProbe = probe;
  const cancel = () => probe.abort();
  if (signal?.aborted) return;
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const geometry = await inspectTaskbar(probe.signal);
    if (probe.signal.aborted || quitting || !controller || !settings.companion)
      return;
    taskbarGeometry = geometry;
    showCompanion();
    send();
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
function layoutChanged() {
  trayPopup?.hide();
  clearTimeout(layoutTimer);
  layoutProbe?.abort();
  taskbarGeometry = null;
  companion?.hide();
  layoutTimer = setTimeout(async () => {
    if (quitting) return;
    if (main && !main.isDestroyed()) {
      const work = screen.getDisplayMatching(main.getBounds()).workArea;
      main.setMinimumSize(
        Math.min(900, Math.max(1, work.width - 24)),
        Math.min(680, Math.max(1, work.height - 24)),
      );
      if (!main.isMaximized() && !main.isFullScreen())
        main.setBounds(fitWindow(main.getBounds(), work));
    }
    if (controller && settings.companion)
      await placeCompanion(controller.signal);
  }, 150);
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
      await placeCompanion(active.signal);
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
    state.recovery = await cleaner.getRecovery();
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
          : "Back at the dock. No eligible files found.");
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
  startupService = createStartup({ app });
  performanceReview = createPerformance({
    protectPids: () => [
      process.pid,
      process.ppid,
      ...app.getAppMetrics().map((metric) => metric.pid),
    ],
  });
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
  await refreshStartup();
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
    assertBrowserClosed: createBrowserGuard(),
    onEmptyProgress: (() => {
      let last = 0,
        pending;
      const emit = () => {
        clearTimeout(pending);
        pending = null;
        last = Date.now();
        for (const window of [main, companion, trayPopup])
          if (window && !window.isDestroyed())
            window.webContents.send("vacuum:progress", {
              emptyProgress: state.emptyProgress,
            });
      };
      return (progress) => {
        state.emptyProgress = progress;
        const remaining = 100 - (Date.now() - last);
        if (
          progress.processed === 0 ||
          progress.processed === progress.total ||
          remaining <= 0
        )
          emit();
        else if (!pending) pending = setTimeout(emit, remaining);
      };
    })(),
    onProgress: (p) => {
      state.progress = p;
      state.message = `Scanning ${p.category === "crash-dumps" ? "crash dumps" : p.category === "browser-cache" ? "browser caches" : "temporary files"} · ${p.visited.toLocaleString()} checked · ${p.found.toLocaleString()} found`;
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
    state.recovery = await cleaner.getRecovery();
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
  main.on("focus", async () => {
    await refreshStartup();
    send();
  });
  tray = new Tray(icon());
  tray.on("double-click", showMain);
  tray.on("click", (_event, bounds) => toggleTrayRobot(bounds));
  updateTray();
  ipcMain.handle("vacuum:get", async () => {
    await refreshStartup();
    return { ...state, settings };
  });
  ipcMain.handle("vacuum:start", () => {
    startClean();
    return true;
  });
  ipcMain.handle("vacuum:stop", () => {
    controller?.abort();
    return true;
  });
  ipcMain.handle("vacuum:settings", (_e, patch) => applySettings(patch));
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
    const selectionIds = ids(selection);
    state.emptyProgress = {
      processed: 0,
      total: new Set(selectionIds).size,
      recycled: 0,
      skipped: 0,
      bytes: 0,
    };
    state.phase = "emptying";
    const emptyStarted = Date.now();
    send();
    try {
      const storageBefore = await sampleStorage(fixtureRoot || os.tmpdir());
      const result = await cleaner.emptyBin(selectionIds);
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
      state.message = `${result.trashed} ${result.trashed === 1 ? "file" : "files"} sent to Recycle Bin.${result.skipped.length ? " Skipped files remain in the bin; review their reasons." : ""}`;
      return result;
    } finally {
      state.phase = "docked";
      try {
        state.recovery = await cleaner.getRecovery();
      } finally {
        send();
        if (quitAfterOperation) app.quit();
      }
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
      ? "Compressing selected files. File contents stay in place."
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
          ? `${result.verifiedFiles} ${result.verifiedFiles === 1 ? "file" : "files"} verified. Open the bin to see space saved.`
          : `Compression undone for ${result.changed} files. ${result.verifiedFiles} ${result.verifiedFiles === 1 ? "file" : "files"} verified.`;
      return result;
    } finally {
      state.phase = "docked";
      try {
        state.bin = await cleaner.getBin();
        state.recovery = await cleaner.getRecovery();
      } finally {
        send();
        if (quitAfterOperation) app.quit();
      }
    }
  });
  ipcMain.handle("vacuum:old", () => cleaner.reviewOldFiles());
  ipcMain.handle("vacuum:performance", () => performanceReview.review());
  ipcMain.handle("vacuum:performance-action", async (_e, id, mode) => {
    if (controller || state.phase !== "docked")
      throw Error("Return to the dock before closing apps.");
    state.phase = "optimizing";
    state.message = "Applying the selected app action.";
    send();
    try {
      return await performanceReview.act(id, mode);
    } finally {
      state.phase = "docked";
      state.message =
        "Performance review complete. Refresh to check current usage.";
      send();
      if (quitAfterOperation) app.quit();
    }
  });
  ipcMain.handle("vacuum:recover-compression", async () => {
    if (controller || state.phase !== "docked")
      throw Error("Return to the dock before verifying an interrupted pass.");
    state.phase = "compacting";
    state.message =
      "Verifying the interrupted pass without changing file contents.";
    send();
    try {
      const result = await cleaner.recoverCompaction();
      state.bin = await cleaner.getBin();
      state.recovery = result.recovery;
      return result;
    } finally {
      state.phase = "docked";
      send();
      if (quitAfterOperation) app.quit();
    }
  });
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
    if (action === "hide-tray") trayPopup?.hide();
    if (action === "minimize") main.minimize();
    if (action === "close") main.hide();
    if (action === "show") showMain();
  });
  ipcMain.handle("vacuum:tray-view", (_e, expanded) => {
    if (typeof expanded !== "boolean") throw Error("Invalid tray view.");
    trayExpanded = expanded;
    resizeTrayRobot();
  });
  ipcMain.handle("vacuum:panel", (_e, name) => {
    if (![null, "bin", "settings", "old", "performance"].includes(name))
      throw Error("Unknown station view.");
    openFromTray(name);
  });
  timer = setInterval(scheduleTick, 30000);
  powerMonitor.on("resume", scheduleTick);
  for (const event of [
    "display-added",
    "display-removed",
    "display-metrics-changed",
  ])
    screen.on(event, layoutChanged);
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
  if (["emptying", "compacting", "optimizing"].includes(state.phase)) {
    event.preventDefault();
    quitAfterOperation = true;
    state.message = "Finishing the current action before quitting.";
    send();
    return;
  }
  quitting = true;
  clearTimeout(layoutTimer);
  layoutProbe?.abort();
  controller?.abort();
  cleaner?.close();
  clearInterval(timer);
});
app.on("window-all-closed", () => {});
