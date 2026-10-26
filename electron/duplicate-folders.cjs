"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
async function checkStreams(paths, signal) {
  if (process.platform !== "win32") return;
  const script = await fs.readFile(
    path.join(__dirname, "duplicate-streams.ps1"),
    "utf8",
  );
  await new Promise((resolve, reject) => {
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
      { windowsHide: true, timeout: 30000, signal },
      (error, stdout) => {
        if (error)
          return reject(
            Error("Windows stream verification was unavailable. Folder kept."),
          );
        try {
          const result = JSON.parse(stdout.trim());
          result.ok ? resolve() : reject(Error(result.reason));
        } catch (error) {
          reject(error);
        }
      },
    );
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(paths));
  });
}
const DAY = 86400000;
const COPY = /^(.+) \(([1-9]\d*)\)$/;
const identity = (s) => [
  s.size,
  s.mtimeMs,
  s.ctimeMs,
  s.birthtimeMs,
  String(s.ino),
  String(s.dev),
  s.nlink,
];
function createDuplicateFolders(
  downloadsRoot,
  { maxEntries = 50000, maxBytes = 4 * 1024 ** 3, protectedPath } = {},
) {
  const root = downloadsRoot && path.resolve(downloadsRoot);
  function originalFor(copy) {
    if (!root || path.dirname(copy) !== root)
      throw Error("Duplicate folder is outside Downloads.");
    const match = COPY.exec(path.basename(copy));
    if (!match || COPY.test(match[1]))
      throw Error("Not a numbered download folder.");
    return path.join(root, match[1]);
  }
  async function safeAncestors(folder) {
    const parsed = path.parse(folder);
    let current = parsed.root;
    for (const part of folder
      .slice(parsed.root.length)
      .split(path.sep)
      .filter(Boolean)) {
      current = path.join(current, part);
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw Error("Linked or unavailable folder.");
    }
  }
  async function tree(folder, old, budget, signal) {
    if (
      protectedPath &&
      (folder === protectedPath ||
        protectedPath.startsWith(folder + path.sep) ||
        folder.startsWith(protectedPath + path.sep))
    )
      throw Error("Vacuum state folders are protected.");
    await safeAncestors(folder);
    const contents = [],
      fingerprints = [];
    let bytes = 0,
      files = 0;
    async function visit(target, relative, depth) {
      if (signal?.aborted) throw Error("Duplicate comparison cancelled.");
      if (depth > 64 || ++budget.entries > maxEntries)
        throw Error("Duplicate comparison entry limit reached.");
      const before = await fs.lstat(target);
      if (before.isSymbolicLink())
        throw Error("Linked files and folders are protected.");
      if (old && Date.now() - before.mtimeMs <= 180 * DAY)
        throw Error("Copy contains recently changed files or folders.");
      const stamp = identity(before);
      if (before.isDirectory()) {
        contents.push([relative, "directory"]);
        const children = (await fs.readdir(target)).sort();
        for (const name of children)
          await visit(
            path.join(target, name),
            path.join(relative, name),
            depth + 1,
          );
        const after = await fs.lstat(target);
        if (JSON.stringify(stamp) !== JSON.stringify(identity(after)))
          throw Error("Folder changed during comparison.");
      } else {
        if (!before.isFile() || before.nlink !== 1)
          throw Error("Linked or special files are protected.");
        budget.bytes += before.size;
        if (budget.bytes > maxBytes)
          throw Error("Duplicate comparison byte limit reached.");
        const handle = await fs.open(target, "r");
        const hash = createHash("sha256");
        try {
          if (
            JSON.stringify(stamp) !==
            JSON.stringify(identity(await handle.stat()))
          )
            throw Error("File replaced during comparison.");
          for await (const chunk of handle.createReadStream({
            autoClose: false,
          })) {
            if (signal?.aborted) throw Error("Duplicate comparison cancelled.");
            hash.update(chunk);
          }
          if (
            JSON.stringify(stamp) !==
            JSON.stringify(identity(await handle.stat()))
          )
            throw Error("File changed during comparison.");
        } finally {
          await handle.close();
        }
        if (
          JSON.stringify(stamp) !==
          JSON.stringify(identity(await fs.lstat(target)))
        )
          throw Error("File replaced during comparison.");
        contents.push([relative, "file", before.size, hash.digest("hex")]);
        bytes += before.size;
        files++;
      }
      fingerprints.push([relative, ...stamp]);
    }
    await visit(folder, "", 0);
    return {
      digest: createHash("sha256")
        .update(JSON.stringify(contents))
        .digest("hex"),
      fingerprint: createHash("sha256")
        .update(JSON.stringify(fingerprints))
        .digest("hex"),
      bytes,
      files,
      checks: fingerprints,
      metadata: await fs.lstat(folder),
    };
  }
  async function compare(copy, budget, signal) {
    const original = originalFor(copy);
    await safeAncestors(original);
    const second = await tree(copy, true, budget, signal),
      first = await tree(original, false, budget, signal);
    if (first.digest !== second.digest)
      throw Error("Folder contents differ from the original.");
    if (!second.files) throw Error("Empty folders are not collected.");
    await checkStreams(
      [
        ...first.checks.map(([relative]) => path.join(original, relative)),
        ...second.checks.map(([relative]) => path.join(copy, relative)),
      ],
      signal,
    );
    // A file can change without updating its parent directory timestamp.
    for (const [folder, record] of [
      [original, first],
      [copy, second],
    ]) {
      await safeAncestors(folder);
      for (const [relative, ...stamp] of record.checks) {
        const current = await fs.lstat(path.join(folder, relative));
        if (
          current.isSymbolicLink() ||
          JSON.stringify(identity(current)) !== JSON.stringify(stamp)
        )
          throw Error("Folder contents changed during comparison.");
      }
    }
    return { original, first, second };
  }
  return {
    async scan(signal) {
      const found = [],
        skipped = [];
      const budget = { entries: 0, bytes: 0 };
      if (!root) return { found, skipped, visited: 0, cancelled: false };
      try {
        await safeAncestors(root);
        const entries = await fs.opendir(root);
        for await (const entry of entries) {
          if (signal?.aborted) break;
          if (++budget.entries >= maxEntries) break;
          if (!entry.isDirectory() || !COPY.test(entry.name)) continue;
          const copy = path.join(root, entry.name);
          try {
            const result = await compare(copy, budget, signal),
              s = result.second.metadata;
            found.push({
              id: randomUUID(),
              path: copy,
              root,
              category: "duplicate-downloads",
              size: result.second.bytes,
              mtimeMs: s.mtimeMs,
              ctimeMs: s.ctimeMs,
              birthtimeMs: s.birthtimeMs,
              ino: String(s.ino),
              dev: String(s.dev),
              duplicate: {
                original: result.original,
                digest: result.second.digest,
                copyFingerprint: result.second.fingerprint,
                originalFingerprint: result.first.fingerprint,
                fileCount: result.second.files,
              },
            });
          } catch (error) {
            skipped.push({ path: copy, reason: error.message });
          }
          if (budget.entries >= maxEntries || budget.bytes >= maxBytes) break;
        }
      } catch (error) {
        if (error.code !== "ENOENT")
          skipped.push({ path: root, reason: error.message });
      }
      return {
        found: signal?.aborted ? [] : found,
        skipped,
        visited: budget.entries,
        cancelled: !!signal?.aborted,
        limited: budget.entries >= maxEntries || budget.bytes >= maxBytes,
      };
    },
    async verify(item) {
      const original = originalFor(item.path);
      if (item.root !== root || original !== item.duplicate?.original)
        throw Error("Invalid duplicate folder record.");
      const result = await compare(item.path, { entries: 0, bytes: 0 });
      if (
        result.second.digest !== item.duplicate.digest ||
        result.second.fingerprint !== item.duplicate.copyFingerprint ||
        result.first.fingerprint !== item.duplicate.originalFingerprint ||
        item.size !== result.second.bytes
      )
        throw Error("Copy or original changed since collection. Scan again.");
      return result.second.metadata;
    },
  };
}
module.exports = { createDuplicateFolders };
