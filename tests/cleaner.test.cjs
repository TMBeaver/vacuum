"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createCleaner } = require("../electron/cleaner.cjs");

const DAY = 86_400_000;

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vacuum-engine-test-"));
  const config = {
    userData: path.join(root, "state"),
    tempRoot: path.join(root, "temp"),
    localAppData: path.join(root, "local"),
    downloadsRoot: path.join(root, "Downloads"),
    trashItem: async (filename) => {
      recycled.push(filename);
    },
    ...options,
  };
  const recycled = [];
  await Promise.all(
    [
      config.userData,
      config.tempRoot,
      path.join(config.localAppData, "CrashDumps"),
      config.downloadsRoot,
    ].map((directory) => fs.mkdir(directory, { recursive: true })),
  );
  // Cleanup is restricted to the absolute mkdtemp fixture that this test owns.
  t.after(async () => {
    if (process.env.VACUUM_PRESERVE_FIXTURES !== "1")
      await fs.rm(root, { recursive: true, force: true });
  });
  async function file(relative, age = 10, content = "fixture") {
    const filename = path.join(root, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, content);
    const timestamp = new Date(Date.now() - age * DAY);
    await fs.utimes(filename, timestamp, timestamp);
    return filename;
  }
  return { root, config, recycled, file, engine: createCleaner(config) };
}

test("collects only aged allowlisted temporary files and crash dumps without deleting anything", async (t) => {
  const f = await fixture(t);
  const old = await f.file("temp/nested/stale.tmp");
  await f.file("temp/recent.tmp", 1);
  await f.file("temp/important.docx", 200);
  await f.file("temp/install.exe", 50);
  await f.file("temp/session.LOG", 9);
  await f.file("local/CrashDumps/old.dmp", 31);
  await f.file("local/CrashDumps/new.dmp", 20);
  await f.file("Downloads/old.pdf", 200);
  const bin = await f.engine.scan();
  assert.equal(bin.count, 3);
  assert.equal(bin.added, 3);
  assert.equal(bin.coverage.cancelled, false);
  assert.deepEqual(
    new Set(bin.files.map((file) => file.name)),
    new Set(["stale.tmp", "session.LOG", "old.dmp"]),
  );
  assert.deepEqual(f.recycled, []);
  assert.equal(await fs.readFile(old, "utf8"), "fixture");
  assert.equal((await f.engine.scan()).added, 0);
});

test("bin persists across restart; release only forgets references", async (t) => {
  const f = await fixture(t);
  const filename = await f.file("temp/old.tmp");
  const first = await f.engine.scan();
  const restarted = createCleaner(f.config);
  assert.deepEqual(await restarted.getBin(), {
    files: first.files,
    count: first.count,
    bytes: first.bytes,
  });
  const released = await restarted.release([first.files[0].id]);
  assert.equal(released.count, 0);
  await fs.access(filename);
  assert.deepEqual(f.recycled, []);
});

test("a fresh scan updates eligible file identities without duplicating bin references", async (t) => {
  const f = await fixture(t);
  const filename = await f.file("temp/old.tmp", 20);
  const original = await f.engine.scan();
  await fs.writeFile(filename, "changed-but-still-old fixture");
  const timestamp = new Date(Date.now() - 20 * DAY);
  await fs.utimes(filename, timestamp, timestamp);
  const refreshed = await f.engine.scan();
  assert.equal(refreshed.count, 1);
  assert.equal(refreshed.added, 0);
  assert.equal(refreshed.files[0].id, original.files[0].id);
  assert.notEqual(refreshed.files[0].size, original.files[0].size);
  assert.equal((await f.engine.emptyBin([original.files[0].id])).trashed, 1);
});

test("empty recycles selected IDs only, never arbitrary renderer paths", async (t) => {
  const f = await fixture(t);
  const filename = await f.file("temp/old.tmp");
  await f.file("temp/second.tmp");
  const scan = await f.engine.scan();
  const item = scan.files.find((file) => file.path === filename);
  const result = await f.engine.emptyBin([
    item.id,
    path.join(f.root, "secret.txt"),
  ]);
  assert.equal(result.trashed, 1);
  assert.equal(result.bin.count, 1);
  assert.deepEqual(f.recycled, [filename]);
});

test("changed, missing and failed-trash files are left in the bin without permanent deletion", async (t) => {
  const f = await fixture(t, {
    trashItem: async () => {
      throw new Error("Recycle Bin unavailable");
    },
  });
  const changed = await f.file("temp/changed.tmp");
  const missing = await f.file("temp/missing.tmp");
  const failure = await f.file("temp/failure.tmp");
  const scan = await f.engine.scan();
  await fs.writeFile(changed, "a newly changed user file");
  await fs.rename(missing, `${missing}.retained-by-test`);
  const result = await f.engine.emptyBin(scan.files.map((file) => file.id));
  assert.equal(result.trashed, 0);
  assert.equal(result.skipped.length, 3);
  assert.equal(result.bin.count, 3);
  await fs.access(failure);
  assert.equal(await fs.readFile(changed, "utf8"), "a newly changed user file");
});

