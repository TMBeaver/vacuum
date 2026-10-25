const { _electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomBytes, createHash } = require("node:crypto");
const { execFile } = require("node:child_process");
const { sampleStorage } = require("../electron/storage.cjs");

async function recycleFixture(originalPath, action) {
  const script = await fs.readFile(
    path.join(__dirname, "recycle-fixture.ps1"),
    "utf8",
  );
  return new Promise((resolve, reject) => {
    const child = execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script,
      ],
      { windowsHide: true, timeout: 15000, maxBuffer: 16000 },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr || error.message));
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch (error) {
          reject(error);
        }
      },
    );
    child.stdin.end(JSON.stringify({ originalPath, action }));
  });
}
async function hash(filename) {
  return createHash("sha256")
    .update(await fs.readFile(filename))
    .digest("hex");
}
(async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "vacuum-storage-proof-"),
  );
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  const fixture = path.join(
    root,
    "temp",
    "vacuum-reversible-storage-proof.tmp",
  );
  await fs.writeFile(fixture, randomBytes(8 * 1024 * 1024));
  const age = new Date(Date.now() - 10 * 86400000);
  await fs.utimes(fixture, age, age);
  const originalHash = await hash(fixture),
    originalStat = await fs.stat(fixture),
    before = await sampleStorage(root);
  let app,
    restored = false;
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
    const recycled = await page.evaluate(async () => {
      const state = await window.vacuum.get();
      return window.vacuum.empty(state.bin.files.map((f) => f.id));
    });
    if (recycled.trashed !== 1)
      throw Error("The isolated fixture was not recycled.");
    const after = await sampleStorage(root),
      entry = await recycleFixture(fixture, "inspect"),
      recycledHash = await hash(entry.recycledPath),
      recycledStat = await fs.stat(entry.recycledPath);
    if (recycledHash !== originalHash)
      throw Error("Recycled fixture contents changed.");
    await recycleFixture(fixture, "restore");
    restored = (await hash(fixture)) === originalHash;
    if (!restored) throw Error("Restored fixture hash mismatch.");
    const afterRestore = await sampleStorage(root),
      state = await page.evaluate(() => window.vacuum.get());
    const report = {
      fixtureBytes: originalStat.size,
      recycledBytes: recycled.bytes,
      recycledFileBytes: recycledStat.size,
      sameVolumeFileIdentity: originalStat.ino === recycledStat.ino,
      originalHash,
      recycledHash,
      restoredHash: await hash(fixture),
      restored,
      permanentlyDeletedFiles: 0,
      driveFreeBefore: before.freeBytes,
      driveFreeAfterRecycle: after.freeBytes,
      driveFreeAfterRestore: afterRestore.freeBytes,
      observedDriveDelta: after.freeBytes - before.freeBytes,
      attributedFreedBytes: null,
      explanation: state.lastEmpty.storage.explanation,
      fixtureLocation: root,
    };
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await fs.writeFile(
      path.resolve(__dirname, "../test-results/storage-proof.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
    await page
      .getByRole("button", { name: "Open dust bin", exact: true })
      .click();
    await page.screenshot({ path: "test-results/storage-receipt.png" });
    await fs.utimes(fixture, new Date(), new Date());
  } finally {
    if (!restored) {
      try {
        await fs.access(fixture);
      } catch {
        try {
          await recycleFixture(fixture, "restore");
        } catch (error) {
          console.error(
            "Fixture remains recoverable in Recycle Bin:",
            error.message,
          );
        }
      }
    }
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
