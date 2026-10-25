const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
async function compactFiles(entries, compress) {
  if (!Array.isArray(entries) || entries.length > 64)
    throw Error("Select up to 64 files for a reversible space-saving pass.");
  const script = await fs.readFile(
    path.join(__dirname, "compact-files.ps1"),
    "utf8",
  );
  return new Promise((resolve, reject) => {
    const child = execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script,
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024, timeout: 300000 },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr || error.message));
        try {
          const result = JSON.parse(stdout.trim());
          resolve(
            Array.isArray(result.files)
              ? result.files
              : result.files
                ? [result.files]
                : [],
          );
        } catch (error) {
          reject(error);
        }
      },
    );
    child.stdin.end(
      JSON.stringify({
        entries: entries.map(({ id, path, size, mtimeMs }) => ({
          id,
          path,
          size,
          mtimeMs,
        })),
        compress,
      }),
    );
  });
}
module.exports = { compactFiles };
