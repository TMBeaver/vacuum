const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createCleaner } = require("../electron/cleaner.cjs");
const {
  createBrowserGuard,
  parseProcessNames,
  recognizeCacheRoot,
} = require("../electron/browser-cache.cjs");

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vacuum-browser-unit-"));
  const local = path.join(root, "local");
  const recycled = [];
  let processes = new Set(),
    unavailable = false;
  const config = {
    userData: path.join(root, "state"),
    tempRoot: path.join(root, "temp"),
    localAppData: local,
    trashItem: async (filename) => {
      recycled.push(filename);
    },
    assertBrowserClosed: createBrowserGuard({
      ttlMs: 0,
      read: async () => {
        if (unavailable) throw Error("unavailable");
        return processes;
      },
    }),
  };
  await fs.mkdir(config.tempRoot);
  const file = async (relative, days = 10) => {
    const filename = path.join(local, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(
      filename,
      "Synthetic cache fixture; preserve these contents.",
    );
    const age = new Date(Date.now() - days * 86400000);
    await fs.utimes(filename, age, age);
    return filename;
  };
  return {
    root,
    local,
    config,
    recycled,
    file,
    engine: createCleaner(config),
    running: (value) => {
      processes = new Set(value);
    },
    failDetection: () => {
      unavailable = true;
    },
  };
}
const chrome = "Google/Chrome/User Data/Default/";
const edge = "Microsoft/Edge/User Data/Profile 2/";

test("only aged network/code caches enter the bin; profile data and recent cache stay intact", async () => {
  const f = await fixture();
  const expected = await Promise.all([
    f.file(chrome + "Cache/Cache_Data/network-data"),
    f.file(chrome + "Code Cache/js/compiled-script"),
    f.file(chrome + "Code Cache/wasm/compiled-module"),
    f.file(edge + "Cache/Cache_Data/edge-data"),
  ]);
  const protectedPaths = await Promise.all([
    f.file(chrome + "Cache/Cache_Data/recent", 1),
    ...[
      "Cookies",
      "Network/Cookies",
      "Login Data",
      "Sessions/Session_1",
      "Extensions/component/state",
      "Service Worker/CacheStorage/offline",
      "Local Storage/site",
      "Cache/unrecognized-sibling",
    ].map((name) => f.file(chrome + name, 300)),
    f.file(
      "Google/Chrome/User Data/Custom profile/Cache/Cache_Data/unknown",
      300,
    ),
  ]);
  const result = await f.engine.scan();
  assert.deepEqual(
    new Set(result.files.map((file) => file.path)),
    new Set(expected),
  );
  assert.ok(
    result.files.every(
      (file) => file.category === "browser-cache" && file.browser,
    ),
  );
  assert.deepEqual(f.recycled, []);
  for (const filename of [...expected, ...protectedPaths])
    assert.match(
      await fs.readFile(filename, "utf8"),
      /Synthetic cache fixture/,
    );
});

test("a running browser is skipped independently while closed-browser caches remain eligible", async () => {
  const f = await fixture();
  await f.file(chrome + "Cache/Cache_Data/chrome-data");
  const eligible = await f.file(edge + "Cache/Cache_Data/edge-data");
  f.running(["chrome.exe"]);
  const result = await f.engine.scan();
  assert.equal(result.count, 1);
  assert.equal(result.files[0].path, eligible);
  assert.deepEqual(
    result.coverage.protectedBrowsers.map((item) => item.browser),
    ["chrome"],
  );
});

test("reopening a browser after collection blocks recycling, including after restart", async () => {
  const f = await fixture();
  const filename = await f.file(chrome + "Cache/Cache_Data/old-cache");
  const result = await f.engine.scan();
  f.running(["chrome.exe"]);
  let nativeCalls = 0;
  const compact = async () => {
    nativeCalls++;
    throw Error("must not run");
  };
  compact.inspect = compact;
  const restarted = createCleaner({ ...f.config, compactFiles: compact });
  const blocked = await restarted.emptyBin([result.files[0].id]);
  assert.equal(blocked.trashed, 0);
  assert.match(blocked.skipped[0].reason, /close Chrome/);
  assert.deepEqual(f.recycled, []);
  assert.equal((await restarted.compactBin([result.files[0].id])).changed, 0);
  assert.equal(nativeCalls, 0);
  assert.match(await fs.readFile(filename, "utf8"), /Synthetic/);
  f.running([]);
  assert.equal((await restarted.emptyBin([result.files[0].id])).trashed, 1);
  assert.deepEqual(f.recycled, [filename]);
});

