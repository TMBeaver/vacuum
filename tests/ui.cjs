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
    assert.equal(await page.locator(".robot-hotspot").count(), 6);
    await page.evaluate(() => {
      window.observedPhases = [];
      window.vacuum.subscribe((state) =>
        window.observedPhases.push(state.phase),
      );
    });
    const viewBefore = await page
      .locator(".robot-scene")
      .getAttribute("data-view");
    const bounds = await page.locator(".canvas-mount canvas").boundingBox();
    await page.mouse.move(
      bounds.x + bounds.width * 0.18,
      bounds.y + bounds.height * 0.65,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width * 0.37,
      bounds.y + bounds.height * 0.54,
      { steps: 20 },
    );
    await page.mouse.up();
    await page.waitForFunction(
      (before) =>
        document.querySelector(".robot-scene").dataset.view !== before,
      viewBefore,
    );
    assert.equal(
      (await page.evaluate(() => window.vacuum.get())).phase,
      "docked",
      "Dragging must never start cleaning",
    );
    await page.waitForTimeout(650);
    await page.screenshot({ path: "test-results/rotated.png" });
    await page.locator(".hotspot-auto").click();
    assert.equal(
      await page.locator(".hotspot-auto").getAttribute("aria-pressed"),
      "true",
    );
    await page.locator(".hotspot-auto").click();
    await page.locator(".hotspot-bin").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".robot-scene").dataset.motion === "hatch-open",
    );
    await page.waitForFunction(
      () => Number(document.querySelector(".robot-scene").dataset.hatch) > 0.96,
    );
    await page.screenshot({ path: "test-results/hatch-open.png" });
    await page
      .getByRole("button", { name: "Close panel", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector(".robot-scene").dataset.motion === "docked",
    );
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await page.locator("html[data-theme=light]").waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: "test-results/light.png" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("switch", { name: "Enable daily autoclean" }).click();
    await page
      .locator('[aria-label="Enable daily autoclean"][aria-checked="true"]')
      .waitFor();
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
    // Click the physical 3D power mesh through its projected coordinate.
    const power = await page.locator(".hotspot-power").boundingBox();
    await page
      .locator(".hotspot-power")
      .evaluate((el) => (el.style.pointerEvents = "none"));
    await page.mouse.click(
      power.x + power.width / 2,
      power.y + power.height / 2,
    );
    await page
      .locator(".hotspot-power")
      .evaluate((el) => (el.style.pointerEvents = ""));
    await page.waitForFunction(
      () =>
        document.querySelector(".robot-scene").dataset.motion === "travelling",
    );
    await page.screenshot({ path: "test-results/departing.png" });
    const companion =
      app.windows().find((w) => w.url().endsWith("#companion")) ||
      (await app.waitForEvent("window"));
    await companion.locator(".taskbar-canvas").waitFor();
    await companion.waitForFunction(
      () =>
        document.querySelector(".taskbar-canvas")?.dataset.motion === "capsule",
    );
    const placement = (await page.evaluate(() => window.vacuum.get()))
      .companionPlacement;
    assert.ok(placement.width <= 280 && placement.height <= 42);
    console.log("Companion placement:", JSON.stringify(placement));
    const nativeBounds = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith("#companion"))
        .getBounds(),
    );
    assert.deepEqual(
      nativeBounds,
      {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
      },
      "Native window must actually occupy the measured taskbar lane",
    );

    const positionBefore = await companion
      .locator(".taskbar-canvas")
      .getAttribute("data-offset");
    await companion.waitForFunction(
      (before) =>
        document.querySelector(".taskbar-canvas").dataset.offset !== before,
      positionBefore,
    );

    await companion.screenshot({
      path: "test-results/companion-dry.png",
      omitBackground: true,
    });
    await page.waitForFunction(() =>
      document
        .querySelector(".bin-copy em")
        .textContent.includes("1 file collected"),
    );
    await fs.access(junk); // A cleaning run must not physically delete the fixture.
    await page.waitForFunction(
      () => document.querySelector(".robot-scene").dataset.motion === "docked",
    );
    const phaseHistory = await page.evaluate(() => window.observedPhases);
    for (const phase of ["departing", "cleaning", "returning", "docked"])
      assert.ok(
        phaseHistory.includes(phase),
        `Missing physical transition: ${phase}`,
      );
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
    await page
      .locator(".canvas-mount canvas")
      .evaluate((el) => (el.dataset.continuity = "same-scene"));
    await page
      .getByRole("button", { name: "Enable wet cleaning", exact: true })
      .click();
    assert.equal(
      await page
        .locator(".canvas-mount canvas")
        .getAttribute("data-continuity"),
      "same-scene",
      "Mop toggles must animate in the existing 3D scene",
    );
    await page
      .getByRole("button", { name: "Start cleaning", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector(".robot-scene").dataset.trail === "water",
      null,
      { timeout: 30000 },
    );
    await page.screenshot({ path: "test-results/wet-active.png" });
    await companion.waitForFunction(
      () => document.querySelector(".taskbar-canvas").dataset.trail === "water",
    );
    await companion.screenshot({
      path: "test-results/companion-wet.png",
      omitBackground: true,
    });
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
    const observed = await page.evaluate(() => window.observedPhases);
    assert.ok(observed.includes("wet"));
    assert.ok(observed.includes("emptying"));
    await page
      .getByRole("button", { name: "Close panel", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector(".robot-scene").dataset.motion === "docked",
    );
    // A second short round can be cancelled from the actual home control.
    await page.locator(".hotspot-power").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".robot-scene").dataset.motion === "travelling",
    );
    const home = await page.locator(".hotspot-dock").boundingBox();
    await page.mouse.click(home.x + home.width / 2, home.y + home.height / 2);
    await page.waitForFunction(
      () => document.querySelector(".robot-scene").dataset.motion === "docked",
    );
    assert.ok(
      (await page.evaluate(() => window.vacuum.get())).coverage.cancelled,
    );
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
