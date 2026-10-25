const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createCleaner } = require("../electron/cleaner.cjs");
const { compactFiles } = require("../electron/compression.cjs");
const hash = async (filename) =>
  createHash("sha256")
    .update(await fs.readFile(filename))
    .digest("hex");
const config = (root, adapter = compactFiles) => ({
  userData: path.join(root, "vacuum-test-profile"),
  tempRoot: path.join(root, "temp"),
  trashItem: async () => {
    throw Error("Recovery proof never recycles files");
  },
  compactFiles: adapter,
});
async function main() {
  if (process.argv[2] === "--interrupt") {
    const root = process.argv[3];
    const interrupted = async (entries, compress) => {
      const result = await compactFiles(entries, compress);
      assert.ok(result[0].ok && result[0].afterBytes < result[0].beforeBytes);
      process.exit(73); // Actual process termination before engine metadata commit.
    };
    interrupted.inspect = compactFiles.inspect;
    const engine = createCleaner(config(root, interrupted));
    const bin = await engine.scan();
    await engine.compactBin([bin.files[0].id]);
    throw Error("Interruption did not happen");
  }
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "vacuum-recovery-proof-"),
  );
  const filename = path.join(root, "temp", "interrupted-proof.log");
  await fs.mkdir(path.dirname(filename));
  await fs.writeFile(
    filename,
    Buffer.alloc(
      8 * 1024 * 1024,
      "Reversible interruption proof. Contents must stay intact.\n",
    ),
  );
  const age = new Date(Date.now() - 10 * 86400000);
  await fs.utimes(filename, age, age);
  const originalHash = await hash(filename);
  await new Promise((resolve, reject) =>
    execFile(
      process.execPath,
      [__filename, "--interrupt", root],
      { windowsHide: true, timeout: 120000 },
      (error, stdout, stderr) => {
        if (error?.code === 73) resolve();
        else
          reject(
            Error(
              `Unexpected interruption result: ${error?.message || "no interruption"} ${stdout} ${stderr}`,
            ),
          );
      },
    ),
  );
  const journal = JSON.parse(
    await fs.readFile(
      path.join(root, "vacuum-test-profile", "compression-journal.json"),
      "utf8",
    ),
  );
  assert.equal(journal.items.length, 1);
  const { _electron } = require("playwright");
  const app = await _electron.launch({
    ...(process.env.VACUUM_PACKAGED_EXE
      ? { executablePath: process.env.VACUUM_PACKAGED_EXE }
      : {}),
    args: process.env.VACUUM_PACKAGED_EXE
      ? ["--test-mode"]
      : [path.resolve(__dirname, ".."), "--test-mode"],
    env: { ...process.env, VACUUM_TEST_ROOT: root },
  });
  let recovery, compressed, restored, compressedHash, restoredHash;
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.vacuum);
    const state = await page.evaluate(() => window.vacuum.get());
    recovery = state.recovery;
    assert.equal(recovery.recovered, 1);
    assert.equal(recovery.needsReview, 0);
    assert.equal(state.bin.files[0].compacted, true);
    compressedHash = await hash(filename);
    assert.equal(compressedHash, originalHash);
    compressed = (await compactFiles.inspect(state.bin.files))[0];
    await page
      .getByRole("button", { name: "Open dust bin", exact: true })
      .click();
    await page
      .locator(".recovery-receipt")
      .getByText("Interrupted pass checked", { exact: true })
      .waitFor();
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await page.screenshot({
      path: "test-results/compression-recovered.png",
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Undo compression", exact: true })
      .click();
    await page
      .getByText("Compression undone", { exact: true })
      .waitFor({ timeout: 120000 });
    const after = await page.evaluate(() => window.vacuum.get());
    assert.equal(after.bin.files[0].compacted, false);
    restoredHash = await hash(filename);
    assert.equal(restoredHash, originalHash);
    restored = (await compactFiles.inspect(after.bin.files))[0];
    assert.equal(restored.compressed, false);
    assert.equal(restored.beforeBytes, journal.items[0].prepared.beforeBytes);
  } finally {
    await app.close();
  }
  const report = {
    actualChildExitCode: 73,
    packaged: !!process.env.VACUUM_PACKAGED_EXE,
    recovery,
    originalAllocation: journal.items[0].prepared.beforeBytes,
    compressedAllocation: compressed.beforeBytes,
    restoredAllocation: restored.beforeBytes,
    originalHash,
    compressedHash,
    restoredHash,
    undoVerified: true,
    permanentlyDeletedFiles: 0,
  };
  await fs.mkdir(path.resolve(__dirname, "../test-results"), {
    recursive: true,
  });
  await fs.writeFile(
    path.resolve(__dirname, "../test-results/compression-recovery-proof.json"),
    JSON.stringify(report, null, 2),
  );
  await fs.utimes(filename, new Date(), new Date());
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
