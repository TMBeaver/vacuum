"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { createCleaner } = require("../electron/cleaner.cjs");
async function setup() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "vacuum-duplicates-")),
    downloads = path.join(base, "Downloads"),
    userData = path.join(base, "state"),
    recycled = [];
  await fs.mkdir(downloads, { recursive: true });
  const config = {
    userData,
    downloadsRoot: downloads,
    trashItem: async (p) => recycled.push(p),
  };
  async function folder(
    name,
    files = { "notes.txt": "same", "nested/data.bin": "contents" },
    age = 200,
  ) {
    const target = path.join(downloads, name);
    await fs.mkdir(target, { recursive: true });
    for (const [relative, data] of Object.entries(files)) {
      const file = path.join(target, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data);
    }
    async function ageTree(dir) {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await ageTree(file);
        else {
          const stamp = new Date(Date.now() - age * 86400000);
          await fs.utimes(file, stamp, stamp);
        }
      }
      const stamp = new Date(Date.now() - age * 86400000);
      await fs.utimes(dir, stamp, stamp);
    }
    await ageTree(target);
    return target;
  }
  return {
    base,
    downloads,
    config,
    recycled,
    folder,
    engine: createCleaner(config),
  };
}
test("aged identical numbered folder copies are collected; original and different/recent/missing-original folders stay", async () => {
  const f = await setup();
  const original = await f.folder("Project");
  await f.folder("Project (1)");
  await f.folder("Project (2)");
  await f.folder("Project (3)", {
    "notes.txt": "different",
    "nested/data.bin": "contents",
  });
  await f.folder("Project (4)", undefined, 1);
  await f.folder("Other (1)");
  const bin = await f.engine.scan();
  assert.deepEqual(bin.files.map((x) => x.name).sort(), [
    "Project (1)",
    "Project (2)",
  ]);
  assert.equal(bin.bytes, 2 * ("same".length + "contents".length));
  assert.equal(bin.files[0].kind, "folder");
  assert.match(bin.files[0].reason, /Verified duplicate folder/);
  assert.deepEqual(f.recycled, []);
  const result = await f.engine.emptyBin(bin.files.map((x) => x.id));
  assert.equal(result.trashed, 2);
  assert.deepEqual(
    f.recycled.map((p) => path.basename(p)),
    ["Project (1)", "Project (2)"],
  );
  assert.equal(
    await fs.readFile(path.join(original, "notes.txt"), "utf8"),
    "same",
  );
});
test("recycling after restart checks hashes and identities of both the original and copy", async () => {
  for (const change of ["copy", "original", "missing", "added", "renamed"]) {
    const f = await setup();
    const original = await f.folder("Work"),
      copy = await f.folder("Work (1)");
    const bin = await f.engine.scan();
    assert.equal(bin.count, 1);
    f.engine.close();
    if (change === "missing") await fs.rename(original, original + " retained");
    else if (change === "added")
      await fs.writeFile(path.join(copy, "new.txt"), "unique");
    else if (change === "renamed")
      await fs.rename(
        path.join(copy, "notes.txt"),
        path.join(copy, "renamed.txt"),
      );
    else {
      const file = path.join(change === "copy" ? copy : original, "notes.txt");
      const before = await fs.stat(file);
      await fs.writeFile(file, "DIFF");
      await fs.utimes(file, before.atime, before.mtime);
    }
    const engine = createCleaner(f.config);
    assert.equal((await engine.getBin()).count, 1);
    const result = await engine.emptyBin([bin.files[0].id]);
    assert.equal(result.trashed, 0, change);
    assert.equal(result.skipped.length, 1, change);
    assert.deepEqual(f.recycled, []);
    await fs.access(copy);
  }
});
test("nested recent data, hard links and structural differences are protected", async () => {
  const f = await setup();
  await f.folder("Set");
  const recent = await f.folder("Set (1)");
  await fs.utimes(path.join(recent, "nested/data.bin"), new Date(), new Date());
  const linked = await f.folder("Set (2)");
  await fs.link(
    path.join(linked, "notes.txt"),
    path.join(f.base, "retained-hard-link"),
  );
  const stamp = new Date(Date.now() - 200 * 86400000);
  await fs.utimes(linked, stamp, stamp);
  await f.folder("Set (3)", { "notes.txt": "same", "data.bin": "contents" });
  const bin = await f.engine.scan();
  assert.equal(bin.count, 0);
  assert.equal(bin.coverage.duplicateFolders.skipped.length, 3);
});
test("compression refuses whole-folder copies and failed recycling has no delete fallback", async () => {
  const f = await setup();
  await f.folder("Keep");
  const copy = await f.folder("Keep (1)");
  const config = {
    ...f.config,
    trashItem: async () => {
      throw Error("Recycle refused");
    },
    compactFiles: Object.assign(
      async () => {
        throw Error("Must not call native compression");
      },
      {
        inspect: async () => {
          throw Error("Must not inspect a folder for compression");
        },
      },
    ),
  };
  const engine = createCleaner(config),
    bin = await engine.scan();
  const compressed = await engine.compactBin([bin.files[0].id]);
  assert.equal(compressed.skipped.length, 1);
  const result = await engine.emptyBin([bin.files[0].id]);
  assert.equal(result.trashed, 0);
  await fs.access(copy);
  assert.equal(result.bin.count, 1);
});
test("identical bytes with a different file tree do not qualify", async () => {
  const f = await setup();
  await f.folder("Bundle", { "a.txt": "abc", "nested/b.txt": "def" });
  await f.folder("Bundle (1)", { "a.txt": "abc", "different/b.txt": "def" });
  assert.equal((await f.engine.scan()).count, 0);
});
const { createDuplicateFolders } = require("../electron/duplicate-folders.cjs");
test("directory junctions and extra Windows data streams are excluded", async () => {
  const f = await setup();
  await f.folder("Protected");
  const copy = await f.folder("Protected (1)");
  await fs.symlink(
    path.join(f.downloads, "Protected", "nested"),
    path.join(copy, "shortcut"),
    "junction",
  );
  const junctionAge = new Date(Date.now() - 200 * 86400000);
  await fs.utimes(copy, junctionAge, junctionAge);
  let bin = await f.engine.scan();
  assert.equal(bin.count, 0);
  assert.match(bin.coverage.duplicateFolders.skipped[0].reason, /Linked/);
  if (process.platform === "win32") {
    await f.folder("Streams");
    const streamCopy = await f.folder("Streams (1)");
    await fs.writeFile(
      path.join(streamCopy, "notes.txt") + ":private-data",
      "unique data only in the copy",
    );
    const age = new Date(Date.now() - 200 * 86400000);
    await fs.utimes(path.join(streamCopy, "notes.txt"), age, age);
    bin = await f.engine.scan();
    assert.equal(bin.count, 0);
    assert.ok(
      bin.coverage.duplicateFolders.skipped.some((x) =>
        /streams/i.test(x.reason),
      ),
    );
  }
});
test("bounded and cancelled comparisons do not collect unverified copies", async () => {
  const f = await setup();
  await f.folder("Bound");
  await f.folder("Bound (1)");
  const limited = await createDuplicateFolders(f.downloads, {
    maxBytes: 1,
  }).scan();
  assert.equal(limited.found.length, 0);
  assert.equal(limited.limited, true);
  const aborted = new AbortController();
  aborted.abort();
  const cancelled = await createDuplicateFolders(f.downloads).scan(
    aborted.signal,
  );
  assert.equal(cancelled.found.length, 0);
  assert.equal(cancelled.cancelled, true);
});
test("Unicode folder and file names are compared without losing characters", async () => {
  const f = await setup();
  await f.folder("Įrašai", { "žinutė.txt": "Lithuanian fixture" });
  await f.folder("Įrašai (1)", { "žinutė.txt": "Lithuanian fixture" });
  const result = await f.engine.scan();
  assert.equal(
    result.count,
    1,
    JSON.stringify(result.coverage.duplicateFolders),
  );
  assert.equal(result.files[0].name, "Įrašai (1)");
});
