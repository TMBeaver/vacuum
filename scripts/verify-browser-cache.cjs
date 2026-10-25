const { _electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createBrowserGuard } = require("../electron/browser-cache.cjs");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = async (filename) =>
  createHash("sha256")
    .update(await fs.readFile(filename))
    .digest("hex");
async function recycleFixture(originalPath, action) {
  const script = await fs.readFile(
    path.join(__dirname, "recycle-fixture.ps1"),
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
      { windowsHide: true, timeout: 15000 },
      (error, stdout, stderr) => {
        if (error) return reject(Error(stderr || error.message));
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch (error) {
          reject(error);
        }
      },
    );
    child.stdin.end(JSON.stringify({ originalPath, action }));
  });
}
async function main() {
  const guard = createBrowserGuard({ ttlMs: 0 });
  let browser;
  for (const candidate of [
    {
      key: "chrome",
      name: "Chrome",
      folder: ["Google", "Chrome"],
      image: "chrome.exe",
    },
    {
      key: "edge",
      name: "Edge",
      folder: ["Microsoft", "Edge"],
      image: "msedge.exe",
    },
  ]) {
    try {
      await guard(candidate.key);
      browser = candidate;
      break;
    } catch {}
  }
  if (!browser)
    throw Error(
      "Both browsers are active; the proof will not close a user browser.",
    );
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "vacuum-browser-proof-"),
  );
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  const profile = path.join(
    root,
    "local",
    ...browser.folder,
    "User Data",
    "Default",
  );
  const filename = path.join(
    profile,
    "Cache",
    "Cache_Data",
    "vacuum-browser-cache-proof.bin",
  );
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(
    filename,
    Buffer.alloc(1024 * 1024, "Native cache proof, retain all contents.\n"),
  );
  const cookies = path.join(profile, "Cookies");
  await fs.writeFile(cookies, "Synthetic protected login state");
  const age = new Date(Date.now() - 10 * 86400000);
  await fs.utimes(filename, age, age);
  await fs.utimes(cookies, age, age);
  const originalHash = await digest(filename);
  const cookieHash = await digest(cookies);
  const probeExe = path.join(root, browser.image);
  await fs.copyFile(
    path.join(process.env.SystemRoot, "System32", "ping.exe"),
    probeExe,
  );
  let probe,
    app,
    restored = false;
  async function startProbe() {
    // A signed Windows loopback-ping fixture with the browser's image name.
    // It exercises the actual tasklist guard without opening or closing user browsers.
    probe = spawn(probeExe, ["-t", "127.0.0.1"], {
      windowsHide: true,
      stdio: "ignore",
    });
    await new Promise((resolve, reject) => {
      probe.once("spawn", resolve);
      probe.once("error", reject);
    });
    let seen = false;
    for (let i = 0; i < 10; i++) {
      try {
        await guard(browser.key);
      } catch (error) {
        seen = error.message.includes(`close ${browser.name}`);
      }
      if (seen) break;
      await sleep(100);
    }
    assert.ok(seen, "Native browser-name process was not detected");
  }
  async function stopProbe() {
    if (probe && probe.exitCode === null && probe.signalCode === null) {
      const ended = new Promise((resolve) => probe.once("exit", resolve));
      probe.kill();
      await ended;
    }
    probe = null;
    await sleep(650); // Expire the native guard's short-lived process snapshot.
  }
  try {
    await startProbe();
    app = await _electron.launch({
      ...(process.env.VACUUM_PACKAGED_EXE
        ? { executablePath: process.env.VACUUM_PACKAGED_EXE }
        : {}),
      args: process.env.VACUUM_PACKAGED_EXE
        ? ["--test-mode"]
        : [path.resolve(__dirname, ".."), "--test-mode"],
      env: { ...process.env, VACUUM_TEST_ROOT: root },
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.vacuum);
    await page.evaluate(() => window.vacuum.settings({ companion: false }));
    const round = async () => {
      const before = await page.evaluate(() => window.vacuum.get());
      assert.equal(before.startupError, undefined, before.startupError);
      await page.evaluate(() => window.vacuum.start());
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const state = await page.evaluate(() => window.vacuum.get());
        if (
          state.phase === "docked" &&
          state.lastRun &&
          state.lastRun !== before.lastRun
        )
          return state;
        if (state.roundError) throw Error(state.roundError);
        await sleep(100);
      }
      throw Error("Native cache scan did not finish within 30 seconds.");
    };
    let state = await round();
    assert.equal(state.bin.count, 0);
    assert.ok(state.coverage, JSON.stringify(state));
    assert.match(state.coverage.protectedBrowsers[0].reason, /close/);
    await page.locator(".browser-coverage").waitFor();
    await stopProbe();
    state = await round();
    assert.equal(state.bin.count, 1);
    assert.equal(state.bin.files[0].category, "browser-cache");
    await startProbe();
    const blocked = await page.evaluate(
      (id) => window.vacuum.empty([id]),
      state.bin.files[0].id,
    );
    assert.equal(blocked.trashed, 0);
    assert.match(blocked.skipped[0].reason, /close/);
    assert.equal(await digest(filename), originalHash);
    await stopProbe();
    const recycled = await page.evaluate(
      (id) => window.vacuum.empty([id]),
      state.bin.files[0].id,
    );
    assert.equal(recycled.trashed, 1);
    const entry = await recycleFixture(filename, "inspect");
    assert.equal(await digest(entry.recycledPath), originalHash);
    await recycleFixture(filename, "restore");
    restored = (await digest(filename)) === originalHash;
    assert.ok(restored);
    assert.equal(await digest(cookies), cookieHash);
    const report = {
      packaged: !!process.env.VACUUM_PACKAGED_EXE,
      browser: browser.name,
      processGuardFixture:
        "signed Windows loopback-ping process with browser image name",
      runningScanSkipped: true,
      closedScanCollected: 1,
      reopenedRecycleBlocked: true,
      recycledFiles: 1,
      restored,
      contentsPreserved: true,
      protectedProfileDataPreserved: true,
      permanentlyDeletedFiles: 0,
    };
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await fs.writeFile(
      path.resolve(__dirname, "../test-results/browser-cache-proof.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await stopProbe();
    if (!restored) {
      try {
        await fs.access(filename);
      } catch {
        await recycleFixture(filename, "restore").catch((error) =>
          console.error(
            "Fixture remains recoverable in Recycle Bin:",
            error.message,
          ),
        );
      }
    }
    await fs.utimes(filename, new Date(), new Date()).catch(() => {});
    if (app) await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
