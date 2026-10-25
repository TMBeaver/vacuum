const { _electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw Error(message);
}
const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
async function main() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "vacuum-performance-proof-"),
  );
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  const children = [];
  async function fixture(mode) {
    const folder = path.join(root, mode);
    const child = spawn(
      mode === "window" ? require("electron") : process.execPath,
      [path.join(__dirname, "performance-fixture.cjs"), folder, mode],
      { windowsHide: true, stdio: "ignore" },
    );
    children.push(child);
    const info = await waitFor(async () => {
      try {
        return JSON.parse(
          await fs.readFile(path.join(folder, "ready.json"), "utf8"),
        );
      } catch {
        return null;
      }
    }, "Performance fixture did not start");
    if (mode === "window")
      await waitFor(async () => {
        try {
          await fs.access(path.join(folder, "window-ready"));
          return true;
        } catch {
          return false;
        }
      }, "Performance fixture window did not appear");
    return { ...info, folder, child };
  }
  let app;
  try {
    const background = await fixture("background");
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
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("button", { name: "Review apps and ports", exact: true })
      .click();
    await page.locator(".performance-memory").waitFor({ timeout: 60000 });
    const search = page.getByRole("searchbox", {
      name: "Find an app or port",
      exact: true,
    });
    await search.fill(String(background.pid));
    let targetPid = background.pid;
    const row = () =>
      page
        .locator(".performance-process")
        .filter({ hasText: `PID ${targetPid} ·` });
    async function waitReceipt(text) {
      await page.waitForFunction(
        (text) =>
          !!document.querySelector(".performance-error") ||
          document
            .querySelector(".performance-receipt strong")
            ?.textContent.includes(text),
        text,
        { timeout: 120000 },
      );
      const error = (await page.locator(".performance-error").count())
        ? await page.locator(".performance-error").textContent()
        : null;
      if (error) throw Error(error);
    }
    await row()
      .getByText(`TCP 127.0.0.1:${background.port}`, { exact: true })
      .waitFor();
    const previousMemory = await row()
      .locator(".performance-process-heading > span")
      .textContent();
    assert.match(previousMemory, /MB|GB/);
    await row().getByRole("button", { name: "Stop…", exact: true }).click();
    assert.equal(
      background.child.exitCode,
      null,
      "Process stopped before explicit confirmation",
    );
    await row()
      .getByRole("button", { name: "Stop this process", exact: true })
      .click();
    await waitReceipt("process exited");
    assert.equal(await portOpen(background.port), false);
    await waitFor(
      () =>
        background.child.exitCode !== null ||
        background.child.signalCode !== null,
      "Background fixture did not exit",
    );
    assert.match(
      await page.locator(".performance-receipt").textContent(),
      /1 listener is no longer bound/,
    );
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await page.screenshot({
      path: "test-results/performance-stopped.png",
      animations: "disabled",
    });
    const window = await fixture("window");
    targetPid = window.pid;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page
      .locator(".performance-loading")
      .waitFor({ state: "hidden", timeout: 60000 });
    await search.fill(String(window.pid));
    await row()
      .getByRole("button", { name: "Close normally", exact: true })
      .waitFor();
    await row()
      .getByText(`TCP 127.0.0.1:${window.port}`, { exact: true })
      .waitFor();
    await row()
      .getByRole("button", { name: "Close normally", exact: true })
      .click();
    await waitReceipt("still running");
    assert.equal(await portOpen(window.port), true);
    assert.equal(window.child.exitCode, null);
    await fs.writeFile(
      path.join(window.folder, "allow-close"),
      "Fixture may close now",
    );
    await row()
      .getByRole("button", { name: "Close normally", exact: true })
      .click();
    await waitReceipt("process exited");
    assert.equal(await portOpen(window.port), false);
    await waitFor(
      () => window.child.exitCode !== null || window.child.signalCode !== null,
      "Window fixture did not exit",
    );
    await assert.rejects(
      page.evaluate(() =>
        window.vacuum.performanceAction("forged-pid", "stop"),
      ),
      /expired/,
    );
    assert.deepEqual(errors, []);
    const report = {
      packaged: !!process.env.VACUUM_PACKAGED_EXE,
      backgroundFixtureMemoryBefore: previousMemory,
      backgroundStoppedAfterConfirmation: true,
      backgroundListenerReleased: true,
      normalCloseRefusalRespected: true,
      normalCloseEventuallyExited: true,
      windowListenerReleased: true,
      staleIdRejected: true,
      userAppsClosed: 0,
      permanentlyDeletedFiles: 0,
    };
    await fs.writeFile(
      path.resolve(__dirname, "../test-results/performance-proof.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) child.kill();
    if (app) await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
