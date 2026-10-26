const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { _electron } = require("playwright");
const { createCleaner } = require("../electron/cleaner.cjs");
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vacuum-bin-layout-")),
    profile = path.join(root, "vacuum-test-profile"),
    temp = path.join(root, "temp");
  for (const folder of [
    temp,
    profile,
    path.join(root, "downloads"),
    path.join(root, "local", "CrashDumps"),
  ])
    await fs.mkdir(folder, { recursive: true });
  const owned = [];
  for (let index = 0; index < 3; index++) {
    const file = path.join(temp, `owned-${index}.tmp`);
    await fs.writeFile(file, "Retained native progress fixture " + index);
    const age = new Date(Date.now() - 20 * 86400000);
    await fs.utimes(file, age, age);
    owned.push(file);
  }
  const engine = createCleaner({
    userData: profile,
    tempRoot: temp,
    localAppData: path.join(root, "local"),
    downloadsRoot: path.join(root, "downloads"),
    trashItem: async () => {
      throw Error("Preparation must not recycle");
    },
  });
  await engine.scan();
  engine.close();
  const manifest = JSON.parse(
    await fs.readFile(path.join(profile, "bin.json"), "utf8"),
  );
  const cache = path.join(
    root,
    "local",
    "Google",
    "Chrome",
    "User Data",
    "Default",
    "Cache",
    "Cache_Data",
  );
  await fs.mkdir(cache, { recursive: true });
  const age = Date.now() - 20 * 86400000;
  for (let index = 3; index < 8551; index++)
    manifest.files.push({
      id: `cache-${index}`,
      path: path.join(cache, `cache-data-${index}`),
      root: cache,
      category: "browser-cache",
      size: 6 * 1024 * 1024,
      mtimeMs: age,
      ctimeMs: age,
      birthtimeMs: age,
      ino: String(index + 1),
      dev: "1",
    });
  await fs.writeFile(path.join(profile, "bin.json"), JSON.stringify(manifest));
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
    await app.evaluate(({ Tray }) => {
      const native = Tray.prototype.setContextMenu;
      Tray.prototype.setContextMenu = function (menu) {
        global.fixtureTray = this;
        return native.call(this, menu);
      };
    });
    await main.evaluate(() => window.vacuum.settings({}));
    const created = app.waitForEvent("window");
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
    const popup = await created;
    await popup.locator(".hotspot-bin").waitFor({ state: "visible" });
    await popup.locator(".hotspot-bin").click();
    const read = () => popup.evaluate(() => window.vacuum.get());
    assert.equal((await read()).bin.count, 8551);
    await poll(
      () => popup.evaluate(() => innerWidth),
      (w) => w > 700,
      "expanded bin window",
    );
    await popup
      .getByRole("button", { name: "Empty selected · 8551", exact: true })
      .waitFor();
    async function layout() {
      return popup.evaluate(() => {
        const root = document.querySelector(".tray-robot"),
          stage = document
            .querySelector(".tray-robot-stage")
            .getBoundingClientRect(),
          scene = document
            .querySelector(".robot-scene")
            .getBoundingClientRect(),
          panel = document.querySelector(".tray-bin"),
          p = panel.getBoundingClientRect(),
          actions = document
            .querySelector(".tray-bin-actions")
            .getBoundingClientRect(),
          button = document
            .querySelector(".tray-bin-actions button")
            .getBoundingClientRect(),
          list = document.querySelector(".tray-bin .file-list");
        return {
          sideBySide: stage.right <= p.left + 1,
          sceneInStage:
            scene.left >= stage.left - 1 &&
            scene.right <= stage.right + 1 &&
            scene.top >= stage.top - 1 &&
            scene.bottom <= stage.bottom + 1,
          actionsVisible: button.top >= 0 && button.bottom <= innerHeight,
          outerDoesNotScroll:
            root.scrollHeight <= root.clientHeight + 1 &&
            panel.scrollHeight <= panel.clientHeight + 1,
          listCanScroll: list.scrollHeight > list.clientHeight,
          sceneWidth: scene.width,
          sceneHeight: scene.height,
        };
      });
    }
    let geometry = await layout();
    assert.ok(
      geometry.sideBySide &&
        geometry.sceneInStage &&
        geometry.actionsVisible &&
        geometry.outerDoesNotScroll &&
        geometry.listCanScroll,
      JSON.stringify(geometry),
    );
    for (let i = 0; i < 25; i++)
      await popup.getByRole("button", { name: "Next", exact: true }).click();
    await popup
      .locator(".tray-bin .file-list")
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    geometry = await layout();
    assert.ok(
      geometry.actionsVisible && geometry.outerDoesNotScroll,
      JSON.stringify(geometry),
    );
    await popup.screenshot({ path: "test-results/tray-bin-large.png" });
    await popup
      .getByRole("button", { name: "Deselect all", exact: true })
      .click();
    for (let i = 0; i < 25; i++)
      await popup
        .getByRole("button", { name: "Previous", exact: true })
        .click();
    for (let index = 0; index < 3; index++)
      await popup
        .getByRole("checkbox", {
          name: `Select owned-${index}.tmp`,
          exact: true,
        })
        .check();
    await fs.writeFile(owned[2], "Updated file must be skipped and kept");
    await app.evaluate(({ shell }, owned) => {
      const native = shell.trashItem;
      global.trashEntered = 0;
      global.releaseTrash = null;
      shell.trashItem = async (target) => {
        if (!owned.includes(target)) throw Error("Unexpected fixture path");
        global.trashEntered++;
        await new Promise((r) => (global.releaseTrash = r));
        return native(target);
      };
    }, owned);
    await popup
      .getByRole("button", { name: "Empty selected · 3", exact: true })
      .click();
    await popup
      .getByRole("button", { name: "Send to Recycle Bin", exact: true })
      .click();
    await poll(
      () => app.evaluate(() => global.trashEntered),
      (n) => n === 1,
      "first held recycle",
    );
    await app.evaluate(() => global.releaseTrash());
    await poll(
      () => app.evaluate(() => global.trashEntered),
      (n) => n === 2,
      "second held recycle",
    );
    await popup
      .getByRole("progressbar", { name: "Recycling selected files" })
      .waitFor();
    await popup.waitForFunction(
      () =>
        document
          .querySelector('[role="progressbar"]')
          .getAttribute("aria-valuenow") === "1",
    );
    assert.equal(
      await popup.getByRole("progressbar").getAttribute("aria-valuemax"),
      "3",
    );
    assert.ok((await layout()).actionsVisible);
    assert.equal(
      await popup
        .getByRole("checkbox", { name: "Select owned-0.tmp", exact: true })
        .isDisabled(),
      true,
    );
    await popup.screenshot({ path: "test-results/tray-bin-progress.png" });
    await app.evaluate(() => global.releaseTrash());
    const completed = await poll(
      read,
      (s) => s.phase === "docked" && s.lastEmpty?.trashed === 2,
      "emptying settles",
    );
    assert.deepEqual(
      {
        processed: completed.emptyProgress.processed,
        total: completed.emptyProgress.total,
        recycled: completed.emptyProgress.recycled,
        skipped: completed.emptyProgress.skipped,
      },
      { processed: 3, total: 3, recycled: 2, skipped: 1 },
    );
    assert.equal(
      await fs.readFile(owned[2], "utf8"),
      "Updated file must be skipped and kept",
    );
    await popup.evaluate(() => window.vacuum.panel("settings"));
    await main
      .getByRole("dialog")
      .getByRole("heading", { name: "Settings", exact: true })
      .waitFor();
    await main.waitForTimeout(400);
    for (const [panel, heading] of [
      ["settings", "Settings"],
      ["bin", "Dust bin"],
      ["old", "Old Downloads"],
      ["performance", "Performance"],
    ]) {
      await main.evaluate((panel) => window.vacuum.panel(panel), panel);
      await main
        .getByRole("dialog")
        .getByRole("heading", { name: heading, exact: true })
        .waitFor();
      await main.waitForTimeout(400);
      const fits = await main.evaluate(() => {
        const scene = document
            .querySelector(".robot-stage .robot-scene")
            .getBoundingClientRect(),
          panel = document.querySelector(".sheet").getBoundingClientRect();
        return scene.left >= 0 && scene.right <= panel.left + 2;
      });
      assert.equal(
        fits,
        true,
        "Full model viewport must remain beside each station panel",
      );
    }
    await main.screenshot({
      path: "test-results/station-bin-side-by-side.png",
    });
    const report = {
      packaged,
      references: 8551,
      sideBySideRobotAndBin: true,
      robotViewportNeverCovered: true,
      pinnedActionsAfter25PagesAndScroll: true,
      onlyFileListScrolls: true,
      realProgressObserved: { processed: 1, total: 3 },
      finalProgress: { processed: 3, total: 3, recycled: 2, skipped: 1 },
      changedFixturePreserved: true,
      stationSettingsBinDownloadsAndPerformanceKeepRobotVisible: true,
      personalFilesPermanentlyDeleted: 0,
    };
    await fs.writeFile(
      "test-results/bin-layout-progress-proof.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.evaluate(() => global.releaseTrash?.()).catch(() => {});
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
