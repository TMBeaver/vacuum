const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { _electron } = require("playwright");
async function poll(read, predicate, label) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    if (predicate(await read())) return;
    await new Promise((resolve) => setTimeout(resolve, 70));
  }
  throw Error("Timed out: " + label);
}
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vacuum-custom-tray-"));
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  const fixture = path.join(root, "temp", "retained-menu.tmp");
  await fs.writeFile(fixture, "Custom menu test. Keep this file.");
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
  let exited = false;
  try {
    const main = await app.firstWindow();
    await main.getByRole("button", { name: "Settings", exact: true }).waitFor();
    await app.evaluate(({ Tray }) => {
      const original = Tray.prototype.setContextMenu;
      Tray.prototype.setContextMenu = function (menu) {
        global.fixtureTray = this;
        global.fixtureNativeMenu = menu;
        return original.call(this, menu);
      };
    });
    await main.evaluate(() => window.vacuum.settings({}));
    assert.equal(await app.evaluate(() => global.fixtureNativeMenu), null);
    const created = app.waitForEvent("window");
    const openMenu = () =>
      app.evaluate(({ screen }) => {
        const work = screen.getPrimaryDisplay().workArea;
        global.fixtureTray.emit(
          "right-click",
          {},
          {
            x: work.x + work.width - 40,
            y: work.y + work.height,
            width: 24,
            height: 32,
          },
        );
      });
    await openMenu();
    const popup = await created;
    const errors = [];
    popup.on("pageerror", (error) => errors.push(error.message));
    const menu = popup.getByRole("region", {
      name: "Vacuum controls",
      exact: true,
    });
    await menu.waitFor();
    await popup.waitForFunction(() => innerWidth > 700);
    await popup.waitForFunction(
      () =>
        document.querySelector(".hotspot-power")?.getBoundingClientRect()
          .width > 0,
    );
    const read = () => popup.evaluate(() => window.vacuum.get());
    const mainVisible = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => !w.webContents.getURL().includes("#"))
          .isVisible(),
      );
    assert.equal(await mainVisible(), false);
    const layout = await popup.evaluate(() => {
      const robot = document
          .querySelector(".tray-robot-stage")
          .getBoundingClientRect(),
        menu = document.querySelector(".tray-menu").getBoundingClientRect(),
        quit = document
          .querySelector(".tray-menu-quit")
          .getBoundingClientRect();
      return {
        robotSeparate: robot.right <= menu.left,
        robotHeight: robot.height,
        quitVisible: quit.bottom <= innerHeight,
        noOuterScroll: document.documentElement.scrollHeight === innerHeight,
      };
    });
    assert.equal(layout.robotSeparate, true);
    assert.ok(layout.robotHeight > 300);
    assert.equal(layout.quitVisible, true);
    assert.equal(layout.noOuterScroll, true);
    await fs.mkdir(path.resolve("test-results"), { recursive: true });
    async function settleForScreenshot() {
      await popup.mouse.move(20, 20);
      await popup.waitForFunction(() =>
        document
          .getAnimations()
          .every((animation) => animation.playState === "finished"),
      );
    }
    await settleForScreenshot();
    await popup.screenshot({ path: "test-results/custom-tray-dark.png" });
    await popup.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    assert.equal(
      await popup
        .getByRole("button", { name: "Vacuum menu", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await popup.keyboard.press("Enter");
    await menu.waitFor();
    for (const name of [
      "Wet cleaning",
      "Daily autoclean",
      "Taskbar robot",
      "Start with Windows",
    ]) {
      const control = menu.getByRole("switch", { name, exact: true });
      const before = await control.getAttribute("aria-checked");
      await control.click();
      await poll(
        () => control.getAttribute("aria-checked"),
        (value) => value !== before,
        name + " toggled",
      );
      await control.click();
      await poll(
        () => control.getAttribute("aria-checked"),
        (value) => value === before,
        name + " restored",
      );
    }
    await menu.getByRole("button", { name: "Porcelain", exact: true }).click();
    await poll(read, (s) => s.settings.theme === "light", "light theme");
    await settleForScreenshot();
    await popup.screenshot({ path: "test-results/custom-tray-light.png" });
    await menu.getByRole("button", { name: "Graphite", exact: true }).click();
    await poll(read, (s) => s.settings.theme === "dark", "dark theme");
    await assert.rejects(
      popup.evaluate(() => window.vacuum.trayAction("unknown-action")),
    );
    await menu
      .getByRole("button", { name: "Start cleaning", exact: false })
      .click();
    await poll(
      read,
      (s) => ["departing", "cleaning"].includes(s.phase),
      "native cleaning",
    );
    assert.equal(
      await menu
        .getByRole("switch", { name: "Wet cleaning", exact: true })
        .isDisabled(),
      true,
    );
    await assert.rejects(popup.evaluate(() => window.vacuum.trayAction("wet")));
    await menu
      .getByRole("button", { name: "Return to dock", exact: false })
      .click();
    await poll(read, (s) => s.phase === "docked", "return to dock");
    await menu
      .getByRole("button", { name: "Start cleaning", exact: false })
      .click();
    await poll(
      read,
      (s) => s.phase === "docked" && s.bin.count === 1,
      "fixture collection",
    );
    await menu.getByRole("button", { name: /Dust bin/ }).click();
    await popup.getByRole("dialog", { name: "Dust bin" }).waitFor();
    assert.equal(await mainVisible(), false);
    await popup
      .getByRole("button", { name: "Back to robot", exact: true })
      .click();
    for (const [button, heading] of [
      ["Old Downloads", "Old Downloads"],
      ["Apps & ports", "Performance"],
      ["Settings", "Settings"],
    ]) {
      await openMenu();
      await menu.waitFor();
      await menu.getByRole("button", { name: button, exact: false }).click();
      await main
        .getByRole("dialog")
        .getByRole("heading", { name: heading, exact: true })
        .waitFor();
      await main
        .getByRole("button", { name: "Close panel", exact: true })
        .click();
      await main.getByRole("dialog").waitFor({ state: "detached" });
      await main.evaluate(() => window.vacuum.window("close"));
    }
    await openMenu();
    await menu.waitFor();
    await popup.evaluate(
      () => (document.querySelector(".tray-menu-body").scrollTop = 10000),
    );
    assert.equal(
      await menu
        .getByRole("button", { name: "Quit Vacuum", exact: true })
        .isVisible(),
      true,
    );
    await popup.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await menu.evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    const saved = JSON.parse(
      await fs.readFile(
        path.join(root, "vacuum-test-profile", "settings.json"),
        "utf8",
      ),
    );
    assert.equal(saved.theme, "dark");
    assert.equal(saved.wet, false);
    assert.equal(saved.auto, false);
    assert.equal(
      await fs.readFile(fixture, "utf8"),
      "Custom menu test. Keep this file.",
    );
    assert.deepEqual(errors, []);
    const exit = app.waitForEvent("close");
    await menu
      .getByRole("button", { name: "Quit Vacuum", exact: true })
      .click();
    await exit;
    exited = true;
    const report = {
      packaged,
      nativeRightClickOpensCustomPanel: true,
      noNativeMenu: true,
      fullRobotVisible: true,
      fixedFooter: true,
      switchesAndThemesPersist: true,
      startsAndRecallsNativeCleaner: true,
      binReviewInPopup: true,
      stationRoutes: true,
      disabledActionsValidatedInMain: true,
      escapeAndKeyboardReopen: true,
      reducedMotion: true,
      customQuitWorks: true,
      fixtureRetained: true,
      rendererErrors: errors.length,
    };
    await fs.writeFile(
      "test-results/custom-tray-proof.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (!exited) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
