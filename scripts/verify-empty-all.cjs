const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict"),
  { createHash } = require("node:crypto");
const { _electron } = require("playwright");
async function poll(fn, ok, label, timeout = 180000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (ok(value)) return value;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw Error("Timed out: " + label);
}
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vacuum-empty-all-"));
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  async function file(relative, content = Buffer.alloc(2048, 41)) {
    const p = path.join(root, relative);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
    const age = new Date(Date.now() - 200 * 86400000);
    await fs.utimes(p, age, age);
    return p;
  }
  const fixtures = [];
  for (let i = 0; i < 120; i++)
    fixtures.push(await file(`temp/sample-${String(i).padStart(3, "0")}.tmp`));
  const original = await file(
    "downloads/Example/report.txt",
    "Original fixture contents.",
  );
  const copy = await file(
    "downloads/Example (1)/report.txt",
    "Original fixture contents.",
  );
  for (const dir of [path.dirname(original), path.dirname(copy)]) {
    const age = new Date(Date.now() - 200 * 86400000);
    await fs.utimes(dir, age, age);
  }
  const packaged = !!process.env.VACUUM_PACKAGED_EXE;
  const app = await _electron.launch({
    ...(packaged ? { executablePath: process.env.VACUUM_PACKAGED_EXE } : {}),
    args: packaged
      ? ["--test-mode"]
      : [path.resolve(__dirname, ".."), "--test-mode"],
    env: { ...process.env, VACUUM_TEST_ROOT: root },
  });
  try {
    const main = await app.firstWindow();
    await main.getByRole("button", { name: "Settings", exact: true }).waitFor();
    const errors = [];
    main.on("pageerror", (e) => errors.push(e.message));
    await main.evaluate(async () => {
      await window.vacuum.settings({ companion: false });
      await window.vacuum.start();
    });
    const read = () => main.evaluate(() => window.vacuum.get());
    await poll(
      read,
      (s) => s.phase === "docked" && s.bin.count === 121,
      "fixture collection",
    );
    await app.evaluate(({ Tray }) => {
      const set = Tray.prototype.setContextMenu;
      Tray.prototype.setContextMenu = function (menu) {
        global.fixtureTray = this;
        return set.call(this, menu);
      };
    });
    await main.evaluate(() => window.vacuum.settings({}));
    const opened = app.waitForEvent("window");
    await app.evaluate(() => global.fixtureTray.emit("click"));
    const popup = await opened;
    popup.on("pageerror", (e) => errors.push(e.message));
    await popup.locator(".hotspot-bin").waitFor({ state: "visible" });
    await popup.locator(".hotspot-bin").click();
    await popup
      .getByRole("button", { name: "Deselect all", exact: true })
      .click();
    await popup.getByRole("searchbox").fill("sample-000");
    assert.equal(await popup.locator(".file-row").count(), 1);
    const all = popup.getByRole("button", {
      name: "Empty entire bin · 121",
      exact: true,
    });
    await all.click();
    await popup
      .getByText("Send 121 collected items to Windows Recycle Bin?", {
        exact: true,
      })
      .waitFor();
    for (const p of fixtures) await fs.access(p);
    await fs.access(copy);
    await fs.writeFile(
      fixtures[119],
      "Changed after collection; retain this fixture.",
    );
    await popup
      .getByRole("button", { name: "Send to Recycle Bin", exact: true })
      .click();
    await popup.getByRole("progressbar").waitFor();
    await poll(
      read,
      (s) => s.phase === "docked" && s.lastEmpty?.trashed === 120,
      "whole tray batch",
    );
    const first = await read();
    assert.equal(first.bin.count, 1);
    assert.equal(first.bin.files[0].path, fixtures[119]);
    for (const p of fixtures.slice(0, 119))
      await assert.rejects(fs.access(p), { code: "ENOENT" });
    await assert.rejects(fs.access(path.dirname(copy)), { code: "ENOENT" });
    assert.equal(
      await fs.readFile(original, "utf8"),
      "Original fixture contents.",
    );
    await fs.access(fixtures[119]);
    await main.evaluate(() => window.vacuum.window("hide-tray"));
    await main.evaluate(async () => {
      const s = await window.vacuum.get();
      await window.vacuum.release(s.bin.files.map((f) => f.id));
    });
    const last = [];
    for (let i = 0; i < 3; i++) last.push(await file(`temp/final-${i}.tmp`));
    await main.evaluate(() => window.vacuum.start());
    await poll(
      read,
      (s) => s.phase === "docked" && s.bin.count === 3,
      "second collection",
    );
    await main.evaluate(() => window.vacuum.panel("bin"));
    await main.getByRole("dialog", { name: "Dust bin" }).waitFor();
    await main
      .getByRole("button", { name: "Deselect all", exact: true })
      .click();
    await main
      .getByRole("button", { name: "Empty entire bin · 3", exact: true })
      .click();
    await main
      .getByRole("button", { name: "Keep them here", exact: true })
      .click();
    for (const p of last) await fs.access(p);
    await main
      .getByRole("button", { name: "Empty entire bin · 3", exact: true })
      .click();
    await main
      .getByRole("button", { name: "Send to Recycle Bin", exact: true })
      .click();
    await poll(
      read,
      (s) => s.phase === "docked" && s.bin.count === 0,
      "whole station batch",
    );
    for (const p of last)
      await assert.rejects(fs.access(p), { code: "ENOENT" });
    assert.deepEqual(errors, []);
    const report = {
      packaged,
      trayBatchItems: 121,
      trayRecycled: 120,
      changedItemSkipped: 1,
      folderRecycledOriginalRetained: true,
      worksWithZeroSelectionAndActiveSearch: true,
      spansPagination: true,
      stationBatchItems: 3,
      stationBinEmpty: true,
      cancellationKeepsFiles: true,
      progressVisible: true,
      rendererErrors: 0,
      personalFilesPermanentlyDeleted: 0,
    };
    await fs.writeFile(
      "test-results/empty-all-proof.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
