const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createCleaner } = require("../electron/cleaner.cjs");
const { createHash } = require("node:crypto");
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
  if (!adapter.inspect)
    adapter.inspect = async (entries) =>
      Promise.all(
        entries.map(async (entry) => ({
          id: entry.id,
          ok: true,
          verified: true,
          beforeBytes: entry.compaction?.managed ? 1024 : 4096,
          compressed: !!entry.compaction?.managed,
          sha256: createHash("sha256")
            .update(await fs.readFile(entry.path))
            .digest("hex"),
        })),
      );
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
  sha256: entry.expectedSha256,
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

async function interruptedFixture({
  mutate = true,
  initiallyCompressed = false,
} = {}) {
  let compressed = initiallyCompressed,
    interrupt = true,
    f;
  const adapter = async (entries, compress) => {
    const journal = JSON.parse(
      await fs.readFile(
        path.join(f.config.userData, "compression-journal.json"),
        "utf8",
      ),
    );
    assert.equal(journal.items[0].prepared.sha256, entries[0].expectedSha256);
    const wasCompressed = compressed;
    if (mutate) compressed = compress;
    if (interrupt) throw Error("Simulated interruption after native call");
    return entries.map((entry) => ({
      ...success(entry, compress),
      wasCompressed,
      compressed,
    }));
  };
  adapter.inspect = async (entries) =>
    Promise.all(
      entries.map(async (entry) => ({
        id: entry.id,
        ok: true,
        verified: true,
        compressed,
        beforeBytes: compressed ? 1024 : 4096,
        sha256: createHash("sha256")
          .update(await fs.readFile(entry.path))
          .digest("hex"),
      })),
    );
  f = await fixture(adapter);
  const bin = await f.engine.scan();
  const id = bin.files[0].id;
  await assert.rejects(f.engine.compactBin([id]), /Simulated interruption/);
  interrupt = false;
  return { ...f, id };
}

test("a durable journal exists before mutation; restart recovers verified Undo", async () => {
  const f = await interruptedFixture();
  const restarted = createCleaner(f.config);
  assert.equal((await restarted.getRecovery()).recovered, 1);
  assert.equal((await restarted.getBin()).files[0].compacted, true);
  const undone = await restarted.compactBin([f.id], false);
  assert.equal(undone.bin.files[0].compacted, false);
  assert.equal(undone.bytesExpanded, 3072);
  assert.equal(await fs.readFile(f.filename, "utf8"), "kept contents");
});

test("interruption before native mutation never invents savings or ownership", async () => {
  const f = await interruptedFixture({ mutate: false });
  const restarted = createCleaner(f.config);
  assert.equal((await restarted.getRecovery()).recovered, 1);
  assert.equal((await restarted.getBin()).files[0].compacted, false);
});

test("changed contents after interruption are protected from recycling and compression", async () => {
  const f = await interruptedFixture();
  await fs.writeFile(f.filename, "new! contents"); // Same byte count, different contents.
  const restarted = createCleaner(f.config);
  assert.equal((await restarted.getRecovery()).needsReview, 1);
  assert.ok((await restarted.getBin()).files[0].recoveryProblem);
  assert.equal((await restarted.emptyBin([f.id])).trashed, 0);
  assert.equal((await restarted.compactBin([f.id])).changed, 0);
  assert.equal(await fs.readFile(f.filename, "utf8"), "new! contents");
});

test("recovery never takes ownership of pre-existing Windows compression", async () => {
  const f = await interruptedFixture({ initiallyCompressed: true });
  const restarted = createCleaner(f.config);
  assert.equal((await restarted.getBin()).files[0].compacted, false);
  assert.equal((await restarted.compactBin([f.id], false)).changed, 0);
});

test("corrupt recovery metadata protects files without calling Windows", async () => {
  const f = await fixture(async () => {
    throw Error("must not mutate");
  });
  const bin = await f.engine.scan();
  await fs.writeFile(
    path.join(f.config.userData, "compression-journal.json"),
    "null",
  );
  f.config.compactFiles.inspect = async () => {
    throw Error("must not inspect");
  };
  const restarted = createCleaner(f.config);
  assert.equal((await restarted.getRecovery()).pending, true);
  assert.equal((await restarted.emptyBin([bin.files[0].id])).trashed, 0);
  await assert.rejects(
    restarted.compactBin([bin.files[0].id]),
    /journal is invalid/,
  );
  assert.equal(await fs.readFile(f.filename, "utf8"), "kept contents");
});
