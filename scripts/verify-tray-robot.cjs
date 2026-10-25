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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vacuum-tray-robot-"));
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  const fixture = path.join(root, "temp", "retained-popup.tmp");
  await fs.writeFile(fixture, "Popup proof retained in Recycle Bin.");
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
    const main = await app.firstWindow();
    await main.getByRole("button", { name: "Settings", exact: true }).waitFor();
    assert.equal(await main.locator(".status-pill").count(), 0);
    await app.evaluate(({ Tray }) => {
      const native = Tray.prototype.setContextMenu;
      Tray.prototype.setContextMenu = function (menu) {
        global.fixtureTray = this;
        return native.call(this, menu);
      };
    });
    await main.evaluate(() => window.vacuum.settings({ companion: false }));
    const opened = app.waitForEvent("window");
    await app.evaluate(({ screen }) => {
      const work = screen.getPrimaryDisplay().workArea;
      global.fixtureTray.emit(
        "click",
        {},
        {
          x: work.x + work.width - 40,
          y: work.y + work.height,
          width: 24,
          height: 32,
        },
      );
    });
    const popup = await opened;
    await popup.locator(".tray-robot .robot-scene canvas").waitFor();
    await popup.locator(".hotspot-power").waitFor({ state: "visible" });
    await popup.waitForTimeout(800);
    const errors = [];
    popup.on("pageerror", (error) => errors.push(error.message));
    assert.equal(await popup.locator(".robot-hotspot").count(), 3);
    const geometry = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith("#tray"),
        ),
        b = w.getBounds(),
        work = screen.getDisplayMatching(b).workArea;
      return {
        b,
        work,
        mainVisible: BrowserWindow.getAllWindows()
          .find(
            (w) =>
              !w.webContents.getURL().endsWith("#tray") &&
              !w.webContents.getURL().endsWith("#companion"),
          )
          .isVisible(),
      };
    });
    assert.ok(geometry.b.width <= 440 && geometry.b.height <= 500);
    assert.ok(
      geometry.b.x >= geometry.work.x &&
        geometry.b.y >= geometry.work.y &&
        geometry.b.x + geometry.b.width <=
          geometry.work.x + geometry.work.width &&
        geometry.b.y + geometry.b.height <=
          geometry.work.y + geometry.work.height,
    );
    assert.equal(geometry.mainVisible, false);
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await popup.screenshot({ path: "test-results/tray-robot-dark.png" });
    await popup
      .locator(".canvas-mount canvas")
      .evaluate((el) => (el.dataset.continuity = "kept"));
    await popup.evaluate(() => window.vacuum.settings({ theme: "light" }));
    await popup.waitForFunction(
      () => document.documentElement.dataset.theme === "light",
    );
    await popup.waitForTimeout(500);
    assert.equal(
      await popup
        .locator(".canvas-mount canvas")
        .getAttribute("data-continuity"),
      "kept",
    );
    await popup.screenshot({ path: "test-results/tray-robot-light.png" });
    await popup.evaluate(() => window.vacuum.settings({ theme: "dark" }));
    const power = await popup.locator(".hotspot-power").boundingBox();
    await popup
      .locator(".hotspot-power")
      .evaluate((el) => (el.style.pointerEvents = "none"));
    await popup.mouse.click(
      power.x + power.width / 2,
      power.y + power.height / 2,
    );
    await popup
      .locator(".hotspot-power")
      .evaluate((el) => (el.style.pointerEvents = ""));
    const read = () => popup.evaluate(() => window.vacuum.get());
    await poll(
      read,
      (s) => s.phase === "docked" && s.bin.count === 1,
      "popup mesh starts actual scan",
    );
    await popup.locator(".hotspot-bin").click();
    await popup
      .getByRole("dialog", { name: "Dust bin", exact: true })
      .waitFor();
    await popup.getByText("retained-popup.tmp", { exact: true }).waitFor();
    await popup
      .getByRole("button", { name: "Empty selected · 1", exact: true })
      .click();
    await fs.access(fixture);
    await popup
      .getByRole("button", { name: "Send to Recycle Bin", exact: true })
      .click();
    await poll(
      read,
      (s) => s.phase === "docked" && s.bin.count === 0,
      "confirmed popup recycling",
    );
    await assert.rejects(fs.access(fixture), { code: "ENOENT" });
    assert.equal((await read()).lastEmpty.trashed, 1);
    await popup
      .getByRole("button", { name: "Back to robot", exact: true })
      .click();
    await popup.locator(".hotspot-power").click();
    await poll(
      read,
      (s) => ["departing", "cleaning"].includes(s.phase),
      "recall round starts",
    );
    const home = await popup.locator(".hotspot-dock").boundingBox();
    await popup.mouse.click(home.x + home.width / 2, home.y + home.height / 2);
    await poll(read, (s) => s.phase === "docked", "popup home recalls");
    assert.equal((await read()).coverage.cancelled, true);
    await popup
      .getByRole("button", { name: "Hide robot", exact: true })
      .click();
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith("#tray"))
          .isVisible(),
      ),
      false,
    );
    assert.deepEqual(errors, []);
    const report = {
      packaged,
      nativeCompactPopup: true,
      boundsFitWorkArea: true,
      threePhysicalControls: true,
      bothThemesKeepSameCanvas: true,
      powerMeshStartsRealScan: true,
      homeRecalls: true,
      binReviewedAndConfirmedInPopup: true,
      unconfirmedFileUnchanged: true,
      fixtureSentToRecycleBin: true,
      mainStationStayedHidden: true,
      cleaningBadgeRemoved: true,
      rendererErrors: 0,
      permanentlyDeletedFiles: 0,
    };
    await fs.writeFile(
      path.resolve(__dirname, "../test-results/tray-robot-proof.json"),
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
