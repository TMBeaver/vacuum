const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict"),
  { createHash } = require("node:crypto");
const { _electron } = require("playwright");
const hash = async (p) =>
  createHash("sha256")
    .update(await fs.readFile(p))
    .digest("hex");
async function poll(fn, accept, label) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    const value = await fn();
    if (accept(value)) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Timed out: " + label);
}
(async () => {
  const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "vacuum-native-duplicates-"),
    ),
    downloads = path.join(root, "downloads");
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  async function folder(name, age = 200, different = false) {
    const target = path.join(downloads, name);
    await fs.mkdir(path.join(target, "nested"), { recursive: true });
    await fs.writeFile(
      path.join(target, "readme.txt"),
      different ? "Unique edits" : "Keep the original intact.",
    );
    await fs.writeFile(
      path.join(target, "nested", "data.bin"),
      Buffer.alloc(65536, 71),
    );
    const stamp = new Date(Date.now() - age * 86400000);
    for (const p of ["readme.txt", "nested/data.bin", "nested", ""])
      await fs.utimes(path.join(target, p), stamp, stamp);
    return target;
  }
  const original = await folder("Įrašai"),
    copy1 = await folder("Įrašai (1)"),
    copy2 = await folder("Įrašai (2)");
  await folder("Įrašai (3)", 200, true);
  await folder("Įrašai (4)", 1);
  await folder("Orphan (1)");
  const originalHash = await hash(path.join(original, "nested", "data.bin"));
  const packaged = !!process.env.VACUUM_PACKAGED_EXE;
  const app = await _electron.launch({
    ...(packaged ? { executablePath: process.env.VACUUM_PACKAGED_EXE } : {}),
    args: packaged
      ? ["--test-mode"]
      : [path.resolve(__dirname, ".."), "--test-mode"],
    env: { ...process.env, VACUUM_TEST_ROOT: root },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluate(async () => {
      await window.vacuum.settings({ companion: false });
      await window.vacuum.start();
    });
    const read = () => page.evaluate(() => window.vacuum.get());
    const state = await poll(
      read,
      (s) => s.phase === "docked" && !!s.coverage,
      "duplicate round",
    );
    assert.deepEqual(state.bin.files.map((x) => x.name).sort(), [
      "Įrašai (1)",
      "Įrašai (2)",
    ]);
    assert.ok(
      state.bin.files.every(
        (x) => x.kind === "folder" && x.originalPath === original,
      ),
    );
    await page.evaluate(() => window.vacuum.panel("bin"));
    await page
      .getByRole("dialog")
      .getByRole("heading", { name: "Dust bin", exact: true })
      .waitFor();
    await page
      .getByText("Verified duplicate folder", { exact: false })
      .first()
      .waitFor();
    await page
      .getByText("Duplicate Downloads: 2 verified", { exact: true })
      .waitFor();
    await page.locator(".duplicate-review summary").click();
    await page
      .getByText("Folder contents differ from the original.", { exact: false })
      .waitFor();
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState === "finished"),
    );
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await page.screenshot({
      path: "test-results/duplicate-folders-review.png",
    });
    // A newly edited copy is protected even if its parent timestamp is restored.
    const before = await fs.stat(copy2);
    await fs.writeFile(
      path.join(copy2, "readme.txt"),
      "A new edit belongs to the user.",
    );
    await fs.utimes(copy2, before.atime, before.mtime);
    const result = await page.evaluate(
      (ids) => window.vacuum.empty(ids),
      state.bin.files.map((x) => x.id),
    );
    assert.equal(result.trashed, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(
      result.skipped[0].id,
      state.bin.files.find((x) => x.path === copy2).id,
    );
    await assert.rejects(fs.access(copy1), { code: "ENOENT" });
    await fs.access(copy2);
    assert.equal(
      await hash(path.join(original, "nested", "data.bin")),
      originalHash,
    );
    assert.equal(
      await fs.readFile(path.join(original, "readme.txt"), "utf8"),
      "Keep the original intact.",
    );
    assert.deepEqual(errors, []);
    const report = {
      packaged,
      root,
      identicalOldCopiesFound: 2,
      differentRecentAndOrphanCopiesProtected: true,
      folderReviewShowsKeptOriginal: true,
      nativeRecycleTransfers: 1,
      changedCopySkipped: 1,
      originalHashesUnchanged: true,
      originalStillExists: true,
      rendererErrors: 0,
      permanentlyDeletedFiles: 0,
    };
    await fs.writeFile(
      "test-results/duplicate-folders-proof.json",
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
