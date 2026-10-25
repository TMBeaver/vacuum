const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createCleaner } = require("../electron/cleaner.cjs");
async function fixture(adapter) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "vacuum-compaction-unit-"),
  );
  const tempRoot = path.join(root, "temp");
  await fs.mkdir(tempRoot);
  const filename = path.join(tempRoot, "old.log");
  await fs.writeFile(filename, "kept contents");
  const age = new Date(Date.now() - 10 * 86400000);
  await fs.utimes(filename, age, age);
  const config = {
    userData: path.join(root, "state"),
    tempRoot,
    trashItem: async () => {
      throw Error("This test never recycles");
    },
    compactFiles: adapter,
  };
  return { filename, config, engine: createCleaner(config) };
}
const success = (entry, compress) => ({
  id: entry.id,
  ok: true,
  beforeBytes: compress ? 4096 : 1024,
  afterBytes: compress ? 1024 : 4096,
  wasCompressed: !compress,
  compressed: compress,
  verified: true,
  sha256: "verified-fixture",
});
test("compression only receives reviewed server-side IDs; changes no file contents", async () => {
  let paths = [];
  const f = await fixture(async (entries, compress) => {
    paths = entries.map((e) => e.path);
    return entries.map((e) => success(e, compress));
  });
  const bin = await f.engine.scan();
  assert.equal((await f.engine.compactBin([f.filename])).verifiedFiles, 0);
  assert.deepEqual(paths, []);
  const result = await f.engine.compactBin([bin.files[0].id]);
  assert.equal(result.bytesSaved, 3072);
  assert.equal(result.bin.files[0].compacted, true);
  assert.equal(await fs.readFile(f.filename, "utf8"), "kept contents");
});
test("compression remains reversible after restart and a new scan", async () => {
  const f = await fixture(async (entries, compress) =>
    entries.map((e) => success(e, compress)),
  );
  const bin = await f.engine.scan();
  await f.engine.compactBin([bin.files[0].id]);
  const restarted = createCleaner(f.config);
  await restarted.scan();
  assert.equal((await restarted.getBin()).files[0].compacted, true);
  const result = await restarted.compactBin([bin.files[0].id], false);
  assert.equal(result.bytesExpanded, 3072);
  assert.equal(result.bin.files[0].compacted, false);
});
test("changed files and unverified native results cannot become successful savings", async () => {
  let calls = 0;
  const f = await fixture(async (entries) => {
    calls++;
    return entries.map((e) => ({ ...success(e, true), verified: false }));
  });
  const bin = await f.engine.scan();
  let result = await f.engine.compactBin([bin.files[0].id]);
  assert.equal(result.bytesSaved, 0);
  assert.equal(result.skipped.length, 1);
  await fs.writeFile(f.filename, "new contents that must not be touched");
  result = await f.engine.compactBin([bin.files[0].id]);
  assert.equal(calls, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(
    await fs.readFile(f.filename, "utf8"),
    "new contents that must not be touched",
  );
});
test("undo never changes compression that Vacuum did not apply", async () => {
  let called = false;
  const f = await fixture(async () => {
    called = true;
    return [];
  });
  const bin = await f.engine.scan();
  const result = await f.engine.compactBin([bin.files[0].id], false);
  assert.equal(called, false);
  assert.equal(result.changed, 0);
  assert.equal(result.skipped.length, 1);
});
test("invalid or oversized selections fail before reaching Windows", async () => {
  const f = await fixture(async () => {
    throw Error("must not run");
  });
  await assert.rejects(
    f.engine.compactBin(Array.from({ length: 65 }, () => "")),
    /64/,
  );
  await assert.rejects(f.engine.compactBin([{}]), /64/);
});
