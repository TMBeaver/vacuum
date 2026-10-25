const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  sampleStorage,
  describeStorageChange,
} = require("../electron/storage.cjs");
test("storage uses available blocks, not total free blocks reserved from the user", async () => {
  const result = await sampleStorage(process.cwd(), async () => ({
    bsize: 4096,
    bavail: 20,
    bfree: 30,
    blocks: 100,
  }));
  assert.equal(result.freeBytes, 81920);
  assert.equal(result.totalBytes, 409600);
  assert.equal(result.available, true);
});
test("unavailable metrics remain unavailable rather than showing zero disk space", async () => {
  assert.equal(
    (
      await sampleStorage(process.cwd(), async () => {
        throw Error("denied");
      })
    ).available,
    false,
  );
});
test("recycled bytes never become an attributed space-saving claim", () => {
  for (const freeBytes of [100, 125, 75]) {
    const result = describeStorageChange(
      { available: true, volume: "C:", freeBytes: 100 },
      { available: true, volume: "C:", freeBytes },
      5000,
    );
    assert.equal(result.attributedFreedBytes, null);
    assert.equal(result.observedDeltaBytes, freeBytes - 100);
    assert.equal(result.recycledBytes, 5000);
  }
});
test("measurements from different volumes cannot be compared", () => {
  assert.equal(
    describeStorageChange(
      { available: true, volume: "C:", freeBytes: 100 },
      { available: true, volume: "D:", freeBytes: 500 },
      20,
    ).observedDeltaBytes,
    null,
  );
});
