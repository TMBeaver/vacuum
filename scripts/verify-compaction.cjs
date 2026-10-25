const { _electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const digest = async (filename) =>
  createHash("sha256")
    .update(await fs.readFile(filename))
    .digest("hex");
(async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "vacuum-compaction-proof-"),
  );
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  const filename = path.join(root, "temp", "vacuum-compression-proof.log");
  await fs.writeFile(
    filename,
    Buffer.alloc(
      8 * 1024 * 1024,
      "Vacuum reversible storage proof. All original contents must remain intact.\n",
    ),
  );
  const age = new Date(Date.now() - 10 * 86400000);
  await fs.utimes(filename, age, age);
  const originalHash = await digest(filename);
  let app,
    undoVerified = false;
  try {
    app = await _electron.launch({
      args: [path.resolve(__dirname, ".."), "--test-mode"],
      env: { ...process.env, VACUUM_TEST_ROOT: root },
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.vacuum);
    await page.evaluate(() => window.vacuum.settings({ companion: false }));
    await page.evaluate(() => window.vacuum.start());
    await page.waitForFunction(() =>
      document
        .querySelector(".bin-copy em")
        ?.textContent.includes("1 file collected"),
    );
    await page.waitForFunction(
      () => document.querySelector(".robot-scene").dataset.motion === "docked",
    );
    await page
      .getByRole("button", { name: "Open dust bin", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save space reversibly", exact: true })
      .click();
    await page.locator(".compaction-receipt").waitFor({ timeout: 120000 });
    const state = await page.evaluate(() => window.vacuum.get());
    const compression = state.lastCompaction;
    if (!compression.bytesSaved) throw Error(JSON.stringify(compression));
    const compressedHash = await digest(filename);
    if (compressedHash !== originalHash)
      throw Error("Compression changed the fixture contents.");
    await page.screenshot({ path: "test-results/compaction-savings.png" });
    await page
      .getByRole("button", { name: "Undo compression", exact: true })
      .click();
    await page
      .getByText("Compression undone", { exact: true })
      .waitFor({ timeout: 120000 });
    const restoredHash = await digest(filename),
      after = await page.evaluate(() => window.vacuum.get());
    undoVerified =
      restoredHash === originalHash && !after.bin.files[0].compacted;
    if (!undoVerified)
      throw Error("The original uncompressed state was not restored.");
    const extraNames = ["incompressible-proof.tmp", "įrašas ' [saugus].log"];
    const { randomBytes } = require("node:crypto");
    for (const [name, data] of [
      [extraNames[0], randomBytes(2 * 1024 * 1024)],
      [extraNames[1], Buffer.alloc(1024 * 1024, "Unicode path safety proof. ")],
    ]) {
      const file = path.join(root, "temp", name);
      await fs.writeFile(file, data);
      await fs.utimes(file, age, age);
    }
    await page
      .getByRole("button", { name: "Close panel", exact: true })
      .click();
    await page.evaluate(() => window.vacuum.start());
    await page.waitForFunction(() =>
      document
        .querySelector(".bin-copy em")
        ?.textContent.includes("3 files collected"),
    );
    await page.waitForFunction(
      () => document.querySelector(".robot-scene").dataset.motion === "docked",
    );
    const extraResults = {};
    for (const name of extraNames) {
      const beforeHash = await digest(path.join(root, "temp", name));
      const result = await page.evaluate(async (name) => {
        const s = await window.vacuum.get();
        return window.vacuum.compact(
          [s.bin.files.find((f) => f.name === name).id],
          true,
        );
      }, name);
      if (result.skipped.length) throw Error(JSON.stringify(result));
      const afterHash = await digest(path.join(root, "temp", name));
      if (beforeHash !== afterHash)
        throw Error("Additional fixture content mismatch");
      extraResults[name] = {
        bytesSaved: result.bytesSaved,
        verified: beforeHash === afterHash,
        compacted: result.bin.files.find((f) => f.name === name).compacted,
      };
    }
    if (
      extraResults[extraNames[0]].bytesSaved !== 0 ||
      extraResults[extraNames[0]].compacted
    )
      throw Error("Incompressible data must keep its original state.");
    await page.evaluate(async () => {
      const s = await window.vacuum.get();
      return window.vacuum.compact(
        s.bin.files.filter((f) => f.compacted).map((f) => f.id),
        false,
      );
    });
    for (const name of extraNames)
      await fs.utimes(path.join(root, "temp", name), new Date(), new Date());
    const report = {
      extraResults,
      fixtureBytes: (await fs.stat(filename)).size,
      bytesSaved: compression.bytesSaved,
      compressedAllocation: compression.files[0].afterBytes,
      originalAllocation: compression.files[0].beforeBytes,
      originalHash,
      compressedHash,
      restoredHash,
      undoVerified,
      compressedStorageSamples: compression.storage,
      uncompressedResult: after.lastCompaction,
      permanentlyDeletedFiles: 0,
    };
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await fs.writeFile(
      path.resolve(__dirname, "../test-results/compaction-proof.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
    await fs.utimes(filename, new Date(), new Date());
  } finally {
    if (app && !undoVerified) {
      try {
        await app.firstWindow().then((p) =>
          p.evaluate(async () => {
            const s = await window.vacuum.get();
            const ids = s.bin.files.filter((f) => f.compacted).map((f) => f.id);
            if (ids.length) await window.vacuum.compact(ids, false);
          }),
        );
      } catch (error) {
        console.error(
          "Fixture retained; compression can be undone through Windows Properties:",
          error.message,
        );
      }
    }
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
