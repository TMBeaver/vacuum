const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { _electron } = require("playwright");
const digest = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
async function poll(read, predicate, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw Error("Timed out: " + label);
}
(async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "vacuum-lifecycle-proof-"),
  );
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  const file = path.join(root, "temp", "retained-lifecycle.tmp");
  await fs.writeFile(
    file,
    Buffer.alloc(8 * 1024 * 1024, "Retained lifecycle contents. "),
  );
  const old = new Date(Date.now() - 20 * 86400000);
  await fs.utimes(file, old, old);
  const originalHash = await digest(file);
  const packaged = !!process.env.VACUUM_PACKAGED_EXE;
  const launch = () =>
    _electron.launch({
      ...(packaged ? { executablePath: process.env.VACUUM_PACKAGED_EXE } : {}),
      args: packaged
        ? ["--test-mode"]
        : [path.resolve(__dirname, ".."), "--test-mode"],
      env: { ...process.env, VACUUM_TEST_ROOT: root },
    });
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
      false,
    );
    await page.evaluate(() => window.vacuum.window("show"));
    await poll(
      () =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isVisible(),
        ),
      Boolean,
      "tray station reopen",
    );
    await page.evaluate(async () => {
      await window.vacuum.settings({ companion: false });
      await window.vacuum.start();
    });
    const read = () => page.evaluate(() => window.vacuum.get());
    const state = await poll(
      read,
      (s) => s.phase === "docked" && s.bin.count === 1,
      "fixture scan",
    );
    await app.evaluate(({ shell }, file) => {
      global.releaseTrash = null;
      global.trashEntered = false;
      shell.trashItem = async (target) => {
        if (target !== file) throw Error("Unexpected fixture path");
        global.trashEntered = true;
        await new Promise((resolve) => (global.releaseTrash = resolve));
        throw Error("Synthetic recycle refusal");
      };
    }, file);
    await page.evaluate((id) => {
      window.fixtureEmpty = window.vacuum.empty([id]).catch(() => null);
    }, state.bin.files[0].id);
    await poll(
      () => app.evaluate(() => global.trashEntered),
      Boolean,
      "held recycle",
    );
    await app.evaluate(({ app }) => {
      app.quit();
    });
    assert.equal(
      (await read()).phase,
      "emptying",
      "Quit must defer until the recycle request settles",
    );
    assert.match((await read()).message, /Finishing/);
    const closed = app.waitForEvent("close", { timeout: 30000 });
    await app.evaluate(() => global.releaseTrash());
    await closed;
    app = null;
    assert.equal(await digest(file), originalHash);
    let history = JSON.parse(
      await fs.readFile(
        path.join(root, "vacuum-test-profile", "history.json"),
        "utf8",
      ),
    );
    assert.equal(history.lastEmpty.trashed, 0);
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    let current = await page.evaluate(() => window.vacuum.get());
    assert.equal(current.bin.count, 1);
    assert.ok(!current.startupError);
    // Hold the real native adapter's read-only preparation, then let the full
    // compression/verification/metadata commit finish after Quit was requested.
    await app.evaluate(({ app }) => {
      const load = process
        .getBuiltinModule("module")
        .createRequire(app.getAppPath() + "/package.json");
      const adapter = load("./electron/compression.cjs").compactFiles,
        nativeInspect = adapter.inspect;
      global.inspectEntered = false;
      global.releaseInspect = null;
      adapter.inspect = async (entries) => {
        global.inspectEntered = true;
        await new Promise((resolve) => (global.releaseInspect = resolve));
        return nativeInspect(entries);
      };
    });
    await page.evaluate((id) => {
      window.fixtureCompact = window.vacuum
        .compact([id], true)
        .catch(() => null);
    }, current.bin.files[0].id);
    await poll(
      () => app.evaluate(() => global.inspectEntered),
      Boolean,
      "held compression preparation",
    );
    await app.evaluate(({ app }) => app.quit());
    assert.equal(
      (await page.evaluate(() => window.vacuum.get())).phase,
      "compacting",
    );
    const compactClosed = app.waitForEvent("close", { timeout: 120000 });
    await app.evaluate(() => global.releaseInspect());
    await compactClosed;
    app = null;
    assert.equal(await digest(file), originalHash);
    history = JSON.parse(
      await fs.readFile(
        path.join(root, "vacuum-test-profile", "history.json"),
        "utf8",
      ),
    );
    assert.equal(history.lastCompaction.verifiedFiles, 1);
    assert.ok(history.lastCompaction.bytesSaved > 0);
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Open dust bin", exact: true })
      .waitFor();
    current = await page.evaluate(() => window.vacuum.get());
    assert.equal(current.bin.files[0].compacted, true);
    await page
      .getByRole("button", { name: "Open dust bin", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Undo compression", exact: true })
      .click();
    await page
      .getByText("Compression undone", { exact: true })
      .waitFor({ timeout: 120000 });
    assert.equal(await digest(file), originalHash);
    const report = {
      packaged,
      stationCloseHidesToTray: true,
      stationCanReopen: true,
      quitDeferredDuringRecycleRefusal: true,
      refusedFileRetainedAcrossRestart: true,
      quitDeferredThroughNativeCompressionCommit: true,
      undoAfterGracefulQuit: true,
      contentsPreserved: true,
      permanentlyDeletedFiles: 0,
    };
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await fs.writeFile(
      path.resolve(__dirname, "../test-results/lifecycle-proof.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (app) {
      await app
        .evaluate(() => {
          global.releaseTrash?.();
          global.releaseInspect?.();
        })
        .catch(() => {});
      await app.close().catch(() => {});
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
