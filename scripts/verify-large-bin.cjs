const { _electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vacuum-large-bin-"));
  const profile = path.join(root, "vacuum-test-profile");
  const temp = path.join(root, "temp");
  await fs.mkdir(profile);
  await fs.mkdir(temp);
  const age = Date.now() - 10 * 86400000;
  const files = Array.from({ length: 50000 }, (_, index) => ({
    id: `review-${index}`,
    path: path.join(temp, `fixture-${String(index).padStart(5, "0")}.log`),
    root: temp,
    category: "temporary",
    size: 1024,
    mtimeMs: age,
    ctimeMs: age,
    birthtimeMs: age,
    ino: String(index + 1),
    dev: "1",
  }));
  // References only: no 50,000-file workload, scan, compression or recycling runs.
  await fs.writeFile(
    path.join(profile, "bin.json"),
    JSON.stringify({ version: 1, files }),
  );
  const launch = () =>
    _electron.launch({
      ...(process.env.VACUUM_PACKAGED_EXE
        ? { executablePath: process.env.VACUUM_PACKAGED_EXE }
        : {}),
      args: process.env.VACUUM_PACKAGED_EXE
        ? ["--test-mode"]
        : [path.resolve(__dirname, ".."), "--test-mode"],
      env: { ...process.env, VACUUM_TEST_ROOT: root },
    });
  let app = await launch();
  const report = {
    references: files.length,
    packaged: !!process.env.VACUUM_PACKAGED_EXE,
    fileOperations: 0,
  };
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.locator(".robot-scene canvas").waitFor();
    const start = performance.now();
    await page
      .getByRole("button", { name: "Open dust bin", exact: true })
      .click();
    await page.locator(".file-row").first().waitFor();
    report.openMs = Math.round(performance.now() - start);
    assert.equal(await page.locator(".file-row").count(), 100);
    assert.ok(
      await page
        .getByRole("button", { name: "Empty selected · 50000", exact: true })
        .isEnabled(),
    );
    await page
      .getByRole("checkbox", { name: "Select fixture-00000.log", exact: true })
      .uncheck();
    let mark = performance.now();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "Select fixture-00100.log", exact: true })
      .waitFor();
    report.nextPageMs = Math.round(performance.now() - mark);
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    assert.equal(
      await page
        .getByRole("checkbox", {
          name: "Select fixture-00000.log",
          exact: true,
        })
        .isChecked(),
      false,
    );
    mark = performance.now();
    await page
      .getByRole("searchbox", { name: "Find files by name or path" })
      .fill("fixture-49999");
    await page.waitForFunction(
      () => document.querySelectorAll(".file-row").length === 1,
    );
    report.searchMs = Math.round(performance.now() - mark);
    assert.ok(
      await page
        .getByRole("checkbox", {
          name: "Select fixture-49999.log",
          exact: true,
        })
        .isChecked(),
    );
    await page.getByRole("searchbox").fill("no-such-fixture");
    await page
      .getByText("No files match this search. Your selection is kept.", {
        exact: true,
      })
      .waitFor();
    await page.getByRole("searchbox").fill("");
    await page
      .getByRole("button", { name: "Select all 50,000", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Deselect all", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Select all 50,000", exact: true })
      .click();
    assert.ok(
      await page
        .getByRole("checkbox", {
          name: "Select fixture-00000.log",
          exact: true,
        })
        .isChecked(),
    );
    report.maxRenderedRows = await page.locator(".file-row").count();
    assert.ok(
      report.openMs < 5000 &&
        report.nextPageMs < 2000 &&
        report.searchMs < 2000,
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 900, height: 600 }),
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page
      .getByRole("button", { name: "Empty selected · 50000", exact: true })
      .scrollIntoViewIfNeeded();
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await page.screenshot({
      path: "test-results/large-bin-compact.png",
      animations: "disabled",
    });
    assert.deepEqual(errors, []);
    report.selectionPreserved = true;
    report.compactWidth = 900;
  } finally {
    await app.close();
  }
  // Corrupt bin recovery must refuse operations while retaining the original metadata.
  const corrupt = '{"version":1,"files":';
  await fs.writeFile(path.join(profile, "bin.json"), corrupt);
  app = await launch();
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.vacuum);
    let state = await page.evaluate(() => window.vacuum.get());
    assert.match(state.startupError, /Could not read Vacuum's bin/);
    await page.evaluate(() => window.vacuum.start());
    state = await page.evaluate(() => window.vacuum.get());
    assert.equal(state.phase, "docked");
    assert.equal(
      await fs.readFile(path.join(profile, "bin.json"), "utf8"),
      corrupt,
    );
    report.corruptManifestPreserved = true;
  } finally {
    await app.close();
  }
  await fs.writeFile(
    path.resolve(__dirname, "../test-results/large-bin-proof.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
