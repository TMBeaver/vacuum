const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createCleaner } = require("../electron/cleaner.cjs");
const { createBrowserGuard } = require("../electron/browser-cache.cjs");

// Read-only audit of the actual configured cache locations. Only this new
// temporary profile's reference metadata is written; no user file is moved.
(async () => {
  const { formatSize } = await import("../src/format-size.mjs");
  const userData = await fs.mkdtemp(
    path.join(os.tmpdir(), "vacuum-readonly-cache-audit-"),
  );
  const cleaner = createCleaner({
    userData,
    localAppData: process.env.LOCALAPPDATA,
    assertBrowserClosed: createBrowserGuard(),
    trashItem: async () => {
      throw Error("Read-only audit cannot recycle files.");
    },
  });
  const start = Date.now();
  const result = await cleaner.scan();
  const cache = result.files.filter(
    (file) => file.category === "browser-cache",
  );
  const browsers = {};
  for (const file of cache) {
    const entry = (browsers[file.browser] ||= { count: 0, bytes: 0 });
    entry.count++;
    entry.bytes += file.size;
  }
  for (const entry of Object.values(browsers))
    entry.size = formatSize(entry.bytes);
  const report = {
    realLocalFilesystem: true,
    readOnly: true,
    elapsedMs: Date.now() - start,
    cacheCandidates: cache.length,
    candidateSize: formatSize(cache.reduce((sum, file) => sum + file.size, 0)),
    browsers,
    coverage: result.coverage,
    userFilesMoved: 0,
    explanation:
      "Logical size of eligible cache references, not measured space freed. No file was recycled or compressed.",
  };
  await fs.mkdir(path.resolve(__dirname, "../test-results"), {
    recursive: true,
  });
  await fs.writeFile(
    path.resolve(__dirname, "../test-results/local-cache-audit.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