test("process detection failure leaves cache untouched and does not block ordinary temp scanning", async () => {
  const f = await fixture();
  await f.file(chrome + "Cache/Cache_Data/old-cache");
  const temporary = path.join(f.config.tempRoot, "old.tmp");
  await fs.writeFile(temporary, "kept");
  const age = new Date(Date.now() - 10 * 86400000);
  await fs.utimes(temporary, age, age);
  f.failDetection();
  const result = await f.engine.scan();
  assert.equal(result.count, 1);
  assert.equal(result.files[0].path, temporary);
  assert.match(
    result.coverage.protectedBrowsers[0].reason,
    /could not be checked/,
  );
});

test("cache junctions cannot widen the allowlist", async () => {
  const f = await fixture();
  const outside = path.join(f.root, "outside");
  await fs.mkdir(outside);
  const filename = path.join(outside, "personal-file");
  await fs.writeFile(filename, "keep outside");
  const age = new Date(Date.now() - 300 * 86400000);
  await fs.utimes(filename, age, age);
  const parent = path.join(f.local, chrome, "Cache");
  await fs.mkdir(parent, { recursive: true });
  await fs.symlink(outside, path.join(parent, "Cache_Data"), "junction");
  const result = await f.engine.scan();
  assert.equal(result.count, 0);
  assert.equal(result.coverage.visited, 0);
  assert.equal(await fs.readFile(filename, "utf8"), "keep outside");
});

test("new standard profiles are discovered on a later scan without restarting", async () => {
  const f = await fixture();
  assert.equal((await f.engine.scan()).count, 0);
  await f.file(edge + "Code Cache/js/new-profile-cache");
  assert.equal((await f.engine.scan()).count, 1);
});

test("temporarily unavailable cache profiles retain their bin references after restart", async () => {
  const f = await fixture();
  await f.file(edge + "Cache/Cache_Data/retained-reference");
  const bin = await f.engine.scan();
  const profile = path.join(
    f.local,
    "Microsoft",
    "Edge",
    "User Data",
    "Profile 2",
  );
  await fs.rename(profile, `${profile}-retained-by-test`);
  const restarted = createCleaner(f.config);
  assert.equal((await restarted.getBin()).files[0].id, bin.files[0].id);
  assert.equal((await restarted.emptyBin([bin.files[0].id])).trashed, 0);
  assert.deepEqual(f.recycled, []);
  await fs.rename(`${profile}-retained-by-test`, profile);
});

test("native CSV parsing uses exact case-insensitive process names and fails closed on invalid output", async () => {
  assert.deepEqual(
    [
      ...parseProcessNames(
        '"Chrome.EXE","123","Console","1","12,000 K"\r\n"msedge.exe","124","Console","1","2,000 K"',
      ),
    ],
    ["chrome.exe", "msedge.exe"],
  );
  assert.throws(() => parseProcessNames("unavailable"), /unavailable/);
  const guard = createBrowserGuard({
    read: async () => new Set(["notchrome.exe", "msedge.exe"]),
  });
  await guard("chrome");
  await assert.rejects(guard("edge"), /close Edge/);
  await assert.rejects(guard("unknown"), /Unknown browser/);
});

test("persisted roots cannot expand cache rules to profile or external data", () => {
  const local = path.join(os.tmpdir(), "vacuum-root-recognition", "local");
  assert.equal(
    recognizeCacheRoot(local, path.join(local, chrome, "Cache/Cache_Data"))
      .browser,
    "chrome",
  );
  for (const relative of [
    "Cookies",
    "Sessions",
    "Code Cache",
    "Code Cache/js/extra",
    "Cache",
    "Service Worker/CacheStorage",
  ])
    assert.equal(
      recognizeCacheRoot(local, path.join(local, chrome, relative)),
      null,
    );
  assert.equal(
    recognizeCacheRoot(
      local,
      path.join(local, "Google/Chrome/User Data/Custom/Cache/Cache_Data"),
    ),
    null,
  );
  assert.equal(
    recognizeCacheRoot(
      local,
      path.join(local, "../outside/Default/Cache/Cache_Data"),
    ),
    null,
  );
});
