const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { _electron } = require("playwright");
const { compactFiles } = require("../electron/compression.cjs");
const digest = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vacuum-edited-undo-"));
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  const file = path.join(root, "temp", "edited-undo-proof.log");
  await fs.writeFile(
    file,
    Buffer.alloc(
      8 * 1024 * 1024,
      "Original synthetic contents. Keep all later edits.\n",
    ),
  );
  const age = new Date(Date.now() - 10 * 86400000);
  await fs.utimes(file, age, age);
  const originalHash = await digest(file);
  const launch = () =>
    _electron.launch({
      ...(process.env.VACUUM_PACKAGED_EXE
        ? { executablePath: process.env.VACUUM_PACKAGED_EXE }
        : {}),
      args: process.env.VACUUM_PACKAGED_EXE
        ? ["--test-mode"]
        : [path.resolve(__dirname, ".."), "--test-mode"],
      env: { ...process.env, VACUUM_TEST_ROOT: root },
    });
  let app = await launch();
  let state, id;
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.vacuum);
    await page.evaluate(() => window.vacuum.settings({ companion: false }));
    await page.evaluate(() => window.vacuum.start());
    const deadline = Date.now() + 30000;
    do {
      state = await page.evaluate(() => window.vacuum.get());
      if (state.phase === "docked" && state.lastRun) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.equal(state.bin.count, 1);
    assert.equal(state.phase, "docked");
    id = state.bin.files[0].id;
    const compressed = await page.evaluate(
      (id) => window.vacuum.compact([id], true),
      id,
    );
    assert.ok(compressed.bytesSaved > 0);
  } finally {
    await app.close();
  }
  // An ordinary external write, with no artificial age reset and no old-content restore.
  await fs.appendFile(
    file,
    Buffer.alloc(
      64 * 1024,
      "New content added after compression. Preserve this edit.\n",
    ),
  );
  const editedHash = await digest(file);
  assert.notEqual(editedHash, originalHash);
  const metadata = await fs.stat(file);
  const before = (
    await compactFiles.inspect([
      { id, path: file, size: metadata.size, mtimeMs: metadata.mtimeMs },
    ])
  )[0];
  assert.equal(before.compressed, true);
  app = await launch();
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Open dust bin", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Undo compression", exact: true })
      .click();
    await page
      .getByText("Compression undone", { exact: true })
      .waitFor({ timeout: 120000 });
    state = await page.evaluate(() => window.vacuum.get());
    assert.equal(state.bin.files[0].compacted, false);
    assert.match(state.bin.files[0].reason, /Recently updated/);
    assert.equal(await digest(file), editedHash);
    const after = (await compactFiles.inspect(state.bin.files))[0];
    assert.equal(after.compressed, false);
    const blockedRecycle = await page.evaluate(
      (id) => window.vacuum.empty([id]),
      id,
    );
    assert.equal(blockedRecycle.trashed, 0);
    assert.match(blockedRecycle.skipped[0].reason, /cleaning rule/);
    assert.equal(await digest(file), editedHash);
    const report = {
      packaged: !!process.env.VACUUM_PACKAGED_EXE,
      logicalBytes: metadata.size,
      compressedAllocationBeforeUndo: before.beforeBytes,
      allocationAfterUndo: after.beforeBytes,
      editsPreserved: true,
      undoAcrossRestart: true,
      recentFileRecyclingBlocked: true,
      originalHash,
      editedHash,
      restoredHash: await digest(file),
      permanentlyDeletedFiles: 0,
    };
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await fs.writeFile(
      path.resolve(__dirname, "../test-results/edited-undo-proof.json"),
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
