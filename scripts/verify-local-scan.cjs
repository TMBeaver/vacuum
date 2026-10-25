const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createCleaner } = require("../electron/cleaner.cjs");

// This audit only discovers references. It cannot recycle or remove any file.
(async () => {
  const userData = await fs.mkdtemp(
    path.join(os.tmpdir(), "vacuum-readonly-audit-"),
  );
  const cleaner = createCleaner({
    userData,
    tempRoot: os.tmpdir(),
    localAppData: process.env.LOCALAPPDATA,
    downloadsRoot: undefined,
    trashItem: async () => {
      throw new Error("Recycling is disabled in this read-only verification.");
    },
  });
  const started = performance.now();
  const result = await cleaner.scan();
  const byCategory = {};
  for (const f of result.files) {
    const category = byCategory[f.category] || { files: 0, bytes: 0 };
    category.files++;
    category.bytes += f.size;
    byCategory[f.category] = category;
  }
  console.log(
    JSON.stringify(
      {
        readOnly: true,
        filesFound: result.count,
        bytesFound: result.bytes,
        categories: byCategory,
        coverage: result.coverage,
        seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
        filesRecycled: 0,
      },
      null,
      2,
    ),
  );
  cleaner.close();
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
