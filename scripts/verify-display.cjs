const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { _electron } = require("playwright");
async function poll(read, predicate, label, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Timed out: " + label);
}
(async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "vacuum-display-proof-"),
  );
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  const packaged = !!process.env.VACUUM_PACKAGED_EXE;
  const app = await _electron.launch({
    ...(packaged ? { executablePath: process.env.VACUUM_PACKAGED_EXE } : {}),
    args: packaged
      ? ["--test-mode"]
      : [path.resolve(__dirname, ".."), "--test-mode"],
    env: { ...process.env, VACUUM_TEST_ROOT: root },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await app.evaluate((_, root) => {
      const fs = process.getBuiltinModule("fs/promises"),
        path = process.getBuiltinModule("path"),
        nativeRead = fs.opendir;
      global.releaseDirectory = null;
      global.directoryHeld = false;
      global.restoreDirectory = () => {
        fs.opendir = nativeRead;
        global.releaseDirectory?.();
      };
      fs.opendir = async function (target, ...args) {
        if (target === path.join(root, "temp")) {
          global.directoryHeld = true;
          await new Promise((resolve) => (global.releaseDirectory = resolve));
        }
        return nativeRead.call(this, target, ...args);
      };
    }, root);
    await page.evaluate(() => window.vacuum.start());
    await poll(
      () => app.evaluate(() => global.directoryHeld),
      Boolean,
      "held native scan",
    );
    const companion = app.windows().find((w) => w.url().endsWith("#companion"));
    assert.ok(companion);
    await companion.locator(".taskbar-canvas").waitFor();
    await companion
      .locator(".taskbar-canvas")
      .evaluate((el) => (el.dataset.continuity = "retained"));
    const before = await app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith("#companion"),
        ).id,
    );
    const work = await app.evaluate(({ screen }) => {
      const primary = screen.getPrimaryDisplay();
      const bounds = {
        ...primary.bounds,
        width: Math.min(1050, primary.bounds.width),
        height: Math.min(700, primary.bounds.height),
      };
      const workArea = { ...bounds, height: bounds.height - 50 };
      const fake = { ...primary, bounds, workArea };
      const originalPrimary = screen.getPrimaryDisplay,
        originalMatching = screen.getDisplayMatching;
      global.restoreScreens = () => {
        screen.getPrimaryDisplay = originalPrimary;
        screen.getDisplayMatching = originalMatching;
      };
      screen.getPrimaryDisplay = () => fake;
      screen.getDisplayMatching = () => fake;
      screen.emit("display-metrics-changed", {}, fake, [
        "bounds",
        "workArea",
        "scaleFactor",
      ]);
      screen.emit("display-removed", {}, fake);
      screen.emit("display-added", {}, fake);
      return workArea;
    });
    const read = () => page.evaluate(() => window.vacuum.get());
    const state = await poll(
      read,
      (s) =>
        s.companionPlacement?.kind === "above-taskbar-fallback" &&
        s.companionPlacement.y >= work.y &&
        s.companionPlacement.y + s.companionPlacement.height <=
          work.y + work.height,
      "repositioned companion",
    );
    const native = await app.evaluate(({ BrowserWindow }) => ({
      main: BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().endsWith("#companion"))
        .getBounds(),
      companion: BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith("#companion"))
        .getBounds(),
      id: BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("#companion"),
      ).id,
    }));
    for (const rect of [native.main, native.companion])
      assert.ok(
        rect.x >= work.x &&
          rect.y >= work.y &&
          rect.x + rect.width <= work.x + work.width &&
          rect.y + rect.height <= work.y + work.height,
        JSON.stringify({ rect, work }),
      );
    assert.equal(native.id, before);
    assert.equal(
      await companion
        .locator(".taskbar-canvas")
        .getAttribute("data-continuity"),
      "retained",
    );
    const offset = await companion
      .locator(".taskbar-canvas")
      .getAttribute("data-offset");
    await companion.waitForFunction(
      (before) =>
        document.querySelector(".taskbar-canvas").dataset.offset !== before,
      offset,
    );
    await page.screenshot({ path: "test-results/display-compact.png" });
    await app.evaluate(({ screen }) => {
      global.restoreScreens();
      screen.emit("display-metrics-changed", {}, screen.getPrimaryDisplay(), [
        "workArea",
      ]);
    });
    await poll(
      read,
      (s) => s.companionPlacement?.kind === "taskbar-left-of-start",
      "original taskbar restored",
    );
    await app.evaluate(() => global.restoreDirectory());
    await poll(read, (s) => s.phase === "docked", "round finished");
    assert.deepEqual(errors, []);
    const report = {
      packaged,
      syntheticDisplayEvents: [
        "display-metrics-changed",
        "display-removed",
        "display-added",
      ],
      stationFitsReducedWorkArea: true,
      companionFitsReducedWorkArea: true,
      staleTaskbarRejected: true,
      sameCompanionWindowAndCanvas: true,
      motionContinues: true,
      realPrimaryPlacementRestored: true,
      physicalMonitorReconfigured: false,
      rendererErrors: errors.length,
      permanentlyDeletedFiles: 0,
    };
    await fs.writeFile(
      path.resolve(__dirname, "../test-results/display-proof.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app
      .evaluate(() => {
        global.restoreScreens?.();
        global.restoreDirectory?.();
      })
      .catch(() => {});
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
