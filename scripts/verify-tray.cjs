const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { _electron } = require("playwright");
async function poll(read, predicate, label) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((r) => setTimeout(r, 70));
  }
  throw Error("Timed out: " + label);
}
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vacuum-tray-proof-"));
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  const fixture = path.join(root, "temp", "retained-tray.tmp");
  await fs.writeFile(fixture, "Retained tray proof.");
  const old = new Date(Date.now() - 20 * 86400000);
  await fs.utimes(fixture, old, old);
  const packaged = !!process.env.VACUUM_PACKAGED_EXE;
  const app = await _electron.launch({
    ...(packaged ? { executablePath: process.env.VACUUM_PACKAGED_EXE } : {}),
    args: packaged
      ? ["--test-mode", "--background"]
      : [path.resolve(__dirname, ".."), "--test-mode", "--background"],
    env: { ...process.env, VACUUM_TEST_ROOT: root },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const read = () => page.evaluate(() => window.vacuum.get());
    await app.evaluate(({ Tray }) => {
      const native = Tray.prototype.setContextMenu;
      Tray.prototype.setContextMenu = function (menu) {
        global.fixtureTray = this;
        global.fixtureTrayMenu = menu;
        return native.call(this, menu);
      };
    });
    await page.evaluate(() => window.vacuum.settings({}));
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find(
            (w) =>
              !w.webContents.getURL().endsWith("#companion") &&
              !w.webContents.getURL().endsWith("#tray"),
          )
          .isVisible(),
      ),
      false,
    );
    const popupCreated = app.waitForEvent("window");
    await app.evaluate(() => global.fixtureTray.emit("click"));
    const popup = await popupCreated;
    await popup.locator(".tray-robot .robot-scene canvas").waitFor();
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith("#tray"))
          .isVisible(),
      ),
      true,
    );
    await popup.evaluate(() => window.vacuum.window("hide-tray"));
    async function click(id) {
      await app.evaluate((_, id) => {
        const item = global.fixtureTrayMenu.getMenuItemById(id);
        if (!item || !item.enabled) throw Error("Tray item unavailable: " + id);
        item.click(item);
      }, id);
    }
    await click("wet");
    await poll(read, (s) => s.settings.wet, "wet on");
    await click("wet");
    await poll(read, (s) => !s.settings.wet, "wet off");
    await click("auto");
    await poll(read, (s) => s.settings.auto, "daily on");
    await click("auto");
    await poll(read, (s) => !s.settings.auto, "daily off");
    await click("companion");
    await poll(read, (s) => !s.settings.companion, "companion off");
    await click("light");
    await poll(read, (s) => s.settings.theme === "light", "theme");
    await click("clean");
    await poll(read, (s) => s.phase !== "docked", "hidden scan starts");
    assert.equal(
      await app.evaluate(
        () => global.fixtureTrayMenu.getMenuItemById("wet").enabled,
      ),
      false,
    );
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find(
            (w) =>
              !w.webContents.getURL().endsWith("#companion") &&
              !w.webContents.getURL().endsWith("#tray"),
          )
          .isVisible(),
      ),
      false,
    );
    await poll(
      read,
      (s) => s.phase === "docked" && s.bin.count === 1,
      "hidden scan completes",
    );
    for (const [id, heading] of [
      ["bin", "Dust bin"],
      ["old", "Old Downloads"],
      ["performance", "Performance"],
      ["settings", "Settings"],
    ]) {
      await click(id);
      await page
        .getByRole("dialog")
        .getByRole("heading", { name: heading, exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Close panel", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
    }
    await page.evaluate(() => window.vacuum.window("minimize"));
    await click("station");
    await poll(
      () =>
        app.evaluate(({ BrowserWindow }) => {
          const w = BrowserWindow.getAllWindows().find(
            (w) =>
              !w.webContents.getURL().endsWith("#companion") &&
              !w.webContents.getURL().endsWith("#tray"),
          );
          return w.isVisible() && !w.isMinimized();
        }),
      Boolean,
      "restored station",
    );
    await page.evaluate(() => window.vacuum.window("close"));
    await click("clean");
    await poll(
      read,
      (s) => ["departing", "cleaning"].includes(s.phase),
      "second round",
    );
    await click("clean");
    await poll(read, (s) => s.phase === "docked", "tray recall");
    assert.equal(await fs.readFile(fixture, "utf8"), "Retained tray proof.");
    const saved = JSON.parse(
      await fs.readFile(
        path.join(root, "vacuum-test-profile", "settings.json"),
        "utf8",
      ),
    );
    assert.equal(saved.theme, "light");
    assert.equal(saved.auto, false);
    assert.equal(saved.wet, false);
    assert.equal(saved.companion, false);
    assert.deepEqual(errors, []);
    const report = {
      packaged,
      leftClickShows3DRobot: true,
      hiddenCleaningAndRecall: true,
      modeChangesPersist: true,
      binOldPerformanceAndSettingsRoutes: true,
      minimizedStationRestored: true,
      busyActionsDisabled: true,
      fixtureUnchanged: true,
      rendererErrors: errors.length,
      permanentlyDeletedFiles: 0,
    };
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await fs.writeFile(
      path.resolve(__dirname, "../test-results/tray-proof.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
