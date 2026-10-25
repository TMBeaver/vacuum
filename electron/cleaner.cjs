"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const DAY = 24 * 60 * 60 * 1000;
const LIMIT = 50_000;
const TEMP_EXTENSIONS = new Set([".tmp", ".temp", ".log"]);

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

/** A bin is a persisted list of references. Scanning never moves or deletes a file. */
function createCleaner({
  userData,
  tempRoot,
  localAppData,
  downloadsRoot,
  trashItem,
  onProgress = () => {},
}) {
  if (!userData || typeof trashItem !== "function")
    throw new TypeError("userData and trashItem are required.");
  const storage = path.resolve(userData);
  const manifestPath = path.join(storage, "bin.json");
  const roots = [
    tempRoot && {
      path: path.resolve(tempRoot),
      category: "temporary",
      days: 7,
    },
    localAppData && {
      path: path.resolve(localAppData, "CrashDumps"),
      category: "crash-dumps",
      days: 30,
    },
    downloadsRoot && {
      path: path.resolve(downloadsRoot),
      category: "old-downloads",
      days: 180,
    },
  ].filter(Boolean);
  let records = [];
  let candidates = new Map();
  let queue = Promise.resolve();
  let closed = false;

  const ready = (async () => {
    await fs.mkdir(storage, { recursive: true });
    try {
      const data = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      if (!data || data.version !== 1 || !Array.isArray(data.files))
        throw new Error("Invalid bin manifest.");
      records = data.files.filter(validRecord).slice(0, LIMIT);
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(`Could not read Vacuum's bin: ${error.message}`);
    }
  })();

  function validRecord(item) {
    return (
      item &&
      typeof item.id === "string" &&
      typeof item.path === "string" &&
      typeof item.root === "string" &&
      typeof item.category === "string" &&
      Number.isFinite(item.size) &&
      item.size >= 0 &&
      Number.isFinite(item.mtimeMs) &&
      Number.isFinite(item.ctimeMs) &&
      Number.isFinite(item.birthtimeMs) &&
      typeof item.ino === "string" &&
      typeof item.dev === "string" &&
      roots.some(
        (root) =>
          root.path === item.root &&
          root.category === item.category &&
          inside(root.path, item.path),
      ) &&
      !inside(storage, item.path)
    );
  }

  function run(operation) {
    const next = queue.then(async () => {
      await ready;
      return operation();
    });
    queue = next.catch(() => {});
    return next;
  }

  async function save(next) {
    const temporary = `${manifestPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(
        temporary,
        JSON.stringify({ version: 1, files: next }, null, 2),
        { mode: 0o600, flag: "wx" },
      );
      await fs.rename(temporary, manifestPath);
      records = next;
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }

  function publicFile(item) {
    return {
      id: item.id,
      path: item.path,
      name: path.basename(item.path),
      size: item.size,
      mtimeMs: item.mtimeMs,
      category: item.category,
      reason:
        item.category === "temporary"
          ? "Temporary file · unchanged for over 7 days"
          : item.category === "crash-dumps"
            ? "Crash dump · unchanged for over 30 days"
            : "Download · unchanged for over 180 days · selected by you",
    };
  }

  function bin() {
    return {
      files: records.map(publicFile),
      bytes: records.reduce((sum, item) => sum + item.size, 0),
      count: records.length,
    };
  }

  // Check every ancestor, including the configured root, to reject junctions and
  // symlinks. A root's string prefix alone does not establish containment.
  async function safeFile(filename, root) {
    filename = path.resolve(filename);
    if (
      !inside(root.path, filename) ||
      filename === root.path ||
      inside(storage, filename)
    )
      throw new Error("Outside an allowed cleaning location.");
    const parsed = path.parse(filename);
    let current = parsed.root;
    const pieces = filename
      .slice(parsed.root.length)
      .split(path.sep)
      .filter(Boolean);
    for (let index = 0; index < pieces.length; index++) {
      current = path.join(current, pieces[index]);
      const metadata = await fs.lstat(current);
      if (metadata.isSymbolicLink())
        throw new Error("Linked files and folders are protected.");
      if (index < pieces.length - 1 && !metadata.isDirectory())
        throw new Error("An ancestor is no longer a folder.");
      if (
        index === pieces.length - 1 &&
        (!metadata.isFile() || metadata.nlink > 1)
      )
        throw new Error("Only ordinary, unlinked files can enter the bin.");
    }
    const [realRoot, realFile, metadata] = await Promise.all([
      fs.realpath(root.path),
      fs.realpath(filename),
      fs.stat(filename),
    ]);
    if (!inside(realRoot, realFile))
      throw new Error("Resolved file is outside its cleaning location.");
    return metadata;
  }

  function snapshot(filename, root, metadata) {
    return {
      id: randomUUID(),
      path: filename,
      root: root.path,
      category: root.category,
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
      ctimeMs: metadata.ctimeMs,
      birthtimeMs: metadata.birthtimeMs,
      ino: String(metadata.ino),
      dev: String(metadata.dev),
    };
  }

  function eligible(filename, root, metadata) {
    if (Date.now() - metadata.mtimeMs <= root.days * DAY) return false;
    const extension = path.extname(filename).toLowerCase();
    if (root.category === "temporary") return TEMP_EXTENSIONS.has(extension);
    if (root.category === "crash-dumps") return extension === ".dmp";
    return true;
  }

  async function walk(selectedRoots, signal) {
    const coverage = {
      visited: 0,
      skipped: 0,
      limited: false,
      cancelled: false,
      errors: 0,
    };
    const found = [];
    let lastUpdate = 0;
    const seen = new Set();
    for (const root of selectedRoots) {
      const pending = [root.path];
      while (pending.length) {
        if (signal?.aborted || closed) {
          coverage.cancelled = true;
          break;
        }
        if (coverage.visited >= LIMIT) {
          coverage.limited = true;
          break;
        }
        const directory = pending.pop();
        if (inside(storage, directory)) {
          coverage.skipped++;
          continue;
        }
        try {
          // Do not recurse through a junction even when it is the scan root.
          const info = await fs.lstat(directory);
          if (!info.isDirectory() || info.isSymbolicLink()) {
            coverage.skipped++;
            continue;
          }
          const entries = await fs.opendir(directory);
          for await (const entry of entries) {
            if (signal?.aborted || closed) {
              coverage.cancelled = true;
              break;
            }
            if (coverage.visited >= LIMIT) {
              coverage.limited = true;
              break;
            }
            coverage.visited++;
            const filename = path.join(directory, entry.name);
            if (inside(storage, filename) || entry.isSymbolicLink()) {
              coverage.skipped++;
              continue;
            }
            if (entry.isDirectory()) {
              pending.push(filename);
              continue;
            }
            if (!entry.isFile() || seen.has(filename)) continue;
            try {
              const metadata = await safeFile(filename, root);
              if (eligible(filename, root, metadata)) {
                found.push(snapshot(filename, root, metadata));
                seen.add(filename);
              }
            } catch {
              coverage.skipped++;
            }
            if (Date.now() - lastUpdate > 160) {
              lastUpdate = Date.now();
              onProgress({
                visited: coverage.visited,
                found: found.length,
                bytes: found.reduce((total, file) => total + file.size, 0),
                category: root.category,
              });
            }
          }
        } catch (error) {
          if (error.code !== "ENOENT") coverage.errors++;
        }
        if (coverage.cancelled || coverage.limited) break;
      }
      if (coverage.cancelled || coverage.limited) break;
    }
    if (signal?.aborted || closed) coverage.cancelled = true;
    return { found, coverage };
  }

  async function verify(item) {
    if (!validRecord(item)) throw new Error("Invalid bin record.");
    const root = roots.find(
      (root) => root.path === item.root && root.category === item.category,
    );
    const metadata = await safeFile(item.path, root);
    if (!eligible(item.path, root, metadata))
      throw new Error("File no longer matches its cleaning rule.");
    if (
      metadata.size !== item.size ||
      metadata.mtimeMs !== item.mtimeMs ||
      metadata.ctimeMs !== item.ctimeMs ||
      metadata.birthtimeMs !== item.birthtimeMs ||
      String(metadata.ino) !== item.ino ||
      String(metadata.dev) !== item.dev
    ) {
      throw new Error(
        "File changed since collection. Scan again before emptying it.",
      );
    }
  }

  return {
    getBin: () => run(() => bin()),
    scan: ({ signal } = {}) =>
      run(async () => {
        const { found, coverage } = await walk(
          roots.filter((root) => root.category !== "old-downloads"),
          signal,
        );
        if (coverage.cancelled) return { ...bin(), added: 0, coverage };
        const existing = new Set(records.map((file) => file.path));
        const fresh = new Map(found.map((file) => [file.path, file]));
        const refreshed = records.map((file) =>
          file.category !== "old-downloads" && fresh.has(file.path)
            ? { ...fresh.get(file.path), id: file.id }
            : file,
        );
        const pending = found.filter((file) => !existing.has(file.path));
        const additions = pending.slice(
          0,
          Math.max(0, LIMIT - refreshed.length),
        );
        if (pending.length > additions.length) coverage.limited = true;
        await save([...refreshed, ...additions]);
        return { ...bin(), added: additions.length, coverage };
      }),
    reviewOldFiles: () =>
      run(async () => {
        const { found, coverage } = await walk(
          roots.filter((root) => root.category === "old-downloads"),
        );
        candidates = new Map(found.map((item) => [item.id, item]));
        const existing = new Set(records.map((file) => file.path));
        const files = found
          .filter((file) => !existing.has(file.path))
          .map((item) => ({
            ...publicFile(item),
            reason:
              "Download · unchanged for over 180 days · review before collecting",
          }));
        return {
          files,
          count: files.length,
          bytes: files.reduce((sum, file) => sum + file.size, 0),
          coverage,
        };
      }),
    collectOldFiles: (ids) =>
      run(async () => {
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
          throw new TypeError("Select files by their review IDs.");
        const additions = [];
        const skipped = [];
        const existing = new Set(records.map((file) => file.path));
        for (const id of new Set(ids)) {
          const item = candidates.get(id);
          if (!item) {
            skipped.push({
              id,
              reason: "Review expired. Review old downloads again.",
            });
            continue;
          }
          if (existing.has(item.path)) continue;
          try {
            await verify(item);
            additions.push(item);
            existing.add(item.path);
          } catch (error) {
            skipped.push({ id, reason: error.message });
          }
        }
        const accepted = additions.slice(
          0,
          Math.max(0, LIMIT - records.length),
        );
        for (const item of additions.slice(accepted.length))
          skipped.push({
            id: item.id,
            reason: "Bin capacity reached. Empty or release files first.",
          });
        await save([...records, ...accepted]);
        return { ...bin(), added: accepted.length, skipped };
      }),
    emptyBin: (ids) =>
      run(async () => {
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
          throw new TypeError("Select bin IDs to recycle.");
        const selected = new Set(ids);
        let trashed = 0;
        let bytes = 0;
        const skipped = [];
        for (const item of [...records]) {
          if (!selected.has(item.id)) continue;
          try {
            await verify(item);
            // There is deliberately no unlink/rm fallback: Recycle Bin failure
            // must leave the user's file in place. OS path APIs have a small
            // unavoidable check-to-use race; no stronger atomic claim is made.
            await trashItem(path.resolve(item.path));
            trashed++;
            bytes += item.size;
          } catch (error) {
            skipped.push({ id: item.id, reason: error.message });
            continue;
          }
          await save(records.filter((record) => record.id !== item.id));
        }
        return { trashed, bytes, skipped, bin: bin() };
      }),
    release: (ids) =>
      run(async () => {
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
          throw new TypeError("Select bin IDs to release.");
        const selected = new Set(ids);
        await save(records.filter((item) => !selected.has(item.id)));
        return bin();
      }),
    close: () => {
      closed = true;
    },
  };
}

module.exports = { createCleaner };
