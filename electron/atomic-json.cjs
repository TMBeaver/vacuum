const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
async function writeAtomicJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2));
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, filename);
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}
module.exports = { writeAtomicJson };
