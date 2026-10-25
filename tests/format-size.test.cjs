const { test } = require("node:test");
const assert = require("node:assert/strict");

test("all file sizes use compact MB, GB or TB labels", async () => {
  const { formatSize } = await import("../src/format-size.mjs");
  assert.equal(formatSize(0), "0 MB");
  assert.equal(formatSize(12), "<0.01 MB");
  assert.equal(formatSize(512 * 1024), "0.5 MB");
  assert.equal(formatSize(8 * 1024 ** 2), "8 MB");
  assert.equal(formatSize(499999 * 1024), "488.28 MB");
  assert.equal(formatSize(1024 ** 3), "1 GB");
  assert.equal(formatSize(1.25 * 1024 ** 4), "1.25 TB");
  assert.equal(formatSize(NaN), "Unavailable");
});
