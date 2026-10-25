const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vacuum-ui-"));
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  const junk = path.join(root, "temp", "vacuum-test-disposable.tmp"),
    old = path.join(root, "downloads", "vacuum-test-old.txt");
  await fs.writeFile(junk, "Disposable test fixture.");
  await fs.writeFile(old, "Personal review test fixture.");
  const stamp = new Date(Date.now() - 200 * 86400000);
  await fs.utimes(junk, stamp, stamp);
  await fs.utimes(old, stamp, stamp);
  let app;
  try {
    app = await electron.launch({
      ...(process.env.VACUUM_PACKAGED_EXE
        ? { executablePath: process.env.VACUUM_PACKAGED_EXE }
        : {}),
      args: process.env.VACUUM_PACKAGED_EXE
        ? ["--test-mode"]
        : [path.resolve(__dirname, ".."), "--test-mode"],
      env: {
        ...process.env,
        VACUUM_TEST_ROOT: root,
        ELECTRON_ENABLE_LOGGING: "1",
      },
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") console.error("Renderer:", m.text());
    });
    try {
      await page
        .getByRole("button", { name: "Start cleaning", exact: true })
        .waitFor({ timeout: 15000 });
    } catch (e) {
      console.error(
        "Renderer errors:",
        errors,
        "URL:",
        page.url(),
        "HTML:",
        (await page.content()).slice(0, 3000),
      );
      await page.screenshot({ path: "test-results/launch-error.png" });
      throw e;
    }
    await page.locator(".robot-scene canvas").waitFor();
    await page.waitForTimeout(1800);
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await page.screenshot({ path: "test-results/dark.png" });
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await page.locator("html[data-theme=light]").waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: "test-results/light.png" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("switch", { name: "Enable daily autoclean" }).click();
    assert.equal(
      await page
        .getByRole("switch", { name: "Enable daily autoclean" })
        .getAttribute("aria-checked"),
      "true",
    );
    await page.getByRole("switch", { name: "Enable daily autoclean" }).click();
    await page
      .getByRole("button", { name: "Close panel", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start cleaning", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector(".bin-copy p")
        .textContent.includes("1 file collected"),
    );
    await fs.access(junk); // A cleaning run must not physically delete the fixture.
    await page
      .getByRole("button", { name: "Open dust bin", exact: true })
      .last()
      .click();
    await page
      .getByRole("button", { name: "Empty selected · 1", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Send to Recycle Bin", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Nothing to empty. Nice." })
      .waitFor();
    await assert.rejects(fs.access(junk)); // Real Windows Recycle Bin, synthetic test file only.
    await page
      .getByRole("button", { name: "Close panel", exact: true })
      .click();
    await page.getByRole("button", { name: "Forgotten files" }).click();
    await page.getByText("vacuum-test-old.txt", { exact: true }).waitFor();
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Add 1 to dust bin", exact: true })
      .click();
    await page.getByText("vacuum-test-old.txt", { exact: true }).waitFor();
    await fs.access(old);
    await page
      .getByRole("button", { name: "Leave files alone", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Nothing to empty. Nice." })
      .waitFor();
    await fs.access(old);
    await page.screenshot({ path: "test-results/empty-bin.png" });
    await page
      .getByRole("button", { name: "Close panel", exact: true })
      .click();
    await page.getByRole("button", { name: /^Vacuum \+ mop/ }).click();
    await page
      .getByRole("button", { name: "Start cleaning", exact: true })
      .click();
    await page.locator(".security-result").waitFor({ timeout: 120000 });
    const wetResult = (await page.evaluate(() => window.vacuum.get()))
      .wetResult;
    assert.ok(["clear", "attention", "unavailable"].includes(wetResult.status));
    console.log(
      `Defender fixture-only scan: ${wetResult.status}. ${wetResult.message}`,
    );
    await page.locator(".security-result").click();
    await page
      .getByRole("heading", { name: "The wet clean.", exact: true })
      .waitFor();
    await page.screenshot({ path: "test-results/wet-result.png" });
    assert.deepEqual(errors, []);
    const settings = await page.evaluate(() => window.vacuum.get());
    assert.equal(settings.settings.theme, "light");
    assert.equal(settings.bin.count, 0);
    console.log(
      "PASS: native launch, WebGL robot, theme persistence, daily toggle, scan → bin → real Recycle Bin, old-file opt-in and release; no renderer errors.",
    );
  } finally {
    if (app) await app.close();
    console.log(`Isolated fixture directory: ${root}`);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
