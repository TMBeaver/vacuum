const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

const BROWSERS = [
  {
    key: "chrome",
    label: "Chrome",
    folder: ["Google", "Chrome", "User Data"],
    process: "chrome.exe",
  },
  {
    key: "edge",
    label: "Edge",
    folder: ["Microsoft", "Edge", "User Data"],
    process: "msedge.exe",
  },
];
const CACHE_PATHS = [
  ["Cache", "Cache_Data"],
  ["Code Cache", "js"],
  ["Code Cache", "wasm"],
];

function recognizeCacheRoot(localAppData, candidate) {
  if (!localAppData || typeof candidate !== "string") return null;
  for (const browser of BROWSERS) {
    const parent = path.resolve(localAppData, ...browser.folder);
    const segments = path
      .relative(parent, path.resolve(candidate))
      .split(path.sep);
    if (segments.length !== 3 || !/^(Default|Profile \d+)$/.test(segments[0]))
      continue;
    if (
      CACHE_PATHS.some(
        (parts) => parts[0] === segments[1] && parts[1] === segments[2],
      )
    )
      return {
        path: path.resolve(candidate),
        category: "browser-cache",
        days: 7,
        browser: browser.key,
        label: browser.label,
      };
  }
  return null;
}

async function discoverBrowserCaches(localAppData) {
  const roots = [];
  let errors = 0;
  if (!localAppData) return { roots, errors };
  for (const browser of BROWSERS) {
    const parent = path.resolve(localAppData, ...browser.folder);
    try {
      const info = await fs.lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      const entries = await fs.readdir(parent, { withFileTypes: true });
      for (const profile of entries) {
        if (
          !profile.isDirectory() ||
          profile.isSymbolicLink() ||
          !/^(Default|Profile \d+)$/.test(profile.name)
        )
          continue;
        for (const segments of CACHE_PATHS)
          roots.push({
            path: path.join(parent, profile.name, ...segments),
            category: "browser-cache",
            days: 7,
            browser: browser.key,
            label: browser.label,
          });
      }
    } catch (error) {
      if (error.code !== "ENOENT") errors++;
    }
  }
  return { roots, errors };
}

function parseProcessNames(csv) {
  const names = csv
    .split(/\r?\n/)
    .map((line) => /^"([^"\r\n]+)"/.exec(line)?.[1]?.toLowerCase())
    .filter(Boolean);
  if (!names.length) throw Error("Windows process list was unavailable.");
  return new Set(names);
}
function readProcesses() {
  return new Promise((resolve, reject) =>
    execFile(
      path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "tasklist.exe",
      ),
      ["/FO", "CSV", "/NH"],
      { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error)
          return reject(Error("Windows process list was unavailable."));
        try {
          resolve(parseProcessNames(stdout));
        } catch (error) {
          reject(error);
        }
      },
    ),
  );
}
function createBrowserGuard({ read = readProcesses, ttlMs = 500 } = {}) {
  let pending,
    expires = 0;
  return async (key) => {
    const browser = BROWSERS.find((browser) => browser.key === key);
    if (!browser) throw Error("Unknown browser cache is protected.");
    if (!pending || Date.now() >= expires) {
      expires = Infinity;
      pending = Promise.resolve()
        .then(read)
        .finally(() => {
          expires = Date.now() + ttlMs;
        });
    }
    let names;
    try {
      names = await pending;
    } catch {
      throw Error(
        `${browser.label} cache skipped: browser status could not be checked.`,
      );
    }
    if (names.has(browser.process))
      throw Error(
        `${browser.label} cache skipped: close ${browser.label} fully and scan again.`,
      );
  };
}
module.exports = {
  discoverBrowserCaches,
  createBrowserGuard,
  parseProcessNames,
  recognizeCacheRoot,
};