test("old downloads require a current review ID and explicit collection", async (t) => {
  const f = await fixture(t);
  const filename = await f.file("Downloads/archive/photo.jpg", 190);
  await f.file("Downloads/recent.pdf", 4);
  assert.equal((await f.engine.scan()).count, 0);
  const review = await f.engine.reviewOldFiles();
  assert.equal(review.count, 1);
  assert.equal(review.files[0].path, filename);
  assert.equal((await f.engine.getBin()).count, 0);
  const bad = await f.engine.collectOldFiles([filename]);
  assert.equal(bad.count, 0);
  assert.equal(bad.skipped.length, 1);
  const collected = await f.engine.collectOldFiles([review.files[0].id]);
  assert.equal(collected.count, 1);
  assert.equal(collected.files[0].category, "old-downloads");
  assert.equal((await f.engine.emptyBin([review.files[0].id])).trashed, 1);
  assert.deepEqual(f.recycled, [filename]);
});

test("revalidates old downloads before accepting them", async (t) => {
  const f = await fixture(t);
  const filename = await f.file("Downloads/old.pdf", 200);
  const review = await f.engine.reviewOldFiles();
  await fs.writeFile(filename, "now in use");
  const result = await f.engine.collectOldFiles([review.files[0].id]);
  assert.equal(result.added, 0);
  assert.equal(result.skipped.length, 1);
});

test("excludes app state when it is nested inside the cleaning root", async (t) => {
  const f = await fixture(t);
  const nested = createCleaner({
    ...f.config,
    userData: path.join(f.config.tempRoot, "vacuum-state"),
  });
  await f.file("temp/vacuum-state/private.tmp", 400);
  await f.file("temp/eligible.tmp", 20);
  const result = await nested.scan();
  assert.equal(result.count, 1);
  assert.equal(result.files[0].name, "eligible.tmp");
});

test("cancellation commits no new references", async (t) => {
  const abort = new AbortController();
  const f = await fixture(t, { onProgress: () => abort.abort() });
  await f.file("temp/a.tmp");
  await f.file("temp/b.tmp");
  const result = await f.engine.scan({ signal: abort.signal });
  assert.equal(result.coverage.cancelled, true);
  assert.equal(result.count, 0);
  assert.equal(result.added, 0);
  assert.deepEqual(f.recycled, []);
});

test("does not follow directory junctions or recycle through a substituted ancestor", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, "outside");
  await fs.mkdir(outside);
  const old = await f.file("temp/original/old.tmp", 20);
  const outsideFile = await f.file("outside/precious.tmp", 300);
  const link = path.join(f.config.tempRoot, "linked");
  try {
    await fs.symlink(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("Host does not permit test symlinks.");
      return;
    }
    throw error;
  }
  const scan = await f.engine.scan();
  assert.equal(scan.count, 1);
  assert.equal(scan.files[0].path, old);
  await fs.rename(
    path.join(f.config.tempRoot, "original"),
    path.join(f.config.tempRoot, "original-moved"),
  );
  await fs.symlink(
    outside,
    path.join(f.config.tempRoot, "original"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const result = await f.engine.emptyBin(scan.files.map((file) => file.id));
  assert.equal(result.trashed, 0);
  assert.equal(result.skipped.length, 1);
  assert.deepEqual(f.recycled, []);
  await fs.access(outsideFile);
});

test("corrupt and forged manifests fail closed", async (t) => {
  const f = await fixture(t);
  await f.engine.getBin();
  await fs.writeFile(path.join(f.config.userData, "bin.json"), "{broken");
  const broken = createCleaner(f.config);
  await assert.rejects(broken.getBin(), /Could not read/);
  await fs.writeFile(
    path.join(f.config.userData, "bin.json"),
    JSON.stringify({
      version: 1,
      files: [{ id: "forged", path: path.join(f.root, "secret") }],
    }),
  );
  assert.equal((await createCleaner(f.config).getBin()).count, 0);
});

test("recycle progress reports durable successes and skipped files without inflating totals", async (t) => {
  const progress = [];
  const f = await fixture(t, {
    onEmptyProgress: (p) => progress.push({ ...p }),
    trashItem: async (file) => {
      if (file.endsWith("refused.tmp")) throw Error("Fixture refusal");
    },
  });
  await f.file("temp/good.tmp");
  await f.file("temp/refused.tmp");
  const changed = await f.file("temp/changed.tmp");
  const scan = await f.engine.scan();
  await fs.writeFile(changed, "Updated contents must stay intact");
  const result = await f.engine.emptyBin([
    ...scan.files.map((file) => file.id),
    scan.files[0].id,
    "unknown-id",
  ]);
  assert.equal(result.trashed, 1);
  assert.equal(result.skipped.length, 2);
  assert.deepEqual(
    progress.map((p) => p.processed),
    [0, 1, 2, 3],
  );
  assert.ok(
    progress.every(
      (p) => p.total === 3 && p.processed === p.recycled + p.skipped,
    ),
  );
  assert.equal(progress.at(-1).recycled, 1);
  assert.equal(progress.at(-1).skipped, 2);
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(f.config.userData, "bin.json"), "utf8"),
    ).files.length,
    2,
  );
  assert.equal(
    await fs.readFile(changed, "utf8"),
    "Updated contents must stay intact",
  );
});
