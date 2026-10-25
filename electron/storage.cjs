const fs = require("node:fs/promises");
const path = require("node:path");

async function sampleStorage(location, statfs = fs.statfs) {
  const volume = path.parse(path.resolve(location)).root;
  try {
    const stats = await statfs(volume);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    if (
      !Number.isFinite(freeBytes) ||
      !Number.isFinite(totalBytes) ||
      totalBytes <= 0
    )
      throw new Error("Storage measurement unavailable");
    return {
      available: true,
      volume,
      freeBytes,
      totalBytes,
      sampledAt: new Date().toISOString(),
    };
  } catch {
    return { available: false, volume, sampledAt: new Date().toISOString() };
  }
}

function describeStorageChange(before, after, recycledBytes) {
  return {
    before,
    after,
    recycledBytes,
    observedDeltaBytes:
      before?.available && after?.available && before.volume === after.volume
        ? after.freeBytes - before.freeBytes
        : null,
    attributedFreedBytes: null,
    explanation:
      "Files in Windows Recycle Bin remain recoverable and continue to use drive space. Free-space changes can include other applications; recycled bytes are not space freed.",
  };
}
module.exports = { sampleStorage, describeStorageChange };
