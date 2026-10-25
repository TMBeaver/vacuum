"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { writeAtomicJson } = require("./atomic-json.cjs");
const {
  discoverBrowserCaches,
  recognizeCacheRoot,
} = require("./browser-cache.cjs");

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
  compactFiles,
  assertBrowserClosed,
  onProgress = () => {},
}) {
  if (!userData || typeof trashItem !== "function")
    throw new TypeError("userData and trashItem are required.");
  const storage = path.resolve(userData);
  const manifestPath = path.join(storage, "bin.json");
  const journalPath = path.join(storage, "compression-journal.json");
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
  let recovery = { recovered: 0, needsReview: 0, pending: false };
  let pendingRecords = new Set();
  let recoveryBlocked = false;
  let browserDiscoveryErrors = 0;

  async function refreshBrowserRoots() {
    const discovery = await discoverBrowserCaches(localAppData);
    browserDiscoveryErrors = discovery.errors;
    const known = new Set(roots.map((root) => root.path));
    for (const root of discovery.roots)
      if (!known.has(root.path)) roots.push(root);
  }
  async function guard(root) {
    if (!root.browser) return;
    if (typeof assertBrowserClosed !== "function")
      throw Error(
        `${root.label} cache skipped: browser status could not be checked.`,
      );
    await assertBrowserClosed(root.browser);
  }

  const ready = (async () => {
    await fs.mkdir(storage, { recursive: true });
    await refreshBrowserRoots();
    try {
      const data = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      if (!data || data.version !== 1 || !Array.isArray(data.files))
        throw new Error("Invalid bin manifest.");
      // Retain references and Undo metadata even if a profile is temporarily
      // unavailable. Reconstruct only exact recognized cache roots, never paths
      // supplied by the renderer or arbitrary manifest locations.
      for (const item of data.files.slice(0, LIMIT)) {
        const root =
          item?.category === "browser-cache" &&
          recognizeCacheRoot(localAppData, item.root);
        if (root && !roots.some((known) => known.path === root.path))
          roots.push(root);
      }
      records = data.files.filter(validRecord).slice(0, LIMIT);
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(`Could not read Vacuum's bin: ${error.message}`);
    }
    await recoverCompression();
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
    await writeAtomicJson(manifestPath, { version: 1, files: next });
    records = next;
  }

  function validPrepared(item) {
    return (
      item &&
      validRecord(item.record) &&
      item.prepared?.ok === true &&
      item.prepared.verified === true &&
      typeof item.prepared.compressed === "boolean" &&
      Number.isSafeInteger(item.prepared.beforeBytes) &&
      item.prepared.beforeBytes >= 0 &&
      /^[a-f0-9]{64}$/.test(item.prepared.sha256) &&
      typeof item.compress === "boolean"
    );
  }
  async function archiveJournal() {
    await fs.rename(
      journalPath,
      path.join(storage, "compression-journal.last.json"),
    );
    pendingRecords.clear();
  }
  async function recoverCompression() {
    let journal;
    try {
      journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return recovery;
      recoveryBlocked = true;
      return (recovery = {
        recovered: 0,
        needsReview: 1,
        pending: true,
        error:
          "Compression recovery journal could not be read. Files are protected until metadata is reviewed.",
      });
    }
    if (
      !journal ||
      journal.version !== 1 ||
      !Array.isArray(journal.items) ||
      journal.items.length > 64 ||
      !journal.items.every(validPrepared)
    ) {
      recoveryBlocked = true;
      return (recovery = {
        recovered: 0,
        needsReview: 1,
        pending: true,
        error:
          "Compression recovery journal is invalid. No file was changed by recovery.",
      });
    }
    pendingRecords = new Set(journal.items.map((item) => item.record.id));
    if (typeof compactFiles?.inspect !== "function") {
      recoveryBlocked = true;
      return (recovery = {
        recovered: 0,
        needsReview: journal.items.length,
        pending: true,
        error: "Windows compression inspection is unavailable.",
      });
    }
    const safe = [],
      problems = [];
    const next = [...records];
    for (const item of journal.items) {
      const existing = records.find(
        (record) =>
          record.id === item.record.id && record.path === item.record.path,
      );
      if (!existing) continue;
      try {
        const root = roots.find(
            (root) =>
              root.path === item.record.root &&
              root.category === item.record.category,
          ),
          metadata = await safeFile(item.record.path, root);
        if (
          metadata.size !== item.record.size ||
          String(metadata.ino) !== item.record.ino ||
          String(metadata.dev) !== item.record.dev ||
          metadata.birthtimeMs !== item.record.birthtimeMs
        )
          throw Error(
            "File identity changed during an interrupted pass. Kept for review.",
          );
        safe.push({
          ...item,
          current: {
            ...snapshot(item.record.path, root, metadata),
            id: item.record.id,
          },
        });
      } catch (error) {
        problems.push({ id: item.record.id, reason: error.message });
      }
    }
    let inspected = [];
    try {
      if (safe.length)
        inspected = await compactFiles.inspect(
          safe.map((item) => item.current),
        );
    } catch (error) {
      recoveryBlocked = true;
      return (recovery = {
        recovered: 0,
        needsReview: safe.length,
        pending: true,
        error: `Recovery inspection failed: ${error.message}`,
      });
    }
    let recovered = 0;
    for (const item of safe) {
      const current = inspected.find((result) => result.id === item.record.id);
      if (
        !current?.ok ||
        current.verified !== true ||
        current.sha256 !== item.prepared.sha256 ||
        !Number.isSafeInteger(current.beforeBytes) ||
        current.beforeBytes < 0 ||
        typeof current.compressed !== "boolean"
      ) {
        problems.push({
          id: item.record.id,
          reason:
            current?.reason ||
            "Contents could not be verified after interruption. Kept for review.",
        });
        continue;
      }
      const originalBaseline =
        item.prepared.beforeBytes +
        (item.record.compaction?.managed
          ? item.record.compaction.savedBytes || 0
          : 0);
      const managed =
        current.compressed &&
        (item.record.compaction?.managed ||
          (!item.prepared.compressed && item.compress));
      next[next.findIndex((record) => record.id === item.record.id)] = {
        ...item.current,
        compaction: {
          managed: !!managed,
          savedBytes: managed
            ? Math.max(0, originalBaseline - current.beforeBytes)
            : 0,
          sha256: current.sha256,
        },
      };
      recovered++;
    }
    for (const problem of problems) {
      const index = next.findIndex((record) => record.id === problem.id);
      if (index >= 0)
        next[index] = {
          ...next[index],
          compaction: {
            ...next[index].compaction,
            recoveryProblem: problem.reason,
          },
        };
    }
    await save(next);
    await archiveJournal();
    recoveryBlocked = false;
    return (recovery = {
      recovered,
      needsReview: problems.length,
      pending: false,
      problems,
    });
  }

  function publicFile(item) {
    const root = roots.find((root) => root.path === item.root);
    const browser = root?.label;
    return {
      id: item.id,
      path: item.path,
      name: path.basename(item.path),
      size: item.size,
      mtimeMs: item.mtimeMs,
      compacted:
        item.compaction?.managed === true && !item.compaction?.recoveryProblem,
      recoveryProblem: item.compaction?.recoveryProblem,
      category: item.category,
      browser,
      reason:
        Date.now() - item.mtimeMs <= root?.days * DAY
          ? "Recently updated · kept in place · not eligible for recycling"
          : item.category === "temporary"
            ? "Temporary file · unchanged for over 7 days"
            : item.category === "browser-cache"
              ? `${browser || "Browser"} cache · unchanged for over 7 days · browser must be closed`
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
  async function safeFile(filename, root, directory = false) {
    filename = path.resolve(filename);
    if (
      !inside(root.path, filename) ||
      (filename === root.path && !directory) ||
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
        (directory
          ? !metadata.isDirectory()
          : !metadata.isFile() || metadata.nlink > 1)
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
      protectedBrowsers: [],
    };
    const found = [];
    let lastUpdate = 0;
    const seen = new Set();
    for (const root of selectedRoots) {
      try {
        await safeFile(root.path, root, true);
      } catch (error) {
        if (error.code !== "ENOENT") {
          coverage.skipped++;
          if (error.code) coverage.errors++;
        }
        continue;
      }
      try {
        await guard(root);
      } catch (error) {
        if (
          !coverage.protectedBrowsers.some(
            (item) => item.browser === root.browser,
          )
        )
          coverage.protectedBrowsers.push({
            browser: root.browser,
            reason: error.message,
          });
        continue;
      }
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
              const extension = path.extname(filename).toLowerCase();
              if (
                root.category === "temporary" &&
                !TEMP_EXTENSIONS.has(extension)
              )
                continue;
              if (root.category === "crash-dumps" && extension !== ".dmp")
                continue;
              const preliminary = await fs.lstat(filename);
              if (
                !preliminary.isFile() ||
                !eligible(filename, root, preliminary)
              )
                continue;
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

  async function verify(item, { undo = false } = {}) {
    if (!validRecord(item)) throw new Error("Invalid bin record.");
    if (
      recoveryBlocked ||
      pendingRecords.has(item.id) ||
      item.compaction?.recoveryProblem
    )
      throw Error(
        "An interrupted compression pass needs verification. Files are kept in place.",
      );
    const root = roots.find(
      (root) => root.path === item.root && root.category === item.category,
    );
    await guard(root);
    const metadata = await safeFile(item.path, root);
    if (undo) {
      if (item.compaction?.managed !== true)
        throw Error("This file was not compressed by Vacuum.");
      if (
        String(metadata.ino) !== item.ino ||
        String(metadata.dev) !== item.dev ||
        metadata.birthtimeMs !== item.birthtimeMs
      )
        throw Error(
          "File identity changed. Undo cannot be applied to a replacement file.",
        );
      return metadata;
    }
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
    return metadata;
  }

  return {
    getBin: () => run(() => bin()),
    getRecovery: () => run(() => recovery),
    recoverCompaction: () =>
      run(async () => {
        await recoverCompression();
        return { ...bin(), recovery };
      }),
    scan: ({ signal } = {}) =>
      run(async () => {
        await refreshBrowserRoots();
        const { found, coverage } = await walk(
          roots.filter((root) => root.category !== "old-downloads"),
          signal,
        );
        coverage.errors += browserDiscoveryErrors;
        if (coverage.cancelled) return { ...bin(), added: 0, coverage };
        const existing = new Set(records.map((file) => file.path));
        const fresh = new Map(found.map((file) => [file.path, file]));
        const refreshed = records.map((file) =>
          file.category !== "old-downloads" && fresh.has(file.path)
            ? {
                ...fresh.get(file.path),
                id: file.id,
                compaction:
                  file.ino === fresh.get(file.path).ino &&
                  file.dev === fresh.get(file.path).dev &&
                  file.birthtimeMs === fresh.get(file.path).birthtimeMs
                    ? file.compaction
                    : undefined,
              }
            : file,
        );
        const pending = found.filter((file) => !existing.has(file.path));
        const additions = pending.slice(
          0,
          Math.max(0, LIMIT - refreshed.length),
        );
        if (pending.length > additions.length) coverage.limited = true;
        await save([...refreshed, ...additions]);
        return {
          ...bin(),
          added: additions.length,
          found: found.length,
          coverage,
        };
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
    compactBin: (ids, compress = true) =>
      run(async () => {
        if (pendingRecords.size || recoveryBlocked) {
          await recoverCompression();
          if (recoveryBlocked) throw Error(recovery.error);
        }
        if (!compactFiles)
          throw Error("Reversible compression is unavailable.");
        if (
          !Array.isArray(ids) ||
          ids.length > 64 ||
          ids.some((id) => typeof id !== "string")
        )
          throw Error("Select up to 64 bin files for a reversible pass.");
        const selected = new Set(ids),
          eligibleItems = [],
          skipped = [];
        for (const item of records.filter((item) => selected.has(item.id))) {
          try {
            const metadata = await verify(item, { undo: !compress });
            const root = roots.find(
              (root) =>
                root.path === item.root && root.category === item.category,
            );
            eligibleItems.push(
              compress
                ? item
                : {
                    ...snapshot(item.path, root, metadata),
                    id: item.id,
                    compaction: item.compaction,
                  },
            );
          } catch (error) {
            skipped.push({ id: item.id, reason: error.message });
          }
        }
        if (eligibleItems.length && typeof compactFiles.inspect !== "function")
          throw Error("Safe compression inspection is unavailable.");
        const preparation = eligibleItems.length
          ? await compactFiles.inspect(eligibleItems)
          : [];
        const preparedItems = [];
        for (const record of eligibleItems) {
          const prepared = preparation.find(
            (result) => result.id === record.id,
          );
          if (validPrepared({ record, prepared, compress })) {
            const saved = record.compaction?.savedBytes;
            const sameContents = record.compaction?.sha256 === prepared.sha256;
            const currentRecord = record.compaction
              ? {
                  ...record,
                  compaction: {
                    ...record.compaction,
                    savedBytes:
                      sameContents && Number.isSafeInteger(saved) && saved >= 0
                        ? saved
                        : 0,
                  },
                }
              : record;
            preparedItems.push({ record: currentRecord, prepared, compress });
          } else
            skipped.push({
              id: record.id,
              reason: prepared?.reason || "File could not be prepared safely.",
            });
        }
        if (preparedItems.length) {
          await writeAtomicJson(journalPath, {
            version: 1,
            time: new Date().toISOString(),
            items: preparedItems,
          });
          pendingRecords = new Set(preparedItems.map((item) => item.record.id));
          recovery = { recovered: 0, needsReview: 0, pending: true };
        }
        const results = preparedItems.length
          ? await compactFiles(
              preparedItems.map(({ record, prepared }) => ({
                ...record,
                expectedSha256: prepared.sha256,
                expectedWasCompressed: prepared.compressed,
              })),
              compress,
            )
          : [];
        let changed = 0,
          bytesSaved = 0,
          bytesExpanded = 0;
        const next = [...records];
        for (const { record: item } of preparedItems) {
          const result = results.find((result) => result.id === item.id);
          const planned = preparedItems.find(
            (plan) => plan.record.id === item.id,
          );
          if (
            !planned ||
            result?.sha256 !== planned.prepared.sha256 ||
            !result?.ok ||
            result.verified !== true ||
            !Number.isSafeInteger(result.beforeBytes) ||
            !Number.isSafeInteger(result.afterBytes) ||
            result.beforeBytes < 0 ||
            result.afterBytes < 0
          ) {
            skipped.push({
              id: item.id,
              reason: result?.reason || "Windows did not verify this file.",
            });
            continue;
          }
          try {
            const root = roots.find(
              (root) =>
                root.path === item.root && root.category === item.category,
            );
            const metadata = await safeFile(item.path, root);
            if (
              metadata.size !== item.size ||
              String(metadata.ino) !== item.ino ||
              String(metadata.dev) !== item.dev ||
              metadata.birthtimeMs !== item.birthtimeMs
            )
              throw Error("File identity changed; kept for review.");
            const wasManaged = item.compaction?.managed === true;
            const managed = compress
              ? wasManaged || (!result.wasCompressed && result.compressed)
              : false;
            const updated = {
              ...snapshot(item.path, root, metadata),
              id: item.id,
              compaction: {
                managed,
                savedBytes: managed
                  ? Math.max(0, result.beforeBytes - result.afterBytes) +
                    (item.compaction?.savedBytes || 0)
                  : 0,
                sha256: result.sha256,
              },
            };
            next[next.findIndex((record) => record.id === item.id)] = updated;
            changed += Number(result.wasCompressed !== result.compressed);
            bytesSaved += Math.max(0, result.beforeBytes - result.afterBytes);
            bytesExpanded += Math.max(
              0,
              result.afterBytes - result.beforeBytes,
            );
          } catch (error) {
            skipped.push({ id: item.id, reason: error.message });
          }
        }
        await save(next);
        if (preparedItems.length) {
          if (
            skipped.some((problem) =>
              preparedItems.some((plan) => plan.record.id === problem.id),
            )
          )
            await recoverCompression();
          else {
            await archiveJournal();
            recovery = { recovered: 0, needsReview: 0, pending: false };
          }
        }
        return {
          changed,
          bytesSaved,
          bytesExpanded,
          verifiedFiles: results.filter((r) => r.ok && r.verified).length,
          files: results.map(
            ({
              id,
              ok,
              beforeBytes,
              afterBytes,
              wasCompressed,
              compressed,
              verified,
              sha256,
              reason,
            }) => ({
              id,
              ok,
              beforeBytes,
              afterBytes,
              wasCompressed,
              compressed,
              verified,
              sha256,
              reason,
            }),
          ),
          skipped,
          bin: bin(),
        };
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
